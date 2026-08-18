import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "../auth/AuthContext";
import { connectNotificationSocket, NotificationMessage } from "../realtime/socket";
import * as notificationsApi from "../api/notifications";
import { Notification } from "../api/notifications";

// Two separate, purely local/client-side watermarks — NEITHER is the same
// thing as the server's `Delivered` flag (that stays exactly as designed:
// bytes-reached-the-device, unaffected by whether the customer has actually
// looked at anything). Both are in-memory only, reset on every cold start.
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
  markViewed: () => void;
  refresh: () => Promise<void>;
};

const NotificationsContext = createContext<NotificationsState | undefined>(undefined);

const PAGE_SIZE = 30;

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
// closes it on sign-out. refresh() backfills history via REST on cold
// start/whenever the bell is opened.
export function NotificationsProvider({ children }: { children: React.ReactNode }) {
  const { isAuthenticated } = useAuth();
  const [items, setItems] = useState<Notification[]>([]);
  const [lastSeenAt, setLastSeenAt] = useState<Date | null>(null);
  const [lastViewedAt, setLastViewedAt] = useState<Date | null>(null);
  const disconnectRef = useRef<(() => void) | null>(null);

  const markSeen = useCallback(() => setLastSeenAt(new Date()), []);
  const markViewed = useCallback(() => setLastViewedAt(new Date()), []);

  const refresh = useCallback(async () => {
    try {
      const res = await notificationsApi.listNotifications({ limit: PAGE_SIZE, offset: 0 });
      setItems(res.items);
    } catch {
      // Leave whatever's already in memory (e.g. live-pushed items from
      // this session) rather than clearing it on a transient fetch failure.
    }
  }, []);

  useEffect(() => {
    if (!isAuthenticated) {
      disconnectRef.current?.();
      disconnectRef.current = null;
      setItems([]);
      return;
    }

    refresh();
    disconnectRef.current = connectNotificationSocket((msg) => {
      setItems((prev) => [fromLiveMessage(msg), ...prev.filter((n) => n.id !== msg.id)]);
    });

    return () => {
      disconnectRef.current?.();
      disconnectRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated]);

  const unseenCount = lastSeenAt
    ? items.filter((n) => new Date(n.createdAt) > lastSeenAt).length
    : items.length;

  // Memoized so a re-render of NotificationsProvider that doesn't actually
  // change any of these values (e.g. AuthProvider re-rendering for an
  // unrelated reason) doesn't hand every useNotifications() consumer a new
  // object reference — that would re-render every screen's FloatingHeader
  // for no reason, on top of the real updates this state already causes.
  const value = useMemo<NotificationsState>(
    () => ({ items, unseenCount, markSeen, lastViewedAt, markViewed, refresh }),
    [items, unseenCount, markSeen, lastViewedAt, markViewed, refresh]
  );

  return <NotificationsContext.Provider value={value}>{children}</NotificationsContext.Provider>;
}

export function useNotifications(): NotificationsState {
  const ctx = useContext(NotificationsContext);
  if (!ctx) throw new Error("useNotifications must be used within NotificationsProvider");
  return ctx;
}
