// Mirrors backend/internal/locker's View DTO. Occupancy is derived
// server-side, never stored — surfaced here as an optional field in case
// the view includes it (falls back gracefully if not).
export type Locker = {
  id: number;
  code: string;
  branchId: number;
  branch?: { id: number; name: string };
  capacity: number;
  occupied?: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};
