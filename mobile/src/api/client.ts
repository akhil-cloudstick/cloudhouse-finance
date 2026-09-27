import { API_BASE_URL } from "./config";
import { getToken } from "../auth/tokenStorage";
import { friendlyServerMessage } from "./errors";

// `message` is always safe to show: a readable server message passes
// through, anything technical (parse/SQL/binding errors, raw statuses) is
// replaced by a plain one — see errors.ts. The original stays on
// `rawMessage` for debugging.
export class ApiError extends Error {
  status: number;
  body: unknown;
  rawMessage: string;
  constructor(status: number, message: string, body: unknown) {
    super(friendlyServerMessage(status, message));
    this.status = status;
    this.body = body;
    this.rawMessage = message;
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
    if (__DEV__) console.warn(`[api] ${method} ${path} failed`, err);
    if (err instanceof Error && err.name === "AbortError") {
      throw new ApiError(408, "The server took too long to respond. Please try again.", undefined);
    }
    throw new ApiError(0, "Couldn't reach the server. Check your internet connection and try again.", undefined);
  } finally {
    clearTimeout(timer);
  }

  let text = "";
  try {
    text = await res.text();
  } catch {
    throw new ApiError(res.status || 0, "Couldn't read the server's response. Please try again.", undefined);
  }
  // A proxy/tunnel error page (HTML) or a truncated body isn't JSON — that
  // used to surface as "JSON Parse error: Unexpected character: <".
  let data: any;
  let parsed = true;
  try {
    data = text ? JSON.parse(text) : undefined;
  } catch {
    parsed = false;
    data = undefined;
    if (__DEV__) console.warn(`[api] ${method} ${path} returned non-JSON (${res.status})`, text.slice(0, 200));
  }

  if (!res.ok) {
    const message = (data && (data.error || data.message)) || "";
    throw new ApiError(res.status, typeof message === "string" ? message : "", data);
  }
  if (!parsed) {
    throw new ApiError(502, "The server sent an unexpected response. Please try again in a moment.", undefined);
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
    throw new ApiError(200, envelope.error || "", envelope);
  }
  // Most success responses carry the resource under `data`; a
  // delete/action-confirmation response instead carries a plain string
  // under `message` (see httpx.SuccessMessage) — fall back to that.
  return (envelope?.data !== undefined ? envelope.data : envelope?.message) as T;
}
