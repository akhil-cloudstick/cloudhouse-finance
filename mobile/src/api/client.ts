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

// Every list screen/dropdown/search box in this app must go through this
// helper with its filters as `params` — never fetch a full list and filter
// on-device (see plan: "All filtering/searching/sorting/dropdown-population
// happens server-side").
export function toQueryString(params?: Record<string, string | number | boolean | undefined>): string {
  if (!params) return "";
  const entries = Object.entries(params).filter(([, v]) => v !== undefined && v !== "");
  if (entries.length === 0) return "";
  const usp = new URLSearchParams();
  for (const [k, v] of entries) usp.set(k, String(v));
  return `?${usp.toString()}`;
}

// Ceiling on any single API call.
const REQUEST_TIMEOUT_MS = 20000;

type RequestOptions = {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  params?: Record<string, string | number | boolean | undefined>;
  // auth/login/forgot-password/reset-password are the only public routes.
  skipAuth?: boolean;
};

export async function apiRequest<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const { method = "GET", body, params, skipAuth } = opts;
  const url = `${API_BASE_URL}${path}${toQueryString(params)}`;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    // Free ngrok tunnels serve an HTML "visitor warning" interstitial to any
    // request that doesn't look like a browser, which would otherwise break
    // every API call through a free ngrok URL (see EXPO_PUBLIC_API_BASE_URL
    // in .env.local). Harmless no-op against a plain LAN IP/localhost.
    "ngrok-skip-browser-warning": "true",
  };
  if (!skipAuth) {
    const token = await getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
  }

  // A device that cannot reach API_BASE_URL (wrong LAN IP, dead ngrok tunnel,
  // stale bundle still holding the old default) would otherwise leave fetch
  // pending for minutes, which every caller renders as a spinner that never
  // stops. Abort instead so the screen can show its "could not reach the
  // server" message.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new ApiError(0, `Request timed out after ${REQUEST_TIMEOUT_MS / 1000}s (${API_BASE_URL})`, undefined);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }

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
// error}) — see backend/internal/platform/httpx. Only call this for a
// module whose Go handlers have actually migrated (branch is the first);
// every other module still returns the old bare-resource shape and must
// keep using apiRequest until its own handlers move over. Once every module
// has migrated, this replaces apiRequest outright and this comment goes away.
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
