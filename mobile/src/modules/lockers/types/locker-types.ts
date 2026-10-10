// Mirrors backend/internal/locker's View DTO. Occupancy is derived
// server-side (count of packets currently stored), never stored.
export type Locker = {
  id: number;
  code: string;
  branchId: number;
  branch?: { id: number; name: string };
  capacity: number;
  occupied: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

export type LockerInput = { code: string; branchId: number; capacity: number; isActive?: boolean };
