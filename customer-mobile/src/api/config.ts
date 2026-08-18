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
