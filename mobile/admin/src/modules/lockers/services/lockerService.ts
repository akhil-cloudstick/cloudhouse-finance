import { apiRequestEnveloped as apiRequest } from "@/common/services/httpClient";
import { Locker, type LockerInput } from "@/modules/lockers/types/locker-types";

export function listLockers() {
  return apiRequest<Locker[]>("/lockers");
}

export function listLockersPage(params: {
  branchId?: number | string;
  q?: string;
  /** true -> only active lockers (sent as `active=true`). */
  active?: boolean;
  /** Server-side status bucket: active | full | inactive. */
  status?: string;
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

// Backend rejects (ErrInUse) if the locker is currently occupied; no need to pre-check here.
export function deleteLocker(id: number) {
  return apiRequest<void>(`/lockers/${id}`, { method: "DELETE" });
}
