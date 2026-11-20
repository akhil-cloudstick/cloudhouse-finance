import { apiFetchEnveloped as apiFetch, ApiError } from "@/common/services/httpClient";
import { enqueueAndWait, newEntry, offlineReady } from "@/common/offline";
import { currentActor } from "@/common/offline/actor";
import { localRequestId } from "@/common/offline/requestRef";
import type { BackendPurityStandard } from "@/modules/purity-standards/types/purity-standard-types";

export async function searchPurityStandards(q: string): Promise<BackendPurityStandard[]> {
  const rec = await apiFetch<BackendPurityStandard[]>(`/purity-standards?q=${encodeURIComponent(q)}`);
  return rec || [];
}

/* Page-shaped wrapper for SearchableSelect's fetchFn contract — the
 * purity-standard list is small reference data (24K down to 10K plus any
 * staff-created custom entries), same unpaginated pattern as
 * modules/ornament-types/services/ornamentTypeService.ts and
 * modules/banks/services/bankService.ts. */
export async function searchPurityStandardsPage(q: string, page: number): Promise<{ items: BackendPurityStandard[]; hasMore: boolean }> {
  if (page > 0) return { items: [], hasMore: false };
  return { items: await searchPurityStandards(q), hasMore: false };
}

/* Creates a new purity standard from a single karat value (or — if one
 * already exists for that karat — returns the existing row, the backend's
 * find-or-create behaviour). */
export async function createPurityStandardByKarat(karat: number): Promise<BackendPurityStandard> {
  if (offlineReady()) {
    // the server's own range check (ValidateKarat), then find-or-create: a karat already on the list is returned as it is
    if (!Number.isInteger(karat) || karat < 10 || karat > 24) throw new ApiError("karat must be between 10 and 24", 400);
    const existing = (await searchPurityStandards("")).find((p) => p.karat === karat);
    if (existing) return existing;
    return queuePurity({ karat });
  }
  return apiFetch<BackendPurityStandard>("/purity-standards", {
    method: "POST",
    body: JSON.stringify({ karat }),
  });
}

/* Offline: the new standard goes into the outbox and is on the list at once (see referenceAdjust.ts); the server's own row
 * replaces it after the send. */
async function queuePurity(body: { karat?: number; finenessPercent?: number }): Promise<BackendPurityStandard> {
  const entry = newEntry("POST", "/purity-standards", body, currentActor());
  entry.targets = [entry.id];
  await enqueueAndWait(entry, () => undefined);
  const now = new Date().toISOString();
  const karat = body.karat ?? null;
  const fineness = body.finenessPercent ?? (karat !== null ? Math.round((karat / 24) * 1000) / 10 : null);
  return { id: localRequestId(entry.id), karat, finenessPercent: fineness, label: karat !== null ? `${karat}K` : `${body.finenessPercent}%`, isActive: true, createdAt: now, updatedAt: now };
}

/* Same, from a fineness% value instead. */
export async function createPurityStandardByFineness(finenessPercent: number): Promise<BackendPurityStandard> {
  if (offlineReady()) {
    if (!(finenessPercent > 0 && finenessPercent <= 100)) throw new ApiError("fineness% must be greater than 0 and at most 100", 400);
    const existing = (await searchPurityStandards("")).find((p) => p.finenessPercent !== null && Math.round(p.finenessPercent * 10) === Math.round(finenessPercent * 10));
    if (existing) return existing;
    return queuePurity({ finenessPercent });
  }
  return apiFetch<BackendPurityStandard>("/purity-standards", {
    method: "POST",
    body: JSON.stringify({ finenessPercent }),
  });
}
