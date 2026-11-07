import { apiFetchEnveloped as apiFetch, apiRawFetch, getAuthToken, ApiError } from "@/common/services/httpClient";
import { branchHeader } from "@/common/services/branchSelection";
import { enqueueAndWait, listLocal, newEntry, offlineReady, removeLocal, upsertLocal, type LocalRecord } from "@/common/offline";
import { currentActor } from "@/common/offline/actor";
import { recordList } from "@/common/offline/validate";
import { canMakeOffline } from "@/common/offline/documents";
import { exportTable, type ExportCell } from "@/common/offline/exports";
import { offlineStore } from "@/common/services/desktopBridge";
import type { BackendScheme, SchemeView, SchemeFormInput, SchemeStatementFilters } from "@/modules/schemes/types/scheme-types";

function toView(s: BackendScheme): SchemeView {
  return {
    // a scheme the server has not numbered yet is known by the id the PC gave it
    id: s.id ? String(s.id) : s.uuid ? `uuid:${s.uuid}` : "",
    code: s.code,
    name: s.name,
    rate: s.interestRate,
    rateTiers: s.rateTiers || [],
    minimumDays: s.minimumDays || 0,
    durationMonths: s.durationMonths,
    ltv: s.ltvPercent,
    method: s.interestMethod,
    penal: s.penalRate,
    accrualBasis: s.accrualBasis || "daily",
    cond: s.conditions,
    active: s.isActive,
    branchId: s.branchId,
    branchName: s.branch?.name || "",
    serviceChargeType: s.serviceChargeType || "None",
    serviceChargeValue: s.serviceChargeValue || 0,
    serviceChargeMode: s.serviceChargeMode || "WithheldFromPayout",
  };
}

function toRequestBody(input: SchemeFormInput) {
  return {
    name: input.name,
    interestRate: input.rate,
    rateTiers: input.rateTiers,
    minimumDays: input.minimumDays,
    durationMonths: input.durationMonths,
    ltvPercent: input.ltv,
    interestMethod: input.method,
    penalRate: input.penal,
    accrualBasis: input.accrualBasis,
    conditions: input.cond,
    isActive: input.active,
    branchId: input.branchId,
    serviceChargeType: input.serviceChargeType,
    serviceChargeValue: input.serviceChargeType === "None" ? 0 : input.serviceChargeValue,
    serviceChargeMode: input.serviceChargeType === "None" ? undefined : input.serviceChargeMode,
  };
}

/* Server-side search. `q` matches scheme name, code, LTV % and duration
 * (months); `methods` narrows to those interest calculation methods. */
/* Schemes made on this PC that the server has not accepted yet, narrowed like the server would. */
type SchemeLocal = BackendScheme & { editOf?: number; deleteOf?: number };

function localSchemes(): SchemeLocal[] {
  return offlineReady() ? (listLocal("schemes") as unknown as SchemeLocal[]) : [];
}

/* The server's schemes with this PC's waiting edits and deletes applied. */
function overlaid(items: SchemeView[]): SchemeView[] {
  const rows = localSchemes();
  if (!rows.length) return items;
  const gone = new Set(rows.filter((r) => r.deleteOf !== undefined).map((r) => String(r.deleteOf)));
  return items
    .filter((i) => !gone.has(i.id))
    .map((i) => {
      let next = i;
      for (const r of rows) if (r.editOf !== undefined && String(r.editOf) === i.id) next = { ...toView({ ...r, id: Number(i.id) } as BackendScheme), id: i.id, code: i.code };
      return next;
    });
}

/* The server's answer when there is one; when there is none at all (offline) only what this PC holds. */
async function orPending<T>(live: () => Promise<T>, none: () => T): Promise<T> {
  try {
    return await live();
  } catch (e) {
    if (offlineReady() && e instanceof ApiError && e.status === 0) return none();
    throw e;
  }
}

function pendingSchemes(q = "", methods?: string[], activeOnly = false): SchemeView[] {
  if (!offlineReady()) return [];
  const needle = q.trim().toLowerCase();
  return localSchemes()
    .filter((s) => s.editOf === undefined && s.deleteOf === undefined)
    .filter((s) => !activeOnly || s.isActive)
    .filter((s) => !methods?.length || methods.includes(s.interestMethod))
    .filter((s) => !needle || [s.name, String(s.ltvPercent), String(s.durationMonths)].join(" ").toLowerCase().includes(needle))
    .map(toView);
}

export async function listSchemes(filters?: { q?: string; methods?: string[] }): Promise<SchemeView[]> {
  const live = await orPending(() => listSchemesLive(filters), () => []);
  return [...overlaid(live), ...pendingSchemes(filters?.q, filters?.methods)];
}

async function listSchemesLive(filters?: { q?: string; methods?: string[] }): Promise<SchemeView[]> {
  const params = new URLSearchParams();
  if (filters?.q) params.set("q", filters.q);
  if (filters?.methods?.length) params.set("method", filters.methods.join(","));
  const qs = params.toString();
  const rec = await apiFetch<BackendScheme[]>(`/schemes${qs ? `?${qs}` : ""}`);
  return (rec || []).map(toView);
}

/* One page of the Loan Schemes list — same search/method filters as
 * listSchemes, paged server-side ({items, hasMore, total} envelope).
 * `page` is 0-based. */
export async function listSchemesPage(
  filters: { q?: string; methods?: string[]; status?: string },
  page: number,
  limit: number
): Promise<{ items: SchemeView[]; hasMore: boolean }> {
  const params = new URLSearchParams({ limit: String(limit), offset: String(page * limit) });
  if (filters.q) params.set("q", filters.q);
  if (filters.methods?.length) params.set("method", filters.methods.join(","));
  if (filters.status) params.set("status", filters.status);
  const rec = await apiFetch<{ items: BackendScheme[] | null; hasMore: boolean }>(`/schemes?${params}`);
  const items = (rec?.items || []).map(toView);
  // the first page also lists schemes made on this PC that are still waiting to be sent
  return { items: page === 0 ? [...overlaid(items), ...pendingSchemes(filters.q, filters.methods)] : overlaid(items), hasMore: !!rec?.hasMore };
}

/* Server-side search (by name) across active schemes only — backs
 * SearchableSelect pickers (see NewLoan.tsx). */
export async function searchActiveSchemes(q: string): Promise<SchemeView[]> {
  const rec = await apiFetch<BackendScheme[]>(`/schemes/active?q=${encodeURIComponent(q)}`);
  return [...overlaid((rec || []).map(toView)).filter((s) => s.active), ...pendingSchemes(q, undefined, true)];
}

const SCHEME_PAGE_SIZE = 5;

/* Paginated variant of searchActiveSchemes — backs SearchableSelect's
 * infinite scroll (see SearchableSelect.tsx). `page` is 0-based; the
 * backend responds with an {items, hasMore} envelope whenever `limit` is
 * passed (see backend/internal/scheme/handler.go's ListActive). */
export async function searchActiveSchemesPage(q: string, page: number): Promise<{ items: SchemeView[]; hasMore: boolean }> {
  const params = new URLSearchParams({ q, limit: String(SCHEME_PAGE_SIZE), offset: String(page * SCHEME_PAGE_SIZE) });
  const rec = await apiFetch<{ items: BackendScheme[]; hasMore: boolean }>(`/schemes/active?${params}`);
  const items = (rec?.items || []).map(toView);
  const current = overlaid(items).filter((s) => s.active);
  return { items: page === 0 ? [...current, ...pendingSchemes(q, undefined, true)] : current, hasMore: !!rec?.hasMore };
}

export async function createScheme(input: SchemeFormInput): Promise<SchemeView> {
  // Desktop: the scheme goes into the outbox first, is listed at once from this PC, and is sent from there.
  if (offlineReady()) {
    const entry = newEntry("POST", "/schemes", toRequestBody(input), currentActor());
    entry.targets = [entry.id];
    const draft = {
      uuid: entry.id, id: 0, code: "", name: input.name, interestRate: input.rate, rateTiers: input.rateTiers,
      minimumDays: input.minimumDays, durationMonths: input.durationMonths, ltvPercent: input.ltv,
      interestMethod: input.method, penalRate: input.penal, conditions: input.cond, isActive: input.active,
      branchId: input.branchId, serviceChargeType: input.serviceChargeType, serviceChargeValue: input.serviceChargeValue,
    } as BackendScheme;
    await enqueueAndWait(
      entry,
      () => upsertLocal("schemes", draft as unknown as LocalRecord),
      () => removeLocal("schemes", entry.id),
    );
    return toView(draft);
  }
  const rec = await apiFetch<BackendScheme>("/schemes", {
    method: "POST",
    body: JSON.stringify(toRequestBody(input)),
  });
  return toView(rec);
}

/* A scheme made on this PC and not sent yet is known as "uuid:<id>"; the server has nothing to change or delete until it is sent. */
const NOT_SENT = "This scheme has not reached the server yet. Try again once it has synced.";

export async function updateScheme(id: string, input: SchemeFormInput): Promise<SchemeView> {
  // Desktop: the edit goes into the outbox and the list shows it at once (see overlaid); the sender puts it.
  if (offlineReady()) {
    if (!/^\d+$/.test(id)) throw new ApiError(NOT_SENT, 409);
    const body = toRequestBody(input);
    const entry = newEntry("PUT", `/schemes/${id}`, body, currentActor());
    entry.targets = [entry.id];
    const draft = {
      uuid: entry.id, editOf: Number(id), id: 0, code: "", name: input.name, interestRate: input.rate, rateTiers: input.rateTiers,
      minimumDays: input.minimumDays, durationMonths: input.durationMonths, ltvPercent: input.ltv, interestMethod: input.method,
      penalRate: input.penal, accrualBasis: input.accrualBasis, conditions: input.cond, isActive: input.active, branchId: input.branchId,
      serviceChargeType: input.serviceChargeType, serviceChargeValue: body.serviceChargeValue, serviceChargeMode: body.serviceChargeMode,
    } as unknown as SchemeLocal;
    await enqueueAndWait(entry, () => upsertLocal("schemes", draft as unknown as LocalRecord), () => removeLocal("schemes", entry.id));
    return { ...toView({ ...draft, id: Number(id) } as BackendScheme), id };
  }
  const rec = await apiFetch<BackendScheme>(`/schemes/${id}`, {
    method: "PUT",
    body: JSON.stringify(toRequestBody(input)),
  });
  return toView(rec);
}

/* The server will not delete a scheme a loan uses (deleteScheme in the backend); the loans this PC holds are compared here, so
 * the delete is refused now, with the server's words, instead of being queued and refused later. */
function checkSchemeDeleteLocally(id: string): void {
  const used = (listLocal("loans") as unknown as { schemeId?: number; loanNumber?: string }[]).filter((l) => String(l.schemeId) === id);
  if (used.length > 0) throw new ApiError(`Cannot delete this scheme — it is used by ${used.length} loan(s) (${recordList(used.map((l) => String(l.loanNumber)), used.length)}). Deactivate it instead.`, 409);
}

export async function deleteScheme(id: string): Promise<void> {
  if (offlineReady()) {
    if (!/^\d+$/.test(id)) throw new ApiError(NOT_SENT, 409);
    checkSchemeDeleteLocally(id);
    const entry = newEntry("DELETE", `/schemes/${id}`, undefined, currentActor());
    entry.targets = [entry.id];
    const mark = { uuid: entry.id, deleteOf: Number(id) } as unknown as LocalRecord;
    await enqueueAndWait(entry, () => upsertLocal("schemes", mark), () => removeLocal("schemes", entry.id));
    return;
  }
  await apiFetch<void>(`/schemes/${id}`, { method: "DELETE" });
}

/* Downloads GET /schemes/:id/statement?...&format=pdf|xlsx as a blob and
 * triggers a browser save — same object-URL + anchor-click pattern as
 * reportsService.ts's exportReport, since it needs the raw fetch Response
 * for blob handling rather than apiFetch's JSON envelope. */
async function downloadSchemeStatementOnline(
  id: string,
  format: "pdf" | "xlsx",
  filters: SchemeStatementFilters
): Promise<void> {
  const params = new URLSearchParams({ format });
  if (filters.from) params.set("from", filters.from);
  if (filters.to) params.set("to", filters.to);
  if (filters.loanIds?.length) params.set("loanIds", filters.loanIds.join(","));

  const token = typeof window !== "undefined" ? getAuthToken() : null;
  const res = await apiRawFetch(`/schemes/${id}/statement?${params.toString()}`, {
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...branchHeader() },
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

/* Same columns as the server's statement; offline the loans (and their payments) come from the saved copy. */
export async function downloadSchemeStatement(id: string, format: "pdf" | "xlsx", filters: SchemeStatementFilters): Promise<void> {
  try {
    await downloadSchemeStatementOnline(id, format, filters);
  } catch (e) {
    if (!canMakeOffline(e)) throw e;
    const { listLoansPage } = await import("@/modules/loans/services/loanService");
    const r = await listLoansPage({ schemeId: Number(id), from: filters.from, to: filters.to, page: 1, limit: 5000 });
    const pick = filters.loanIds?.length ? new Set(filters.loanIds) : null;
    const rows: ExportCell[][] = [];
    for (const l of r.items) {
      if (pick && !pick.has(l.numericId)) continue;
      const base: ExportCell[] = [l.loanNumber, l.customerName, l.opened, l.principal];
      if (!l.payments.length) { rows.push([...base, "", "", "", "", "", ""]); continue; }
      for (const p of l.payments) rows.push([...base, p.paidOn, p.type, p.amount, p.interestApplied, p.principalApplied, p.runningBalance]);
    }
    await exportTable(format, {
      title: "Scheme Statement", filename: `scheme-${id}-statement`,
      subtitle: filters.from || filters.to ? `${filters.from || "…"} – ${filters.to || "…"}` : undefined,
      headers: ["Loan Number", "Customer", "Opened", "Principal", "Payment Date", "Type", "Amount", "Interest", "Principal Applied", "Balance"],
      rows,
    });
  }
}
