import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "../auth/AuthContext";
import { connectNotificationSocket, NotificationMessage } from "../realtime/socket";
import * as notificationsApi from "../api/notifications";
import { Notification } from "../api/notifications";
import { loadLastSeenAt, saveLastSeenAt, loadLastViewedAt, saveLastViewedAt, clearWatermarks } from "./notificationWatermark";

// Two separate watermarks — NEITHER is the same thing as the server's
// `Delivered` flag (that stays exactly as designed: bytes-reached-the-
// device, unaffected by whether the customer has actually looked at
// anything). Both are persisted on-device (notificationWatermark.ts) so they
// survive a cold start or a re-login on the same device — previously they
// were in-memory-only React state and reset to null on every mount, which
// made every already-seen notification look unread again after each login/
// app restart.
//
//   - lastSeenAt/markSeen/unseenCount: the bell icon's badge count. Updated
//     the instant the bell is *opened* — the badge clears right away, same
//     as most apps' bell affordance.
//   - lastViewedAt/markViewed/isNew: a second, later watermark that only
//     advances when the list is *closed* — so while a sheet is open, items
//     that arrived since the last time it was closed still render with a
//     "New" tag (distinguishing them from ones already looked at in an
//     earlier session), even though the badge itself already cleared on
//     open. A notification that arrives while the sheet is already open
//     also gets tagged "New", since it's newer than lastViewedAt too.
type NotificationsState = {
  items: Notification[];
  unseenCount: number;
  markSeen: () => void;
  lastViewedAt: Date | null;
  // True once the persisted lastViewedAt has actually been read from disk
  // (or confirmed absent). lastViewedAt itself starts as null and a freshly
  // signed-in customer's genuinely-never-viewed null is indistinguishable
  // from "hasn't loaded yet" without this — see NotificationList.tsx's use
  // of it.
  viewedWatermarkReady: boolean;
  markViewed: () => void;
  // Persists lastViewedAt to disk immediately, without touching React state
  // (see markViewed's own comment for why the two are split).
  persistViewedNow: () => void;
  refresh: () => Promise<void>;
  loadMore: () => Promise<void>;
  hasMore: boolean;
  loadingMore: boolean;
};

const NotificationsContext = createContext<NotificationsState | undefined>(undefined);

const PAGE_SIZE = 20;

function fromLiveMessage(msg: NotificationMessage): Notification {
  return {
    id: msg.id,
    customerId: 0, // not carried on the wire message — the list is always the caller's own anyway
    type: msg.notifType,
    title: msg.title,
    body: msg.body,
    relatedEntityType: msg.relatedEntityType,
    relatedEntityId: msg.relatedEntityId,
    delivered: true, // the client just acked it in socket.ts — this row already reflects that
    attempts: 1,
    createdAt: msg.createdAt,
  };
}

// Mounted once, alongside AuthProvider, in app/_layout.tsx — the confirmed
// "global, always-mounted" home for a persistent connection (per this
// batch's exploration). Opens the socket once isAuthenticated becomes true,
// closes it on sign-out. refresh() backfills the first page via REST on
// cold start/whenever the bell is opened; loadMore() pages further back as
// the list is scrolled (see NotificationList.tsx's FlatList).
export function NotificationsProvider({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const [items, setItems] = useState<Notification[]>([]);
  const [lastSeenAt, setLastSeenAt] = useState<Date | null>(null);
  const [lastViewedAt, setLastViewedAt] = useState<Date | null>(null);
  const [viewedWatermarkReady, setViewedWatermarkReady] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const disconnectRef = useRef<(() => void) | null>(null);
  // Tracks the offset already fetched — a plain ref rather than deriving
  // from items.length, since live-pushed items (fromLiveMessage) also grow
  // `items` without having come from a paginated fetch.
  const offsetRef = useRef(0);

  const markSeen = useCallback(() => {
    const now = new Date();
    setLastSeenAt(now);
    saveLastSeenAt(now).catch(() => {});
  }, []);

  // The caller (NotificationList.tsx) defers markViewed by 300ms past its
  // unmount to dodge a close-animation flicker (the state update re-renders
  // every useNotifications() consumer, including the bell badge, mid-
  // animation). But if the whole thing — including the disk write — waits
  // that 300ms, an app backgrounded/killed inside that window (very
  // plausible right after closing a sheet) loses the write entirely: the
  // watermark never advances, and every already-viewed notification looks
  // "NEW" again on next launch, even though it was actually seen. So the
  // disk write happens immediately via persistViewedNow(), synchronously at
  // unmount; only the React state update (the part that can flicker) is
  // deferred through markViewed().
  const persistedViewedAtRef = useRef<Date | null>(null);

  const persistViewedNow = useCallback(() => {
    const now = new Date();
    persistedViewedAtRef.current = now;
    saveLastViewedAt(now).catch(() => {});
  }, []);

  const markViewed = useCallback(() => {
    setLastViewedAt(persistedViewedAtRef.current ?? new Date());
  }, []);

  const refresh = useCallback(async () => {
    try {
      const res = await notificationsApi.listNotifications({ limit: PAGE_SIZE, offset: 0 });
      setItems(res.items);
      setHasMore(res.hasMore);
      offsetRef.current = res.items.length;
    } catch {
      // Leave whatever's already in memory (e.g. live-pushed items from
      // this session) rather than clearing it on a transient fetch failure.
    }
  }, []);

  // Pages further back in history — appends rather than replaces, and is a
  // no-op while a page is already in flight or none remain (hasMore false).
  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);
    try {
      const res = await notificationsApi.listNotifications({ limit: PAGE_SIZE, offset: offsetRef.current });
      setItems((prev) => {
        const seen = new Set(prev.map((n) => n.id));
        return [...prev, ...res.items.filter((n) => !seen.has(n.id))];
      });
      offsetRef.current += res.items.length;
      setHasMore(res.hasMore);
    } catch {
      // Leave hasMore as-is — the next scroll-to-end retries.
    } finally {
      setLoadingMore(false);
    }
  }, [loadingMore, hasMore]);

  useEffect(() => {
    // AuthContext's isAuthenticated defaults to false and only flips true
    // once app/_layout.tsx's cold-start bootstrap (device-login/token
    // refresh) resolves — so on every reload this effect used to run first
    // with isAuthenticated still false, take the branch below, and wipe the
    // just-written watermarks via clearWatermarks() before they were ever
    // read back. That's what made the badge/"NEW" tags reset on every
    // single reload, regardless of anything persisted correctly last
    // session. authLoading distinguishes "bootstrap hasn't resolved yet"
    // (do nothing, wait) from "resolved, and the customer really is signed
    // out" (the only case that should clear anything).
    if (authLoading) return;

    if (!isAuthenticated) {
      disconnectRef.current?.();
      disconnectRef.current = null;
      setItems([]);
      setHasMore(false);
      offsetRef.current = 0;
      setLastSeenAt(null);
      setLastViewedAt(null);
      setViewedWatermarkReady(false);
      clearWatermarks().catch(() => {});
      return;
    }

    // Load the persisted watermarks before the first refresh — otherwise
    // the "everything looks unread" window (however brief) would still
    // flash on every mount.
    loadLastSeenAt().then(setLastSeenAt).catch(() => {});
    loadLastViewedAt()
      .then(setLastViewedAt)
      .catch(() => {})
      .finally(() => setViewedWatermarkReady(true));

    refresh();
    disconnectRef.current = connectNotificationSocket((msg) => {
      setItems((prev) => [fromLiveMessage(msg), ...prev.filter((n) => n.id !== msg.id)]);
      offsetRef.current += 1;
    });

    return () => {
      disconnectRef.current?.();
      disconnectRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated, authLoading]);

  const unseenCount = lastSeenAt
    ? items.filter((n) => new Date(n.createdAt) > lastSeenAt).length
    : items.length;

  // Memoized so a re-render of NotificationsProvider that doesn't actually
  // change any of these values (e.g. AuthProvider re-rendering for an
  // unrelated reason) doesn't hand every useNotifications() consumer a new
  // object reference — that would re-render every screen's FloatingHeader
  // for no reason, on top of the real updates this state already causes.
  const value = useMemo<NotificationsState>(
    () => ({
      items,
      unseenCount,
      markSeen,
      lastViewedAt,
      viewedWatermarkReady,
      markViewed,
      persistViewedNow,
      refresh,
      loadMore,
      hasMore,
      loadingMore,
    }),
    [
      items,
      unseenCount,
      markSeen,
      lastViewedAt,
      viewedWatermarkReady,
      markViewed,
      persistViewedNow,
      refresh,
      loadMore,
      hasMore,
      loadingMore,
    ]
  );

  return <NotificationsContext.Provider value={value}>{children}</NotificationsContext.Provider>;
}

export function useNotifications(): NotificationsState {
  const ctx = useContext(NotificationsContext);
  if (!ctx) throw new Error("useNotifications must be used within NotificationsProvider");
  return ctx;
}
