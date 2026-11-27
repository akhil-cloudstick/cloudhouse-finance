import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "./AuthProvider";
import { connectNotificationSocket, NotificationMessage } from "@/common/services/socket";
import * as notificationsApi from "@/common/services/notificationService";
import { Notification } from "@/common/services/notificationService";

// Unread state is server-truth (Notification.read), not a client-side watermark, so nothing needs reconstructing.
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
    customerId: 0, // not carried on the wire message
    type: msg.notifType,
    title: msg.title,
    body: msg.body,
    relatedEntityType: msg.relatedEntityType,
    relatedEntityId: msg.relatedEntityId,
    delivered: true,
    attempts: 1,
    read: false,
    createdAt: msg.createdAt,
  };
}

type NotificationsProviderProps = { children: React.ReactNode };

export function NotificationsProvider({ children }: NotificationsProviderProps) {
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const [items, setItems] = useState<Notification[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const disconnectRef = useRef<(() => void) | null>(null);
  // Plain ref, not items.length, since live-pushed items also grow `items` without a paginated fetch.
  const offsetRef = useRef(0);

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
      // Leave whatever's already in memory rather than clearing it on a transient fetch failure.
    }
  }, []);

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
    // authLoading distinguishes "bootstrap not resolved yet" from "resolved, customer is signed out".
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

  // Memoized so an unrelated re-render doesn't hand every consumer a new object reference.
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
