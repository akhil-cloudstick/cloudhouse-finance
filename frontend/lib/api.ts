/* Thin fetch wrapper for the Go backend (Gin, `/api/v1/...`). In production
 * the backend serves the built frontend from the same origin, so requests
 * can go to a relative `/api/v1` path. In dev (`next dev` on its own port)
 * point NEXT_PUBLIC_API_BASE at the backend, e.g. http://localhost:8080/api/v1.
 */
export const API_BASE = process.env.NEXT_PUBLIC_API_BASE || "/api/v1";

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export async function apiFetch<T>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { "Content-Type": "application/json", ...(opts?.headers || {}) },
    ...opts,
  });
  if (!res.ok) {
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

/* Like apiFetch, but for multipart file uploads — deliberately does NOT set
 * a Content-Type header, so the browser can set its own with the correct
 * multipart boundary (apiFetch's default "application/json" would break
 * a FormData body). Used by lib/customersApi.ts's uploadFile(). */
export async function apiUpload<T>(path: string, formData: FormData): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, { method: "POST", body: formData });
  if (!res.ok) {
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
