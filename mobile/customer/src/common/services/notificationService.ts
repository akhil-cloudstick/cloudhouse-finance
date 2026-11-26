import { apiRequestEnveloped as apiRequest } from "./httpClient";

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

export function listNotifications(params: { limit: number; offset: number }): Promise<{ items: Notification[]; hasMore: boolean }> {
  return apiRequest("/notifications", { params });
}

// REST fallback ack for a notification only seen via listNotifications, not a live push.
export function ackNotification(id: number): Promise<void> {
  return apiRequest(`/notifications/${id}/ack`, { method: "POST" });
}

export function readNotification(id: number): Promise<void> {
  return apiRequest(`/notifications/${id}/read`, { method: "POST" });
}
