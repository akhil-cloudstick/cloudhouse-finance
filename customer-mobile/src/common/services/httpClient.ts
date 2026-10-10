import { fromApi, rememberToken, toApi } from "./apiContract";
import { getToken } from "./tokenStorage";

// ===== ENVIRONMENT =====
// Flip this before building. false = production.
const isDevelopment = false;
// development API — the Android emulator reaches the host machine at 10.0.2.2
const DEV_URL = process.env.EXPO_PUBLIC_API_BASE_URL ?? "http://10.0.2.2:8080/api/v1/customer";
// production API — supplied per build through EXPO_PUBLIC_API_BASE_URL (eas.json / .env)
const PROD_URL = process.env.EXPO_PUBLIC_API_BASE_URL ?? "http://10.0.2.2:8080/api/v1/customer";

// Razorpay's hosted checkout script — the one third-party host the app loads.
export const RAZORPAY_CHECKOUT_URL = "https://checkout.razorpay.com/v1/checkout.js";

// Single place to change the backend base URL — same dev-proxy convention
// as mobile/src/common/services/httpClient.ts, pointed at the customer-scoped API base path
// instead of the staff one. Point this at your machine's LAN IP (not
// localhost — the Android emulator/device is a separate host) while
// developing, e.g. "http://192.168.1.23:8080/api/v1/customer".
export const API_BASE_URL = isDevelopment ? DEV_URL : PROD_URL;
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
// For the few endpoints outside the /customer prefix (branding): same origin,
// caller-built headers and envelope handling.
export function originFetch(path: string, init?: RequestInit): Promise<Response> {
  return fetch(`${ORIGIN_BASE_URL}/api/v1${path}`, init);
}

export function resolveAssetUrl(url: string | undefined | null): string | undefined {
  if (!url) return undefined;
  if (/^https?:\/\//i.test(url)) return url;
  return `${ORIGIN_BASE_URL}${url.startsWith("/") ? "" : "/"}${url}`;
}

export class ApiError extends Error {
  status: number;
  body: unknown;
  constructor(status: number, message: string, body: unknown) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

export function toQueryString(params?: Record<string, string | number | boolean | undefined>): string {
  if (!params) return "";
  const entries = Object.entries(params).filter(([, v]) => v !== undefined && v !== "");
  if (entries.length === 0) return "";
  const usp = new URLSearchParams();
  for (const [k, v] of entries) usp.set(k, String(v));
  return `?${usp.toString()}`;
}

type RequestOptions = {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  params?: Record<string, string | number | boolean | undefined>;
  // request-otp/verify-otp/device-login are the only public customer routes.
  skipAuth?: boolean;
};

// Same apiRequest fetch-wrapper pattern as mobile/src/common/services/httpClient.ts, pointed
// at the customer-scoped API_BASE_URL (/api/v1/customer).
// apiUrl is the full URL of a customer API path under the backend's current contract, for downloads that
// cannot go through apiRequest (the signed-in customer comes from the last token read).
export function apiUrl(path: string, method = "GET"): string {
  return `${ORIGIN_BASE_URL}/api/v1${toApi(method, `/customer${path}`, undefined).path}`;
}

export async function apiRequest<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const { body, params, skipAuth } = opts;
  const token = skipAuth ? null : await getToken();
  if (token) rememberToken(token);
  // paths here are relative to /api/v1/customer; the adapter maps them onto /api/v1/customers/:customer_id
  const req = toApi(opts.method ?? "GET", `/customer${path}${toQueryString(params)}`, body, token);
  const url = `${ORIGIN_BASE_URL}/api/v1${req.path}`;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "ngrok-skip-browser-warning": "true",
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(url, {
    method: req.method,
    headers,
    body: req.body !== undefined ? JSON.stringify(req.body) : undefined,
  });

  const text = await res.text();
  const data = (text ? fromApi(JSON.parse(text), req) : undefined) as any;

  if (!res.ok) {
    const message = (data && (data.error || data.message)) || res.statusText;
    throw new ApiError(res.status, message, data);
  }

  return data as T;
}

// apiRequestEnveloped is apiRequest's counterpart for backend modules
// migrated to the house response envelope ({success, data} / {success,
// error}) — see backend/internal/platform/httpx and mobile/src/common/services/httpClient.ts
// (the staff app's identical helper). No customer-app endpoint has migrated
// yet (branch, the first migrated module, is staff-only) — this exists so
// both apps' httpClient.ts stay in lockstep, ready for the first customer-facing
// module (gold rate) to switch over.
export async function apiRequestEnveloped<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const envelope = await apiRequest<{ success: boolean; data?: T; message?: T; error?: string }>(path, opts);
  if (envelope && envelope.success === false) {
    throw new ApiError(200, envelope.error || "Request failed", envelope);
  }
  // Most success responses carry the resource under `data`; a
  // delete/action-confirmation response instead carries a plain string
  // under `message` (see httpx.SuccessMessage) — fall back to that.
  return (envelope?.data !== undefined ? envelope.data : envelope?.message) as T;
}
