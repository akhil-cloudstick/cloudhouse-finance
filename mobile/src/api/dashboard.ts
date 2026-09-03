import { apiRequestEnveloped as apiRequest } from "./client";

// Mirrors backend/internal/dashboard/snapshot_model.go's Snapshot — one
// day's captured KPI counts, used to compute the mobile dashboard's
// vs-yesterday trend indicators.
export type DashboardSnapshot = {
  id: number;
  date: string;
  activeCount: number;
  overdueCount: number;
  pendingApprovalCount: number;
  openedTodayCount: number;
  dueTodayCount: number;
  createdAt: string;
};

// Most recently captured snapshot (typically "yesterday", since capture
// runs nightly) — null if none has been captured yet (e.g. the first day
// after this feature ships).
export function latestDashboardSnapshot() {
  return apiRequest<DashboardSnapshot | null>("/dashboard/snapshots/latest");
}
