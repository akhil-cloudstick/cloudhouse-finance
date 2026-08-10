import { apiFetch } from "@/lib/api";

/* Packet stage values — mirror backend/internal/packet/model.go's Status
 * constants exactly (string literals, not enums, per this codebase's
 * plain-string-status convention — see loan.Status for precedent). */
export const PACKET_STATUS = {
  GENERATED: "Packet Generated",
  LOCKER_STORED: "Locker Stored",
  BANK_PLEDGED: "Bank Pledged",
  RETURNED: "Returned",
  READY_FOR_RELEASE: "Ready For Release",
  RELEASED: "Released",
} as const;

/* Ordered stepper sequence for PacketDetail's 6-stage visual. Typed as
 * string[] (not a literal-union array) so callers can index/search it with
 * an arbitrary status string from the backend. */
export const PACKET_STAGES: string[] = [
  PACKET_STATUS.GENERATED,
  PACKET_STATUS.LOCKER_STORED,
  PACKET_STATUS.BANK_PLEDGED,
  PACKET_STATUS.RETURNED,
  PACKET_STATUS.READY_FOR_RELEASE,
  PACKET_STATUS.RELEASED,
];

type NestedBranch = { id: number; name: string; code: string };
type NestedCustomer = { id: number; name: string; code: string; phone: string };
type NestedOrnament = { id: number; name: string; netWeight: number; quantity: number };

/* Minimal shape of the joined Loan the backend preloads onto every packet
 * response (see backend/internal/packet/repository.go's preload()) — only
 * the fields this module reads. */
type NestedLoan = {
  id: number;
  loanNumber: string;
  branchId: number;
  branch?: NestedBranch;
  customerId: number;
  customer?: NestedCustomer;
  status: string;
  ornaments?: NestedOrnament[];
};

/* Shape returned by the Go backend (backend/internal/packet/model.go's
 * Packet — returned directly, not through a separate response DTO). */
export type BackendPacket = {
  id: number;
  code: string;
  loanId: number;
  loan?: NestedLoan;
  status: string;
  currentLockerId: number | null;
  createdAt: string;
  updatedAt: string;
};

export type BackendPacketMovement = {
  id: number;
  packetId: number;
  fromStatus: string;
  toStatus: string;
  lockerId: number | null;
  actorEmployeeId: number;
  remarks: string;
  createdAt: string;
};

/* UI-facing shape — includes the joined loan/customer/branch/ornament
 * display fields (loan number, customer name, ornament count/weight)
 * following loansApi.ts's toView() pattern, so Packets.tsx doesn't need a
 * second round-trip. */
export type PacketView = {
  id: number;
  code: string;
  loanId: number;
  loanNumber: string;
  branchId: number;
  branchName: string;
  customerName: string;
  itemCount: number;
  totalWeight: number;
  status: string;
  currentLockerId: number | null;
};

export type MovementView = {
  id: number;
  fromStatus: string;
  toStatus: string;
  lockerId: number | null;
  actorEmployeeId: number;
  remarks: string;
  createdAt: string;
};

function toView(p: BackendPacket): PacketView {
  const ornaments = p.loan?.ornaments || [];
  return {
    id: p.id,
    code: p.code,
    loanId: p.loanId,
    loanNumber: p.loan?.loanNumber || String(p.loanId),
    branchId: p.loan?.branchId || 0,
    branchName: p.loan?.branch?.name || "—",
    customerName: p.loan?.customer?.name || "—",
    itemCount: ornaments.reduce((sum, o) => sum + (o.quantity || 1), 0),
    totalWeight: ornaments.reduce((sum, o) => sum + (o.netWeight || 0), 0),
    status: p.status,
    currentLockerId: p.currentLockerId,
  };
}

function toMovementView(m: BackendPacketMovement): MovementView {
  return {
    id: m.id,
    fromStatus: m.fromStatus,
    toStatus: m.toStatus,
    lockerId: m.lockerId,
    actorEmployeeId: m.actorEmployeeId,
    remarks: m.remarks,
    createdAt: m.createdAt,
  };
}

export type PacketFilters = { loanId?: number; branchId?: number; status?: string; lockerId?: number };

export async function listPackets(filters?: PacketFilters): Promise<PacketView[]> {
  const params = new URLSearchParams();
  if (filters?.loanId) params.set("loanId", String(filters.loanId));
  if (filters?.branchId) params.set("branchId", String(filters.branchId));
  if (filters?.status) params.set("status", filters.status);
  if (filters?.lockerId) params.set("lockerId", String(filters.lockerId));
  const qs = params.toString();
  const rec = await apiFetch<BackendPacket[]>(`/packets${qs ? `?${qs}` : ""}`);
  return (rec || []).map(toView);
}

export async function getPacket(id: number): Promise<PacketView> {
  const rec = await apiFetch<BackendPacket>(`/packets/${id}`);
  return toView(rec);
}

export async function getPacketByCode(code: string): Promise<PacketView> {
  const rec = await apiFetch<BackendPacket>(`/packets/by-code/${encodeURIComponent(code)}`);
  return toView(rec);
}

export async function listMovements(packetId: number): Promise<MovementView[]> {
  const rec = await apiFetch<BackendPacketMovement[]>(`/packets/${packetId}/movements`);
  return (rec || []).map(toMovementView);
}

export type RecordMovementInput = { toStatus: string; lockerId?: number; employeeId: number; remarks?: string };

export async function recordMovement(packetId: number, input: RecordMovementInput): Promise<PacketView> {
  const rec = await apiFetch<BackendPacket>(`/packets/${packetId}/movements`, {
    method: "POST",
    body: JSON.stringify(input),
  });
  return toView(rec);
}
