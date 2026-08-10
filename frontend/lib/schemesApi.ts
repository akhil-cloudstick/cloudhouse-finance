import { apiFetch } from "@/lib/api";

/* Shape returned by the Go backend (backend/internal/scheme/model.go). */
export type BackendScheme = {
  id: number;
  code: string;
  name: string;
  interestRate: number;
  startDate: string; // RFC3339
  endDate: string;
  ltvPercent: number;
  interestMethod: string;
  penalRate: number;
  conditions: string;
  isActive: boolean;
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
};

function monthsBetween(start: string, end: string): number {
  const s = new Date(start);
  const e = new Date(end);
  const months = (e.getFullYear() - s.getFullYear()) * 12 + (e.getMonth() - s.getMonth());
  return Math.max(1, months);
}

function toView(s: BackendScheme): SchemeView {
  return {
    id: String(s.id),
    code: s.code,
    name: s.name,
    rate: s.interestRate,
    durationMonths: monthsBetween(s.startDate, s.endDate),
    ltv: s.ltvPercent,
    method: s.interestMethod,
    penal: s.penalRate,
    cond: s.conditions,
    active: s.isActive,
  };
}

function toRequestBody(input: SchemeFormInput) {
  // The backend models a scheme's StartDate/EndDate as its overall validity
  // window (when the scheme program is offered), not a per-loan tenure. We
  // start that window today and run it for the chosen duration.
  const start = new Date();
  const end = new Date(start);
  end.setMonth(end.getMonth() + input.durationMonths);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);

  return {
    name: input.name,
    interestRate: input.rate,
    startDate: fmt(start),
    endDate: fmt(end),
    ltvPercent: input.ltv,
    interestMethod: input.method,
    penalRate: input.penal,
    conditions: input.cond,
    isActive: input.active,
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
