import { apiRequestEnveloped as apiRequest } from "@/common/services/httpClient";
import { Locker, type LockerInput } from "@/modules/lockers/types/locker-types";

// Branch-scoped only, no query params today.
export function listLockers() {
  return apiRequest<Locker[]>("/lockers");
}

// Page-scoped variant: passing `limit` flips the backend (locker/
// handler.go's List) into the {items, hasMore} envelope — used by the
// paginated mobile Lockers list (10/page, one API call per page).
export function listLockersPage(params: {
  branchId?: number;
  q?: string;
  /** true -> only active lockers (sent as `active=true`). */
  active?: boolean;
  /** Server-side status bucket: active | full | inactive. */
  status?: "active" | "full" | "inactive";
  limit: number;
  offset: number;
}) {
  return apiRequest<{ items: Locker[]; hasMore: boolean; total?: number }>("/lockers", { params });
}

export function getLocker(id: number) {
  return apiRequest<Locker>(`/lockers/${id}`);
}

export function createLocker(input: LockerInput) {
  return apiRequest<Locker>("/lockers", { method: "POST", body: input });
}

export function updateLocker(id: number, input: LockerInput) {
  return apiRequest<Locker>(`/lockers/${id}`, { method: "PUT", body: input });
}

// Backend rejects with ErrInUse (surfaced via ApiError) if the locker is
// currently occupied — the UI just needs to show that message, not
// pre-check occupancy itself.
export function deleteLocker(id: number) {
  return apiRequest<void>(`/lockers/${id}`, { method: "DELETE" });
}
