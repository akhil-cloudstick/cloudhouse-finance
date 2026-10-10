import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "./AuthProvider";
import { connectNotificationSocket, NotificationMessage } from "@/common/services/socket";
import * as notificationsApi from "@/common/services/notificationService";
import { Notification } from "@/common/services/notificationService";

// Unread state is server-truth now (Notification.read, flipped by
// POST /customer/notifications/:id/read the moment the customer opens one —
// see NotificationDetailModal). Previously this lived entirely in a
// client-side timestamp watermark (lastSeenAt/lastViewedAt, persisted to
// SecureStore) that had to be reconstructed on every cold start/re-login; any
// gap in that reconstruction made every notification look unread again. Now
// there's nothing to reconstruct — `items[].read` came straight from the
// server on the last refresh()/live push, and markRead() just flips it
// (optimistically) and tells the server, the same as any other mutation in
// this app.
type NotificationsState = {
  items: Notification[];
  unseenCount: number;
  markRead: (id: number) => void;
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
    read: false, // a notification that just arrived live has definitionally not been opened yet
    createdAt: msg.createdAt,
  };
}

type NotificationsProviderProps = { children: React.ReactNode };

// Mounted once, alongside AuthProvider, in app/_layout.tsx — the confirmed
// "global, always-mounted" home for a persistent connection (per this
// batch's exploration). Opens the socket once isAuthenticated becomes true,
// closes it on sign-out. refresh() backfills the first page via REST on
// cold start/whenever the bell is opened; loadMore() pages further back as
// the list is scrolled (see NotificationList.tsx's FlatList).
export function NotificationsProvider({ children }: NotificationsProviderProps) {
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const [items, setItems] = useState<Notification[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const disconnectRef = useRef<(() => void) | null>(null);
  // Tracks the offset already fetched — a plain ref rather than deriving
  // from items.length, since live-pushed items (fromLiveMessage) also grow
  // `items` without having come from a paginated fetch.
  const offsetRef = useRef(0);

  // Optimistically flips the row locally (so the modal/list reflect it
  // instantly) and fires the REST call in the background; a failure here
  // just means the next refresh() re-syncs from the server, same posture as
  // every other best-effort mutation in this app.
  const markRead = useCallback((id: number) => {
    setItems((prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n)));
    notificationsApi.readNotification(id).catch(() => {});
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
    // with isAuthenticated still false. authLoading distinguishes "bootstrap
    // hasn't resolved yet" (do nothing, wait) from "resolved, and the
    // customer really is signed out" (the only case that should clear
    // anything).
    if (authLoading) return;

    if (!isAuthenticated) {
      disconnectRef.current?.();
      disconnectRef.current = null;
      setItems([]);
      setHasMore(false);
      offsetRef.current = 0;
      return;
    }

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

  const unseenCount = items.filter((n) => !n.read).length;

  // Memoized so a re-render of NotificationsProvider that doesn't actually
  // change any of these values (e.g. AuthProvider re-rendering for an
  // unrelated reason) doesn't hand every useNotifications() consumer a new
  // object reference — that would re-render every screen's FloatingHeader
  // for no reason, on top of the real updates this state already causes.
  const value = useMemo<NotificationsState>(
    () => ({
      items,
      unseenCount,
      markRead,
      refresh,
      loadMore,
      hasMore,
      loadingMore,
    }),
    [items, unseenCount, markRead, refresh, loadMore, hasMore, loadingMore]
  );

  return <NotificationsContext.Provider value={value}>{children}</NotificationsContext.Provider>;
}

export function useNotifications(): NotificationsState {
  const ctx = useContext(NotificationsContext);
  if (!ctx) throw new Error("useNotifications must be used within NotificationsProvider");
  return ctx;
}
