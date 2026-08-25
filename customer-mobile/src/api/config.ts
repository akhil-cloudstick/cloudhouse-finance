// Single place to change the backend base URL — same dev-proxy convention
// as mobile/src/api/config.ts, pointed at the customer-scoped API base path
// instead of the staff one. Point this at your machine's LAN IP (not
// localhost — the Android emulator/device is a separate host) while
// developing, e.g. "http://192.168.1.23:8080/api/v1/customer".
export const API_BASE_URL =
  process.env.EXPO_PUBLIC_API_BASE_URL ?? "http://10.0.2.2:8080/api/v1/customer";
// 10.0.2.2 is the Android emulator's alias for the host machine's localhost —
// works out of the box in the emulator; a physical device needs the LAN IP
// above instead (set EXPO_PUBLIC_API_BASE_URL in .env.local or eas.json).

// Realtime notifications — same host/port as API_BASE_URL, just a ws(s)://
// scheme and the /customer/ws path instead of the REST base. Derived rather
// than a second env var so the two can never drift apart.
export const WS_BASE_URL = API_BASE_URL.replace(/^http/, "ws").replace(/\/api\/v1\/customer$/, "/api/v1/customer/ws");

// The backend's bare origin (scheme://host:port, no /api/v1/customer suffix)
// — needed because uploaded-file URLs (Customer.PhotoURL, KYC document
// URLs, etc.) come back from the API as root-relative paths like
// "/uploads/42-photo.jpg" (see backend/internal/upload/handler.go). That
// resolves fine in the web admin (same origin as the API), but React
// Native has no "current page origin" to resolve a relative URL against —
// an <Image source={{uri:"/uploads/..."}}> just silently fails to load.
export const ORIGIN_BASE_URL = API_BASE_URL.replace(/\/api\/v1\/customer.*$/, "");

// Turns a possibly-relative upload URL from the API into one React Native's
// <Image>/file-download calls can actually fetch. Absolute URLs (http/https,
// e.g. a future CDN/S3 URL) are returned unchanged.
export function resolveAssetUrl(url: string | undefined | null): string | undefined {
  if (!url) return undefined;
  if (/^https?:\/\//i.test(url)) return url;
  return `${ORIGIN_BASE_URL}${url.startsWith("/") ? "" : "/"}${url}`;
}
