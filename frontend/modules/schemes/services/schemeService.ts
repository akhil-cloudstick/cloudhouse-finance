import { apiFetchEnveloped as apiFetch, API_BASE, getAuthToken, ApiError } from "@/common/services/httpClient";

/* Shape returned by the Go backend (backend/internal/scheme/model.go). A
 * scheme's tenure is a real field now — no more start/end date window. */
export type BackendScheme = {
  id: number;
  code: string;
  name: string;
  interestRate: number;
  durationMonths: number;
  ltvPercent: number;
  interestMethod: string;
  penalRate: number;
  conditions: string;
  isActive: boolean;
  branchId: number;
  branch?: { id: number; name: string; code?: string };
};

/* Shape the Schemes UI renders — closer to how a scheme is described on
 * screen (a tenure in months rather than a start/end validity window). */
export type SchemeView = {
  id: string; // backend numeric id, stringified — used for update/delete/toggle
  code: string;
  name: string;
  rate: number;
  durationMonths: number;
  ltv: number;
  method: string;
  penal: number;
  cond: string;
  active: boolean;
  branchId: number;
  branchName: string;
};

export type SchemeFormInput = {
  name: string;
  rate: number;
  durationMonths: number;
  ltv: number;
  method: string;
  penal: number;
  cond: string;
  active: boolean;
  branchId: number;
};

function toView(s: BackendScheme): SchemeView {
  return {
    id: String(s.id),
    code: s.code,
    name: s.name,
    rate: s.interestRate,
    durationMonths: s.durationMonths,
    ltv: s.ltvPercent,
    method: s.interestMethod,
    penal: s.penalRate,
    cond: s.conditions,
    active: s.isActive,
    branchId: s.branchId,
    branchName: s.branch?.name || "",
  };
}

function toRequestBody(input: SchemeFormInput) {
  return {
    name: input.name,
    interestRate: input.rate,
    durationMonths: input.durationMonths,
    ltvPercent: input.ltv,
    interestMethod: input.method,
    penalRate: input.penal,
    conditions: input.cond,
    isActive: input.active,
    branchId: input.branchId,
  };
}

export async function listSchemes(): Promise<SchemeView[]> {
  const rec = await apiFetch<BackendScheme[]>("/schemes");
  return (rec || []).map(toView);
}

/* Server-side search (by name) across active schemes only — backs
 * SearchableSelect pickers (see NewLoan.tsx). */
export async function searchActiveSchemes(q: string): Promise<SchemeView[]> {
  const rec = await apiFetch<BackendScheme[]>(`/schemes/active?q=${encodeURIComponent(q)}`);
  return (rec || []).map(toView);
}

const SCHEME_PAGE_SIZE = 5;

/* Paginated variant of searchActiveSchemes — backs SearchableSelect's
 * infinite scroll (see SearchableSelect.tsx). `page` is 0-based; the
 * backend responds with an {items, hasMore} envelope whenever `limit` is
 * passed (see backend/internal/scheme/handler.go's ListActive). */
export async function searchActiveSchemesPage(q: string, page: number): Promise<{ items: SchemeView[]; hasMore: boolean }> {
  const params = new URLSearchParams({ q, limit: String(SCHEME_PAGE_SIZE), offset: String(page * SCHEME_PAGE_SIZE) });
  const rec = await apiFetch<{ items: BackendScheme[]; hasMore: boolean }>(`/schemes/active?${params}`);
  return { items: (rec?.items || []).map(toView), hasMore: !!rec?.hasMore };
}

export async function createScheme(input: SchemeFormInput): Promise<SchemeView> {
  const rec = await apiFetch<BackendScheme>("/schemes", {
    method: "POST",
    body: JSON.stringify(toRequestBody(input)),
  });
  return toView(rec);
}

export async function updateScheme(id: string, input: SchemeFormInput): Promise<SchemeView> {
  const rec = await apiFetch<BackendScheme>(`/schemes/${id}`, {
    method: "PUT",
    body: JSON.stringify(toRequestBody(input)),
  });
  return toView(rec);
}

export async function deleteScheme(id: string): Promise<void> {
  await apiFetch<void>(`/schemes/${id}`, { method: "DELETE" });
}

export type SchemeStatementFilters = {
  from?: string; // YYYY-MM-DD
  to?: string; // YYYY-MM-DD
  loanIds?: number[]; // narrows to specific loans; omitted/empty = every loan in range
};

/* Downloads GET /schemes/:id/statement?...&format=pdf|xlsx as a blob and
 * triggers a browser save — same object-URL + anchor-click pattern as
 * reportsService.ts's exportReport, since it needs the raw fetch Response
 * for blob handling rather than apiFetch's JSON envelope. */
export async function downloadSchemeStatement(
  id: string,
  format: "pdf" | "xlsx",
  filters: SchemeStatementFilters
): Promise<void> {
  const params = new URLSearchParams({ format });
  if (filters.from) params.set("from", filters.from);
  if (filters.to) params.set("to", filters.to);
  if (filters.loanIds?.length) params.set("loanIds", filters.loanIds.join(","));

  const token = getAuthToken();
  const res = await fetch(`${API_BASE}/schemes/${id}/statement?${params.toString()}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
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

  const blob = await res.blob();
  const disposition = res.headers.get("Content-Disposition") || "";
  const match = disposition.match(/filename="([^"]+)"/);
  const filename = match ? match[1] : `scheme-${id}-statement.${format}`;

  const url = window.URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.URL.revokeObjectURL(url);
}
