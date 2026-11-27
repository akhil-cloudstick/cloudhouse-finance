import { WS_BASE_URL } from "./httpClient";
import { getToken } from "./tokenStorage";

export type NotificationMessage = {
  type: "notification";
  id: number;
  notifType: string;
  title: string;
  body: string;
  relatedEntityType: string;
  relatedEntityId: number;
  createdAt: string;
};

const MAX_BACKOFF_MS = 30000;
const INITIAL_BACKOFF_MS = 2000;

// Acks each message (keys the backend's Delivered flag); reconnects with exponential backoff.
export function connectNotificationSocket(onNotification: (msg: NotificationMessage) => void): () => void {
  let ws: WebSocket | null = null;
  let closed = false;
  let backoff = INITIAL_BACKOFF_MS;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  async function connect() {
    if (closed) return;
    const token = await getToken();
    if (!token) return;
    if (closed) return;

    // @ts-expect-error — React Native's WebSocket accepts a third `options`
    // argument (headers) that the DOM lib's WebSocket type doesn't declare.
    ws = new WebSocket(WS_BASE_URL, undefined, { headers: { Authorization: `Bearer ${token}` } });

    ws.onopen = () => {
      backoff = INITIAL_BACKOFF_MS;
    };

    ws.onmessage = (event: any) => {
      let msg: NotificationMessage | null = null;
      try {
        msg = JSON.parse(event.data);
      } catch {
        return;
      }
      if (!msg || msg.type !== "notification") return;
      try {
        ws?.send(JSON.stringify({ type: "ack", notificationId: msg.id }));
      } catch {
        // Best-effort: a failed ack just means the server's resend ticker retries later.
      }
      onNotification(msg);
    };

    const scheduleReconnect = () => {
      if (closed) return;
      if (reconnectTimer) return;
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        backoff = Math.min(backoff * 2, MAX_BACKOFF_MS);
        connect();
      }, backoff);
    };

    ws.onerror = scheduleReconnect;
    ws.onclose = scheduleReconnect;
  }

  connect();

  return () => {
    closed = true;
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    ws?.close();
    ws = null;
  };
}
