import { apiRequestEnveloped as apiRequest } from "./client";

// Mirrors backend/internal/notification.Notification's JSON shape.
export type Notification = {
  id: number;
  customerId: number;
  type: string;
  title: string;
  body: string;
  relatedEntityType: string;
  relatedEntityId: number;
  delivered: boolean;
  deliveredAt?: string;
  attempts: number;
  lastAttemptAt?: string;
  read: boolean;
  readAt?: string;
  createdAt: string;
};

// GET /customer/notifications?limit=&offset= — the bell list's cold-start
// backfill (covers everything that arrived while the app was closed — the
// DB-is-source-of-truth half of the notification design, see
// src/realtime/socket.ts for the live-push half).
export function listNotifications(params: { limit: number; offset: number }): Promise<{ items: Notification[]; hasMore: boolean }> {
  return apiRequest("/notifications", { params });
}

// POST /customer/notifications/:id/ack — REST fallback ack, for a
// notification the app only ever saw via listNotifications (e.g. cold
// start, before the socket connects), not a live push.
export function ackNotification(id: number): Promise<void> {
  return apiRequest(`/notifications/${id}/ack`, { method: "POST" });
}

// POST /customer/notifications/:id/read — called when the customer actually
// opens a notification (the detail modal). This is the real "read" signal;
// the server persists it, so unread state survives app restarts/re-logins
// without any client-side watermark.
export function readNotification(id: number): Promise<void> {
  return apiRequest(`/notifications/${id}/read`, { method: "POST" });
}
