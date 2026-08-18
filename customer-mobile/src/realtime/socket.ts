import { WS_BASE_URL } from "../api/config";
import { getToken } from "../auth/tokenStorage";

// Wire shape pushed down the socket by backend/internal/notification's
// Service — see documents/api_documentation.md's "Customer App
// Notifications API" section.
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

// connectNotificationSocket opens a persistent WebSocket to
// GET /customer/ws, authenticated via the same Bearer token every REST call
// uses (React Native's WebSocket, unlike a browser's, accepts custom
// headers at connect time). On every {"type":"notification",...} message it
// immediately acks receipt back over the socket — this IS the "client
// received" signal the backend's Delivered flag is keyed on (not "seen" —
// there is no separate seen/opened signal in this batch) — then hands the
// message to onNotification. Reconnects with exponential backoff on any
// close/error; call the returned function to stop reconnecting and close
// the connection (e.g. on sign-out).
export function connectNotificationSocket(onNotification: (msg: NotificationMessage) => void): () => void {
  let ws: WebSocket | null = null;
  let closed = false;
  let backoff = INITIAL_BACKOFF_MS;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  async function connect() {
    if (closed) return;
    const token = await getToken();
    if (!token) return; // signed out mid-connect-attempt — do not retry
    if (closed) return;

    // @ts-expect-error — React Native's WebSocket accepts a third `options`
    // argument (headers) that the DOM lib's WebSocket type doesn't declare.
    ws = new WebSocket(WS_BASE_URL, undefined, { headers: { Authorization: `Bearer ${token}` } });

    ws.onopen = () => {
      backoff = INITIAL_BACKOFF_MS; // reset on a successful connect
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
        // Best-effort — a failed ack just means the server's resend ticker
        // will retry this notification later, same as any other drop.
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
