import { apiRequestEnveloped as apiRequest } from "./client";
import { Locker } from "../types/locker";

// Branch-scoped only, no query params today.
export function listLockers() {
  return apiRequest<Locker[]>("/lockers");
}

// Page-scoped variant: passing `limit` flips the backend (locker/
// handler.go's List) into the {items, hasMore} envelope — used by the
// paginated mobile Lockers list (10/page, one API call per page).
export function listLockersPage(params: { limit: number; offset: number }) {
  return apiRequest<{ items: Locker[]; hasMore: boolean }>("/lockers", { params });
}

export function getLocker(id: number) {
  return apiRequest<Locker>(`/lockers/${id}`);
}

export type LockerInput = { code: string; branchId: number; capacity: number; isActive?: boolean };

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
