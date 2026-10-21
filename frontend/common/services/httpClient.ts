import {
  activeBusinessSlug,
  clearSession,
  loginPath,
  readToken,
  resolveActiveSlug,
} from "@/common/services/tenantSession";
import { branchHeader } from "@/common/services/branchSelection";
import { fromApi, toApi } from "@/common/services/apiContract";

// ===== ENVIRONMENT =====
// Flip this before building. false = production.
const isDevelopment = false;
// development API — same-origin /api/v1, proxied to the backend by next.config.ts rewrites
const DEV_URL = process.env.NEXT_PUBLIC_API_BASE || "/api/v1";
// production API — same-origin /api/v1, served by the Go binary that also serves this build
const PROD_URL = process.env.NEXT_PUBLIC_API_BASE || "/api/v1";

// Razorpay's hosted checkout script — the one third-party host the app loads.
export const RAZORPAY_CHECKOUT_URL = "https://checkout.razorpay.com/v1/checkout.js";

export const API_BASE = isDevelopment ? DEV_URL : PROD_URL;

// Desktop's webview has its own origin, so a relative path there needs API_BASE's real host.
export function resolveAssetUrl(path: string): string {
  if (!path || /^(https?:|data:|blob:)/i.test(path)) return path;
  try {
    return new URL(path, API_BASE).toString();
  } catch {
    return path;
  }
}

/* fetch rejects with a TypeError when the server can't be reached at all —
 * surfaced as an ApiError with status 0 so callers show one readable message. */
async function networkFetch(url: string, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch (e) {
    if (e instanceof TypeError) throw new ApiError("Couldn't reach the server. Check your connection and try again.", 0);
    throw e;
  }
}

/* Every request goes through the backend contract adapter (common/services/apiContract.ts):
 * paths, verbs, query and body move to the current API, and JSON responses come back
 * in the shapes the screens already read. */
async function contractFetch(path: string, init?: RequestInit): Promise<Response> {
  // the identity in the path is the principal of the token this request actually carries (staff or superadmin)
  const sent = new Headers(init?.headers).get("Authorization")?.replace(/^Bearer\s+/i, "") || null;
  const req = toApi(init?.method ?? "GET", path, init?.body ?? undefined, sent ?? readToken());
  const res = await networkFetch(`${API_BASE}${req.path}`, { ...init, method: req.method, body: req.body as BodyInit | undefined });
  if (!(res.headers.get("content-type") ?? "").includes("application/json")) return res;
  const text = await res.text();
  let adapted = text;
  try {
    adapted = text ? JSON.stringify(fromApi(JSON.parse(text), req)) : text;
  } catch {
    /* not valid JSON despite the header: hand it back untouched */
  }
  const headers = new Headers(res.headers);
  headers.delete("content-length");
  return new Response(res.status === 204 ? null : adapted, { status: res.status, statusText: res.statusText, headers });
}

// Session is per-business-slug (common/services/tenantSession.ts), so two tabs on different businesses don't clobber each other.
export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

// Exported for the two binary-stream endpoints (statements, exports) that build their own fetch.
export function getAuthToken(): string | null {
  return readToken();
}

// branchHeader is a view filter, not a credential — the backend owns and enforces branch scoping (platform.GetBranchScope).
function authHeader(): Record<string, string> {
  const token = readToken();
  return { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...branchHeader() };
}

// Caller headers spread last so they can't silently drop Authorization / X-Branch-Id.
function jsonHeaders(opts?: RequestInit): Record<string, string> {
  return {
    "Content-Type": "application/json",
    ...authHeader(),
    ...Object.fromEntries(new Headers(opts?.headers).entries()),
  };
}

/* For endpoints that build their own init (binary PDFs/exports, public
 * reads, the superadmin session): the base URL stays here, while the caller
 * keeps its exact headers and error handling. */
export function apiRawFetch(path: string, init?: RequestInit): Promise<Response> {
  return contractFetch(path, init);
}

/* A same-origin file URL (/uploads/*) fetched with this tab's own session
 * token and branch header — the same headers every wrapped request carries. */
export function fetchWithSession(url: string): Promise<Response> {
  return networkFetch(resolveAssetUrl(url), { headers: authHeader() });
}

// Clears session and bounces to login on 401; skips /auth/* so a bad-password 401 shows inline instead.
function handleUnauthorized(path: string) {
  if (typeof window === "undefined") return;
  if (path.startsWith("/auth/")) return;
  const slug = activeBusinessSlug();
  clearSession(slug);
  // Only keep the slug in the URL if it was already there (host-resolved tenants never had it).
  const { slug: resolvedSlug, fromPath } = resolveActiveSlug();
  const includeInUrl = resolvedSlug === null || fromPath;
  const target = loginPath(slug, includeInUrl);
  if (window.location.pathname !== target) {
    window.location.href = target;
  }
}

// Bootstrap permissions call is excluded — it has its own retry state, reacting here would loop.
export const FORBIDDEN_EVENT = "app:forbidden";

function handleForbidden(path: string) {
  if (typeof window === "undefined") return;
  if (path.includes("/permissions/by-employee")) return;
  window.dispatchEvent(new CustomEvent(FORBIDDEN_EVENT));
}

function handleAuthFailure(status: number, path: string) {
  if (status === 401) handleUnauthorized(path);
  else if (status === 403) handleForbidden(path);
}

export async function apiFetch<T>(path: string, opts?: RequestInit): Promise<T> {
  const res = await contractFetch(path, { ...opts, headers: jsonHeaders(opts) });
  if (!res.ok) {
    handleAuthFailure(res.status, path);
    let message = res.statusText;
    try {
      const body = await res.json();
      if (body?.error) message = body.error;
    } catch {
      /* non-JSON error body — fall back to statusText */
    }
    throw new ApiError(message, res.status);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

// For modules migrated to the {success,data}/{success,error} envelope (httpx) — others still use apiFetch.
export async function apiFetchEnveloped<T>(path: string, opts?: RequestInit): Promise<T> {
  const res = await contractFetch(path, { ...opts, headers: jsonHeaders(opts) });
  let body: { success?: boolean; data?: T; message?: unknown; error?: string } | undefined;
  try {
    body = res.status === 204 ? undefined : await res.json();
  } catch {
    /* non-JSON body — handled below via res.ok/res.statusText */
  }
  if (!res.ok || body?.success === false) {
    handleAuthFailure(res.status, path);
    throw new ApiError(body?.error || res.statusText, res.status);
  }
  // A delete/confirmation response carries a string under `message` instead of `data` (httpx.SuccessMessage).
  return (body?.data !== undefined ? body.data : body?.message) as T;
}

// For the rare envelope with extra top-level fields beyond {success,data} (e.g. permissions' `role`).
export async function apiFetchEnvelope<T extends { success: boolean; error?: string }>(
  path: string,
  opts?: RequestInit
): Promise<T> {
  const res = await contractFetch(path, { ...opts, headers: jsonHeaders(opts) });
  let body: T | undefined;
  try {
    body = await res.json();
  } catch {
    /* non-JSON body — handled below via res.ok/res.statusText */
  }
  if (!res.ok || body?.success === false) {
    handleAuthFailure(res.status, path);
    throw new ApiError(body?.error || res.statusText, res.status);
  }
  return body as T;
}

// No Content-Type set — the browser must set its own multipart boundary for FormData.
export async function apiUpload<T>(path: string, formData: FormData): Promise<T> {
  const res = await contractFetch(path, {
    method: "POST",
    headers: { ...authHeader() },
    body: formData,
  });
  if (!res.ok) {
    handleAuthFailure(res.status, path);
    let message = res.statusText;
    try {
      const body = await res.json();
      if (body?.error) message = body.error;
    } catch {
      /* non-JSON error body — fall back to statusText */
    }
    throw new ApiError(message, res.status);
  }
  return (await res.json()) as T;
}

// apiUpload's counterpart for the migrated `upload` module ({success, data: {url}}).
export async function apiUploadEnveloped<T>(path: string, formData: FormData): Promise<T> {
  const res = await contractFetch(path, {
    method: "POST",
    headers: { ...authHeader() },
    body: formData,
  });
  let body: { success?: boolean; data?: T; error?: string } | undefined;
  try {
    body = await res.json();
  } catch {
    /* non-JSON body — handled below via res.ok/res.statusText */
  }
  if (!res.ok || body?.success === false) {
    handleAuthFailure(res.status, path);
    throw new ApiError(body?.error || res.statusText, res.status);
  }
  return body?.data as T;
}
