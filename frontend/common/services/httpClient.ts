/* Thin fetch wrapper for the Go backend (Gin, `/api/v1/...`). In production
 * the backend serves the built frontend from the same origin, so requests
 * can go to a relative `/api/v1` path. In dev (`next dev` on its own port)
 * point NEXT_PUBLIC_API_BASE at the backend, e.g. http://localhost:8080/api/v1.
 */
export const API_BASE = process.env.NEXT_PUBLIC_API_BASE || "/api/v1";

/* localStorage keys for the JWT session — shared with common/auth-context.tsx,
 * which is the only other module that reads/writes them (keeps the token
 * source-of-truth in one place while letting this fetch wrapper attach the
 * header without importing React). */
export const AUTH_TOKEN_KEY = "ambikagold_token";
export const AUTH_EMPLOYEE_KEY = "ambikagold_employee";

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(AUTH_TOKEN_KEY);
}

function authHeader(): Record<string, string> {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/* Called whenever the backend rejects a request with 401 — clears the
 * stored session and bounces to /login. Skipped for the /auth/* endpoints
 * themselves: a wrong password on /auth/login is an expected 401 that the
 * login form needs to show inline, not a reason to force-navigate away. */
function handleUnauthorized(path: string) {
  if (typeof window === "undefined") return;
  if (path.startsWith("/auth/")) return;
  window.localStorage.removeItem(AUTH_TOKEN_KEY);
  window.localStorage.removeItem(AUTH_EMPLOYEE_KEY);
  if (window.location.pathname !== "/login") {
    window.location.href = "/login";
  }
}

export async function apiFetch<T>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { "Content-Type": "application/json", ...authHeader(), ...(opts?.headers || {}) },
    ...opts,
  });
  if (!res.ok) {
    if (res.status === 401) handleUnauthorized(path);
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
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { "Content-Type": "application/json", ...authHeader(), ...(opts?.headers || {}) },
    ...opts,
  });
  let body: { success?: boolean; data?: T; message?: unknown; error?: string } | undefined;
  try {
    body = res.status === 204 ? undefined : await res.json();
  } catch {
    /* non-JSON body — handled below via res.ok/res.statusText */
  }
  if (!res.ok || body?.success === false) {
    if (res.status === 401) handleUnauthorized(path);
    throw new ApiError(body?.error || res.statusText, res.status);
  }
  // Most success responses carry the resource under `data`; a
  // delete/action-confirmation response instead carries a plain string
  // under `message` (see httpx.SuccessMessage) — fall back to that so
  // callers expecting a confirmation string still get one.
  return (body?.data !== undefined ? body.data : body?.message) as T;
}

/* Like apiFetch, but for multipart file uploads — deliberately does NOT set
 * a Content-Type header, so the browser can set its own with the correct
 * multipart boundary (apiFetch's default "application/json" would break
 * a FormData body). Used by modules/customers/services/customerService.ts's uploadFile(). */
export async function apiUpload<T>(path: string, formData: FormData): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: { ...authHeader() },
    body: formData,
  });
  if (!res.ok) {
    if (res.status === 401) handleUnauthorized(path);
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
  const res = await fetch(`${API_BASE}${path}`, {
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
    if (res.status === 401) handleUnauthorized(path);
    throw new ApiError(body?.error || res.statusText, res.status);
  }
  return body?.data as T;
}
