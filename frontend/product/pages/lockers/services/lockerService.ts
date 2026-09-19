import { apiFetchEnveloped as apiFetch } from "@/product/services/httpClient";
import type { BranchView } from "@/product/pages/branches/services/branchService";

/* Shape returned by the Go backend (backend/internal/locker/model.go's
 * Locker, wrapped in locker.View which adds the derived `occupied` field —
 * returned directly, not through a separate response DTO). */
export type BackendLocker = {
  id: number;
  code: string;
  branchId: number;
  branch?: Pick<BranchView, "id" | "name" | "code">;
  capacity: number;
  isActive: boolean;
  occupied: number;
  createdAt: string;
  updatedAt: string;
};

export type LockerFormInput = {
  code: string;
  branchId: number;
  capacity: number;
  isActive: boolean;
};

/* UI-facing shape — mirrors modules/branches/services/branchService.ts's BranchView convention. */
export type LockerView = {
  id: number;
  code: string;
  branchId: number;
  branchName: string;
  capacity: number;
  occupied: number;
  isActive: boolean;
};

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

export async function listLockers(): Promise<LockerView[]> {
  const rec = await apiFetch<BackendLocker[]>("/lockers");
  return (rec || []).map(toView);
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
  return { items: (rec?.items || []).map(toView), hasMore: !!rec?.hasMore, total: rec?.total ?? 0 };
}

export async function getLocker(id: number): Promise<LockerView> {
  const rec = await apiFetch<BackendLocker>(`/lockers/${id}`);
  return toView(rec);
}

export async function createLocker(input: LockerFormInput): Promise<LockerView> {
  const rec = await apiFetch<BackendLocker>("/lockers", {
    method: "POST",
    body: JSON.stringify(input),
  });
  return toView(rec);
}

export async function updateLocker(id: number, input: LockerFormInput): Promise<LockerView> {
  const rec = await apiFetch<BackendLocker>(`/lockers/${id}`, {
    method: "PUT",
    body: JSON.stringify(input),
  });
  return toView(rec);
}

export async function deleteLocker(id: number): Promise<void> {
  await apiFetch(`/lockers/${id}`, { method: "DELETE" });
}
