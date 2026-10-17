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

/* Thin fetch wrapper for the Go backend (Gin, `/api/v1/...`). In production
 * the backend serves the built frontend from the same origin, so requests
 * can go to a relative `/api/v1` path. In dev (`next dev` on its own port)
 * point NEXT_PUBLIC_API_BASE at the backend, e.g. http://localhost:8080/api/v1.
 */

export const API_BASE = isDevelopment ? DEV_URL : PROD_URL;

/* Root-relative backend file URLs (/uploads/…, the branding logo) resolve
 * against the page's own origin. The desktop app has no server of its own,
 * so when API_BASE names a host they are pointed at that host instead. */
export function backendUrl(path: string): string {
  if (!path.startsWith("/") || path.startsWith("//") || !/^https?:\/\//i.test(API_BASE)) return path;
  return new URL(API_BASE).origin + path;
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

/* The JWT session lives in common/services/tenantSession.ts, keyed by
 * business slug.
 *
 * It used to be a single "cloudhouse_token" key read directly here. Every
 * business shares one browser origin, so that one key meant two businesses
 * open in two tabs silently clobbered each other's session. Keys are per-slug
 * now, and this wrapper asks tenantSession which business the current tab is
 * operating as rather than knowing any key itself. */

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

/* getAuthToken is exported for the two endpoints that stream binary bodies
 * (loan statements, report exports) and therefore build their own fetch
 * instead of going through the wrappers below. They previously read the
 * localStorage key directly, which is exactly how a per-business session gets
 * missed — the key is no longer theirs to know. */
export function getAuthToken(): string | null {
  return readToken();
}

/* branchHeader() rides along on every authenticated request. It is a view
 * control, not a credential: the backend narrows a cross-branch role's own
 * data to one branch and ignores it entirely for every other role — it can
 * never widen access or cross a business (see platform.GetBranchScope). */
function authHeader(): Record<string, string> {
  const token = readToken();
  return { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...branchHeader() };
}

/* The headers for a JSON request: defaults, then auth + branch, then the
 * caller's own. Spread *after* opts in the fetch init — spreading opts last
 * (as this used to) let any caller-supplied `headers` replace the whole
 * object and silently drop Authorization / X-Branch-Id. */
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
  return networkFetch(backendUrl(url), { headers: authHeader() });
}

/* Called whenever the backend rejects a request with 401 — clears the
 * stored session and bounces to the login page. Skipped for the /auth/*
 * endpoints themselves: a wrong password on /auth/login is an expected 401
 * that the login form needs to show inline, not a reason to force-navigate
 * away.
 *
 * The bounce keeps the business slug. Sending a signed-out user to a bare
 * /login would drop the one piece of information that lets them get back in
 * without being asked for a business code they may never have been told. */
function handleUnauthorized(path: string) {
  if (typeof window === "undefined") return;
  if (path.startsWith("/auth/")) return;
  const slug = activeBusinessSlug();
  clearSession(slug);
  // A host-resolved tenant's address bar never had the slug in it — don't
  // write one back in when bouncing to the sign-in page. A path-resolved
  // slug, or the bare-install fallback with no path/host match at all, keep
  // carrying it forward exactly as before.
  const { slug: resolvedSlug, fromPath } = resolveActiveSlug();
  const includeInUrl = resolvedSlug === null || fromPath;
  const target = loginPath(slug, includeInUrl);
  if (window.location.pathname !== target) {
    window.location.href = target;
  }
}

/* A 403 must be visible, not just thrown. The bootstrap permissions call is
 * excluded: it has its own retry state, and reacting to it would loop. */
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

/* apiFetchEnveloped is apiFetch's counterpart for backend modules that have
 * been migrated to the house response envelope ({success, data} / {success,
 * error}) — see backend/internal/platform/httpx. Only call this for a module
 * whose Go handlers have actually been migrated (branch is the first);
 * every other module still returns the old bare-resource shape and must keep
 * using apiFetch until its own handlers move over. Once every module has
 * migrated, this replaces apiFetch outright and this comment goes away. */
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
  // Most success responses carry the resource under `data`; a
  // delete/action-confirmation response instead carries a plain string
  // under `message` (see httpx.SuccessMessage) — fall back to that so
  // callers expecting a confirmation string still get one.
  return (body?.data !== undefined ? body.data : body?.message) as T;
}

/* apiFetchEnvelope is apiFetchEnveloped's counterpart for the rare endpoint
 * whose envelope carries more than just {success, data} — e.g.
 * GET /employees/:id/permissions also returns a top-level `role` field
 * alongside `data` (see internal/authz.Handler.Matrix). Returns the whole
 * parsed body so the caller can read whichever extra fields it needs. */
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

/* Like apiFetch, but for multipart file uploads — deliberately does NOT set
 * a Content-Type header, so the browser can set its own with the correct
 * multipart boundary (apiFetch's default "application/json" would break
 * a FormData body). Used by modules/customers/services/customerService.ts's uploadFile(). */
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

/* apiUploadEnveloped is apiUpload's counterpart for the now-migrated
 * `upload` module ({success, data: {url}} — see backend/internal/upload). */
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
