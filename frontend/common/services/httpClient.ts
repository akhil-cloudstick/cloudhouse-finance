import {
  activeBusinessSlug,
  clearSession,
  loginPath,
  readToken,
  resolveActiveSlug,
} from "@/common/services/tenantSession";
import { setReachable } from "@/common/offline/network";
import { branchHeader, SELECTED_BRANCH_HEADER } from "@/common/services/branchSelection";
import { fromApi, toApi } from "@/common/services/apiContract";
import { branchScoped, cacheable, recall, remember } from "@/common/offline/readCache";
import { localGet } from "@/common/offline/localApi";
import { offlineReady } from "@/common/offline/state";
import { signHeaders } from "@/common/offline/device";

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
 * point NEXT_PUBLIC_API_BASE at the backend, e.g. http://localhost:8090/api/v1.
 */

export const API_BASE = isDevelopment ? DEV_URL : PROD_URL;

/* resolveAssetUrl turns a backend-relative path (logo_url, /uploads/...) into
 * one that actually loads. Every such path comes back from the API as
 * same-origin-relative, which is correct on the web (the Go binary serves
 * both the API and this build from one origin) — but the desktop app's
 * webview has its OWN origin (wails.localhost), unrelated to whichever
 * tenant backend API_BASE points to, so a relative path there resolves
 * against the wrong host and 404s/500s.
 *
 * API_BASE already carries the real backend's origin whenever it's a full
 * URL (desktop builds, or NEXT_PUBLIC_API_BASE set for any other reason);
 * when it's the normal relative "/api/v1" (same-origin web/production), this
 * is a no-op and the path is returned unchanged. */
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
export const UNREACHABLE_EVENT = "app:server-unreachable";
const QUIET_PATH = /\/(sync\/pull|devices|uploads)(\/|\?|$)/;
// the offline table copy (see common/offline/mirrorSync.ts): answers keep the server's own field names
const VERBATIM_PATH = /\/sync\/(tables|table|children)(\/|\?|$)/;
let quietDepth = 0;

/* Runs background work whose failures must not raise the pop-up. */
export async function quietly<T>(fn: () => Promise<T>): Promise<T> {
  quietDepth++;
  try {
    return await fn();
  } finally {
    quietDepth--;
  }
}

async function networkFetch(url: string, init?: RequestInit): Promise<Response> {
  try {
    const res = await fetch(url, init);
    setReachable(true); // any answer, even an error status, means the server is there
    return res;
  } catch (e) {
    if (e instanceof TypeError) {
      setReachable(false);
      throw new ApiError("Couldn't reach the server. Check your connection and try again.", 0);
    }
    throw e;
  }
}

/* Every request goes through the backend contract adapter (common/services/apiContract.ts):
 * paths, verbs, query and body move to the current API, and JSON responses come back
 * in the shapes the screens already read. */
async function contractFetch(path: string, init?: RequestInit, signed = false): Promise<Response> {
  // the identity in the path is the principal of the token this request actually carries (staff or superadmin)
  const sent = new Headers(init?.headers).get("Authorization")?.replace(/^Bearer\s+/i, "") || null;
  const req = toApi(init?.method ?? "GET", path, init?.body ?? undefined, sent ?? readToken());
  if (signed) {
    // entries replayed from the outbox prove which PC sent them: HMAC of the exact bytes that go on the wire
    const proof = await signHeaders(typeof req.body === "string" ? req.body : "");
    init = { ...init, headers: { ...Object.fromEntries(new Headers(init?.headers).entries()), ...proof } };
  }
  const keep = cacheable(req.method, req.path);
  // the branch the request is for is the one it actually carries (the warm-up asks for each branch in turn)
  const sentBranch = new Headers(init?.headers).get(SELECTED_BRANCH_HEADER);
  const view = keep ? JSON.stringify(sentBranch && branchScoped(req.path) ? { [SELECTED_BRANCH_HEADER]: sentBranch } : {}) : "";
  let res: Response;
  try {
    res = await networkFetch(`${API_BASE}${req.path}`, { ...init, method: req.method, body: req.body as BodyInit | undefined });
  } catch (e) {
    // No answer at all (offline mode only): show what this PC last saw for the same request.
    if (keep && e instanceof ApiError && e.status === 0) {
      const hit = await recall(req.path, view);
      if (hit !== null) return new Response(hit, { status: 200, headers: { "content-type": "application/json", "X-From-Cache": "true" } });
    }
    // Nothing was kept for this read: this PC's own copy of the business answers it, with the backend's own route code
    if (e instanceof ApiError && e.status === 0 && req.method === "GET" && !signed && offlineReady()) {
      const local = await localGet(req.path, sentBranch);
      if (local !== null) {
        let adapted = local;
        try {
          adapted = JSON.stringify(fromApi(JSON.parse(local), req));
        } catch {
          /* an answer that is not JSON is passed on as it is */
        }
        return new Response(adapted, { status: 200, headers: { "content-type": "application/json", "X-From-Local": "true" } });
      }
    }
    // A read with nothing kept for it while offline mode is running fails without the "couldn't reach" wording, so
    // no page shows that warning: the PC is expected to be offline and the page simply has nothing to list.
    if (e instanceof ApiError && e.status === 0 && offlineReady() && req.method === "GET" && !signed) throw new ApiError("", 0);
    // Nothing to show instead: a pop-up as well as the text in the page, except for reads while offline mode is running (the
    // PC is expected to be offline then, so the page's own text is enough; a save that cannot be queued still warns). Background work (the sync, the warm-up)
    // never raises it, and a screen answered from the PC's own copy never reaches here.
    if (e instanceof ApiError && e.status === 0 && !signed && quietDepth === 0 && !(offlineReady() && req.method === "GET") && !QUIET_PATH.test(req.path) && typeof window !== "undefined") {
      window.dispatchEvent(new Event(UNREACHABLE_EVENT));
      // The toast carries the wording; an empty message keeps forms from printing the same text inline as well.
      throw new ApiError("", 0);
    }
    throw e;
  }
  if (!(res.headers.get("content-type") ?? "").includes("application/json")) return res;
  const text = await res.text();
  let adapted = text;
  try {
    // the table copy is stored under the server's own column names, so those answers are not reshaped for the screens
    adapted = text && !VERBATIM_PATH.test(req.path) ? JSON.stringify(fromApi(JSON.parse(text), req)) : text;
  } catch {
    /* not valid JSON despite the header: hand it back untouched */
  }
  if (keep && res.ok) remember(req.path, view, adapted);
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
  return networkFetch(resolveAssetUrl(url), { headers: authHeader() });
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

/* Fetches a path only so its answer is kept for offline use (see common/offline/readCache.ts). It never
 * reports a failure and never triggers the sign-in or "forbidden" handling: a role that may not see a list
 * just has nothing to keep. */
export async function warmGet(path: string, branch?: number | null): Promise<void> {
  try {
    await contractFetch(path, { headers: warmHeaders(branch) });
  } catch {
    /* nothing to keep */
  }
}

/* The headers for a warm-up request: the current branch view, or, when `branch` is given, that branch (null = all
 * branches), so each branch gets its own copy without touching what the person is looking at. */
function warmHeaders(branch?: number | null): Record<string, string> {
  const h = jsonHeaders();
  if (branch === undefined) return h;
  delete h[SELECTED_BRANCH_HEADER];
  if (branch) h[SELECTED_BRANCH_HEADER] = String(branch);
  return h;
}

/* Like warmGet, but hands back the parsed answer (null when there is none). */
export async function warmJson(path: string, branch?: number | null): Promise<unknown | null> {
  try {
    const res = await contractFetch(path, { headers: warmHeaders(branch) });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

/* Keeps a whole paged list on this PC, however long it is. The server answers at most 500 rows at a time, so every page is fetched
 * and the rows are joined into ONE answer kept as the "big" copy of the list: offline, any page, search or filter of that list is
 * cut from it (readCache.ts). A path that is not a paged {items, hasMore} list is simply kept as the single answer it gives. */
export async function warmAllPages(path: string, branch?: number | null): Promise<unknown[] | null> {
  const PAGE = 500;
  const [base, query = ""] = path.split("?");
  const qs = new URLSearchParams(query);
  qs.delete("limit");
  qs.delete("offset");
  const at = (offset: number, limit: number) => {
    const p = new URLSearchParams(qs);
    p.set("limit", String(limit));
    p.set("offset", String(offset));
    return `${base}?${p}`;
  };
  const headers = warmHeaders(branch);
  type PagedAnswer = { data?: { items?: unknown[]; hasMore?: boolean } } | null;
  let env: PagedAnswer = null;
  const all: unknown[] = [];
  let firstOfPrev = "";
  try {
    for (let offset = 0; offset < 2_000_000; offset += PAGE) {
      const res = await contractFetch(at(offset, PAGE), { headers });
      if (!res.ok) return null;
      const json = (await res.json()) as PagedAnswer;
      const data = json?.data;
      if (!data || !Array.isArray(data.items)) return null; // not a paged list: the single answer is already kept
      // a server that ignores the offset would answer the same page for ever
      const first = data.items.length ? JSON.stringify(data.items[0]) : "";
      if (offset > 0 && first && first === firstOfPrev) break;
      firstOfPrev = first;
      env = json;
      all.push(...data.items);
      if (!data.hasMore || data.items.length === 0) break;
    }
  } catch {
    return null;
  }
  if (!env?.data) return null;
  const merged = JSON.stringify({ ...env, data: { ...env.data, items: all, hasMore: false, total: all.length, limit: 100000, offset: 0 } });
  const req = toApi("GET", at(0, 100000), undefined, readToken());
  if (!cacheable(req.method, req.path)) return all;
  const sentBranch = new Headers(headers).get(SELECTED_BRANCH_HEADER);
  remember(req.path, JSON.stringify(sentBranch && branchScoped(req.path) ? { [SELECTED_BRANCH_HEADER]: sentBranch } : {}), merged);
  return all;
}

/* One queued offline entry sent to the server as the same request the app makes today, plus the
 * entry's UUID and the moment the user clicked. "saved" and "duplicate" both mean the server has it, so the
 * line can go; anything else (no answer, timeout, a server error) means keep the line and try again.
 * A rejected session never bounces to the login page here: a replay is background work. */
export type ReplayOutcome = "saved" | "duplicate" | "retry";
export type ReplayResult = { outcome: ReplayOutcome; status: number; body?: unknown; message?: string };

export async function replayRequest(req: {
  method: string;
  path: string;
  body?: unknown;
  clientUuid: string;
  occurredAt: string;
}): Promise<ReplayResult> {
  let res: Response;
  try {
    res = await contractFetch(
      req.path,
      {
        method: req.method,
        headers: { ...jsonHeaders(), "X-Client-Uuid": req.clientUuid, "X-Occurred-At": req.occurredAt },
        body: req.body === undefined ? undefined : JSON.stringify(req.body),
      },
      true,
    );
  } catch (e) {
    return { outcome: "retry", status: e instanceof ApiError ? e.status : 0, message: e instanceof Error ? e.message : String(e) };
  }
  let body: unknown;
  try {
    body = res.status === 204 ? undefined : await res.json();
  } catch {
    /* an empty or non-JSON body still carries the status */
  }
  if (res.ok) return { outcome: res.headers.get("X-Sync-Duplicate") === "true" ? "duplicate" : "saved", status: res.status, body };
  const message = (body as { error?: string } | undefined)?.error || res.statusText;
  return { outcome: "retry", status: res.status, body, message };
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
