import type { BranchView } from "@/modules/branches/types/branch-types";

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
