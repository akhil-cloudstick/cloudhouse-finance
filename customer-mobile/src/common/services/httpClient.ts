import { fromApi, rememberToken, toApi } from "./apiContract";
import { getToken } from "./tokenStorage";

// Flip before building. false = production.
const isDevelopment = false;
const DEV_URL = process.env.EXPO_PUBLIC_API_BASE_URL ?? "http://10.0.2.2:8080/api/v1/customer";
const PROD_URL = process.env.EXPO_PUBLIC_API_BASE_URL ?? "http://10.0.2.2:8080/api/v1/customer";

export const RAZORPAY_CHECKOUT_URL = "https://checkout.razorpay.com/v1/checkout.js";

// Point at your machine's LAN IP, not localhost, while developing on a physical device/emulator.
export const API_BASE_URL = isDevelopment ? DEV_URL : PROD_URL;

// Derived from API_BASE_URL (not a second env var) so the two can never drift apart.
export const WS_BASE_URL = API_BASE_URL.replace(/^http/, "ws").replace(/\/api\/v1\/customer$/, "/api/v1/customer/ws");

// Upload URLs come back root-relative (e.g. "/uploads/42-photo.jpg"); RN has no page origin to resolve them against.
export const ORIGIN_BASE_URL = API_BASE_URL.replace(/\/api\/v1\/customer.*$/, "");

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
  skipAuth?: boolean;
};

export function apiUrl(path: string, method = "GET"): string {
  return `${ORIGIN_BASE_URL}/api/v1${toApi(method, `/customer${path}`, undefined).path}`;
}

export async function apiRequest<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const { body, params, skipAuth } = opts;
  const token = skipAuth ? null : await getToken();
  if (token) rememberToken(token);
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

export async function apiRequestEnveloped<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const envelope = await apiRequest<{ success: boolean; data?: T; message?: T; error?: string }>(path, opts);
  if (envelope && envelope.success === false) {
    throw new ApiError(200, envelope.error || "Request failed", envelope);
  }
  // Falls back to `message` for delete/action-confirmation responses that carry a plain string there.
  return (envelope?.data !== undefined ? envelope.data : envelope?.message) as T;
}
