import { apiFetchEnveloped as apiFetch } from "@/common/services/httpClient";
import { enqueueAndWait, listLocal, newEntry, offlineReady, upsertLocal, type LocalRecord } from "@/common/offline";
import { currentActor } from "@/common/offline/actor";
import { createsLocker, findLocalRequest, localRequestId } from "@/common/offline/requestRef";
import type { BackendLocker, LockerFormInput, LockerView } from "@/modules/lockers/types/locker-types";

function toView(l: BackendLocker): LockerView {
  return {
    id: l.id,
    code: l.code,
    branchId: l.branchId,
    branchName: l.branch?.name || "—",
    capacity: l.capacity,
    occupied: l.occupied,
    isActive: l.isActive,
  };
}

/* What this PC holds for lockers until the server has them, three kinds of record: a locker made here (negative
 * id), an edit of a locker the server already has (editOf) and a delete of one (deleteOf). */
type LockerFilter = { branchId?: number[]; q?: string; activeOnly?: boolean; status?: string[] };
type LockerLocal = Partial<LockerView> & { uuid: string; editOf?: number; deleteOf?: number };

function matches(l: LockerView, f: LockerFilter): boolean {
  const needle = (f.q || "").trim().toLowerCase();
  return (
    (!f.branchId?.length || f.branchId.includes(l.branchId)) &&
    (!needle || l.code.toLowerCase().includes(needle)) &&
    (!f.activeOnly || l.isActive) &&
    (!f.status?.length || f.status.map((s) => s.toLowerCase()).includes(l.isActive ? "active" : "inactive"))
  );
}

function localLockers(): LockerLocal[] {
  return offlineReady() ? (listLocal("lockers") as unknown as LockerLocal[]) : [];
}

/* The server's lockers with this PC's waiting deletes and edits applied. */
function overlaid(items: LockerView[]): LockerView[] {
  const rows = localLockers();
  if (!rows.length) return items;
  const gone = new Set(rows.filter((r) => r.deleteOf !== undefined).map((r) => r.deleteOf));
  return items
    .filter((l) => !gone.has(l.id))
    .map((l) => {
      let next = l;
      for (const r of rows) {
        if (r.editOf !== l.id) continue;
        const { uuid, editOf, deleteOf, ...fields } = r;
        void uuid; void editOf; void deleteOf;
        next = { ...next, ...fields };
      }
      return next;
    });
}

/* Lockers made on this PC that the server has not accepted yet. */
function pendingLockers(f: LockerFilter): LockerView[] {
  const rows = localLockers();
  const gone = new Set(rows.filter((r) => r.deleteOf !== undefined).map((r) => r.deleteOf));
  return rows.filter((r) => typeof r.id === "number" && r.id < 0 && !gone.has(r.id)).map((r) => r as LockerView).filter((l) => matches(l, f));
}

export async function listLockers(filters?: { branchId?: number[]; status?: string[] }): Promise<LockerView[]> {
  const params = new URLSearchParams();
  if (filters?.branchId?.length) params.set("branchId", filters.branchId.join(","));
  if (filters?.status?.length) params.set("status", filters.status.join(","));
  const qs = params.toString();
  const rec = await apiFetch<BackendLocker[]>(`/lockers${qs ? `?${qs}` : ""}`);
  const items = overlaid((rec || []).map(toView)).filter((l) => matches(l, filters ?? {}));
  const known = new Set(items.map((i) => i.code.toLowerCase()));
  return [...items, ...pendingLockers(filters ?? {}).filter((l) => !known.has(l.code.toLowerCase()))];
}

/* Server-side paginated + searched locker listing — backs the packet
 * Check-In picker's SearchableSelect. Same q/limit/offset/{items,hasMore}
 * shape as customerService.ts's searchCustomersPage. Page size 5, 0-based
 * pages, matching SearchableSelect's fetchFn contract. */
const LOCKER_PAGE_SIZE = 5;
export async function searchLockersPage(
  q: string,
  page: number,
  opts?: { branchId?: number; activeOnly?: boolean }
): Promise<{ items: LockerView[]; hasMore: boolean; total: number }> {
  const params = new URLSearchParams({ q, limit: String(LOCKER_PAGE_SIZE), offset: String(page * LOCKER_PAGE_SIZE) });
  if (opts?.branchId) params.set("branchId", String(opts.branchId));
  if (opts?.activeOnly) params.set("active", "true");
  const rec = await apiFetch<{ items: BackendLocker[]; hasMore: boolean; total?: number }>(`/lockers?${params}`);
  const filter: LockerFilter = { q, branchId: opts?.branchId ? [opts.branchId] : undefined, activeOnly: opts?.activeOnly };
  const items = overlaid((rec?.items || []).map(toView)).filter((l) => matches(l, filter));
  if (page !== 0) return { items, hasMore: !!rec?.hasMore, total: rec?.total ?? 0 };
  const known = new Set(items.map((i) => i.code.toLowerCase()));
  const pending = pendingLockers(filter).filter((l) => !known.has(l.code.toLowerCase()));
  return { items: [...items, ...pending], hasMore: !!rec?.hasMore, total: (rec?.total ?? 0) + pending.length };
}

export async function getLocker(id: number): Promise<LockerView> {
  if (id < 0 && offlineReady()) {
    const draft = pendingLockers({}).find((l) => l.id === id);
    if (draft) return draft;
    // already sent: the server has it under its own id
    const found = await findLocalRequest(id, createsLocker);
    if (found && "serverId" in found) id = found.serverId;
  }
  const rec = await apiFetch<BackendLocker>(`/lockers/${id}`);
  return overlaid([toView(rec)])[0] ?? toView(rec);
}

export async function createLocker(input: LockerFormInput, branchName?: string): Promise<LockerView> {
  // Desktop: the locker goes into the outbox first, is listed at once, and is sent from there.
  if (offlineReady()) {
    const entry = newEntry("POST", "/lockers", input, currentActor());
    entry.targets = [entry.id];
    // a negative id (stable for this entry) keeps it distinct in pickers; the server's own list replaces it once sent
    const draft: LockerView & { uuid: string } = {
      id: localRequestId(entry.id),
      code: input.code,
      branchId: input.branchId,
      branchName: branchName || "—",
      capacity: input.capacity,
      occupied: 0,
      isActive: input.isActive,
      uuid: entry.id,
    };
    await enqueueAndWait(entry, () => upsertLocal("lockers", draft as unknown as LocalRecord));
    return draft;
  }
  const rec = await apiFetch<BackendLocker>("/lockers", {
    method: "POST",
    body: JSON.stringify(input),
  });
  return toView(rec);
}

/* Where an offline edit or delete of this locker is addressed: a locker made on this PC by the entry that creates it
 * (the sender swaps in the server's id), any other by its id. */
async function target(id: number): Promise<{ path: string; draftUuid?: string; serverId?: number }> {
  if (id > 0) return { path: `/lockers/${id}`, serverId: id };
  const found = await findLocalRequest(id, createsLocker);
  if (!found) throw new Error("This locker is no longer on this PC — refresh and try again.");
  if ("serverId" in found) return { path: `/lockers/${found.serverId}`, serverId: found.serverId };
  return { path: `/lockers/ref:${found.entryId}`, draftUuid: found.entryId };
}

export async function updateLocker(id: number, input: LockerFormInput, branchName?: string): Promise<LockerView | null> {
  // Desktop: the change goes into the outbox first, shows in the lists at once, and is sent from there.
  if (offlineReady()) {
    const t = await target(id);
    const entry = newEntry("PUT", t.path, input, currentActor());
    entry.targets = [entry.id];
    const fields = { code: input.code, branchId: input.branchId, capacity: input.capacity, isActive: input.isActive, ...(branchName ? { branchName } : {}) };
    await enqueueAndWait(entry, () =>
      upsertLocal("lockers", (t.draftUuid ? { uuid: t.draftUuid, ...fields } : { uuid: entry.id, editOf: t.serverId, ...fields }) as unknown as LocalRecord)
    );
    return null;
  }
  const rec = await apiFetch<BackendLocker>(`/lockers/${id}`, {
    method: "PUT",
    body: JSON.stringify(input),
  });
  return toView(rec);
}

export async function deleteLocker(id: number): Promise<void> {
  if (offlineReady()) {
    const t = await target(id);
    const entry = newEntry("DELETE", t.path, undefined, currentActor());
    entry.targets = [entry.id];
    await enqueueAndWait(entry, () => upsertLocal("lockers", { uuid: entry.id, deleteOf: t.serverId ?? id } as unknown as LocalRecord));
    return;
  }
  await apiFetch(`/lockers/${id}`, { method: "DELETE" });
}
