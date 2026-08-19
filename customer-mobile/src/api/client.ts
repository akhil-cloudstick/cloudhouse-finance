import { API_BASE_URL } from "./config";
import { getToken } from "../auth/tokenStorage";

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

// Same apiRequest fetch-wrapper pattern as mobile/src/api/client.ts, pointed
// at the customer-scoped API_BASE_URL (/api/v1/customer).
export async function apiRequest<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const { method = "GET", body, params, skipAuth } = opts;
  const url = `${API_BASE_URL}${path}${toQueryString(params)}`;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "ngrok-skip-browser-warning": "true",
  };
  if (!skipAuth) {
    const token = await getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
  }

  const res = await fetch(url, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();
  const data = text ? JSON.parse(text) : undefined;

  if (!res.ok) {
    const message = (data && (data.error || data.message)) || res.statusText;
    throw new ApiError(res.status, message, data);
  }

  return data as T;
}

// apiRequestEnveloped is apiRequest's counterpart for backend modules
// migrated to the house response envelope ({success, data} / {success,
// error}) — see backend/internal/platform/httpx and mobile/src/api/client.ts
// (the staff app's identical helper). No customer-app endpoint has migrated
// yet (branch, the first migrated module, is staff-only) — this exists so
// both apps' client.ts stay in lockstep, ready for the first customer-facing
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
