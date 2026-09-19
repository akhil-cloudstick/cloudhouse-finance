import { apiFetchEnveloped as apiFetch } from "@/product/services/httpClient";
import { isSmallScreen } from "@/product/utils/responsive";

/* Packet stage values — mirror backend/internal/packet/model.go's Status
 * constants exactly (string literals, not enums, per this codebase's
 * plain-string-status convention — see loan.Status for precedent).
 * READY_FOR_RELEASE is no longer a step gold passes through on its way to
 * Released (kept only so historic movement rows and any packet still
 * sitting in that legacy status still render correctly). */
export const PACKET_STATUS = {
  GENERATED: "Packet Generated",
  LOCKER_STORED: "Locker Stored",
  BANK_PLEDGED: "Bank Pledged",
  RETURNED: "Returned",
  READY_FOR_RELEASE: "Ready For Release",
  RELEASED: "Released",
} as const;

/* Ordered stepper sequence for PacketDetail's 5-stage visual. Typed as
 * string[] (not a literal-union array) so callers can index/search it with
 * an arbitrary status string from the backend. */
export const PACKET_STAGES: string[] = [
  PACKET_STATUS.GENERATED,
  PACKET_STATUS.LOCKER_STORED,
  PACKET_STATUS.BANK_PLEDGED,
  PACKET_STATUS.RETURNED,
  PACKET_STATUS.RELEASED,
];

type NestedBranch = { id: number; name: string; code: string };
type NestedCustomer = { id: number; name: string; code: string; phone: string };
type NestedOrnament = {
  id: number;
  name: string;
  purity: string;
  grossWeight: number;
  deductionWeight: number;
  netWeight: number;
  quantity: number;
  goldValue: number;
  remarks?: string;
};

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
/* One ornament sealed inside the packet — what PacketDetail's "Contents"
 * table lists. Comes from the joined loan's preloaded ornaments (see
 * backend/internal/packet/repository.go's preload), so no extra round-trip.
 * Ornament photos are NOT part of that preload; the loan detail page shows
 * those. */
export type PacketItemView = {
  id: number;
  name: string;
  purity: string;
  grossWeight: number;
  deductionWeight: number;
  netWeight: number;
  quantity: number;
  goldValue: number;
  remarks: string;
};

export type PacketView = {
  id: number;
  code: string;
  loanId: number;
  loanNumber: string;
  // The loan's own status — Auctioned/AuctionedBalanceDue/Closed all mean
  // the gold has already left custody (sold or released), so PacketDetail
  // uses this to hide further movement actions and override the displayed
  // status rather than trusting the packet's own (possibly stale) stage.
  loanStatus: string;
  branchId: number;
  branchName: string;
  customerName: string;
  itemCount: number;
  totalWeight: number;
  items: PacketItemView[];
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
    loanStatus: p.loan?.status || "",
    branchId: p.loan?.branchId || 0,
    branchName: p.loan?.branch?.name || "—",
    customerName: p.loan?.customer?.name || "—",
    itemCount: ornaments.reduce((sum, o) => sum + (o.quantity || 1), 0),
    totalWeight: ornaments.reduce((sum, o) => sum + (o.netWeight || 0), 0),
    items: ornaments.map((o) => ({
      id: o.id,
      name: o.name,
      purity: o.purity || "—",
      grossWeight: o.grossWeight || 0,
      deductionWeight: o.deductionWeight || 0,
      netWeight: o.netWeight || 0,
      quantity: o.quantity || 1,
      goldValue: o.goldValue || 0,
      remarks: o.remarks || "",
    })),
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

export type PacketFilters = { loanId?: number; branchId?: number; status?: string; lockerId?: number; q?: string };

export async function listPackets(filters?: PacketFilters): Promise<PacketView[]> {
  const params = new URLSearchParams();
  if (filters?.loanId) params.set("loanId", String(filters.loanId));
  if (filters?.branchId) params.set("branchId", String(filters.branchId));
  if (filters?.status) params.set("status", filters.status);
  if (filters?.lockerId) params.set("lockerId", String(filters.lockerId));
  if (filters?.q) params.set("q", filters.q);
  const qs = params.toString();
  const rec = await apiFetch<BackendPacket[]>(`/packets${qs ? `?${qs}` : ""}`);
  return (rec || []).map(toView);
}

/* Page size for the Packets page's own table. */
export const PACKETS_TABLE_PAGE_SIZE = 12;

/* Paginated variant of listPackets for the Packets page table — same
 * {items, hasMore} envelope as loansApi.ts's listLoansPage, fetched fresh
 * per page rather than sliced client-side. */
export async function listPacketsPage(
  page: number,
  filters?: PacketFilters,
  limit?: number
): Promise<{ items: PacketView[]; hasMore: boolean; total: number }> {
  const pageSize = limit ?? (isSmallScreen() ? 7 : 11);
  const params = new URLSearchParams({
    limit: String(pageSize),
    offset: String((page - 1) * pageSize),
  });
  if (filters?.loanId) params.set("loanId", String(filters.loanId));
  if (filters?.branchId) params.set("branchId", String(filters.branchId));
  if (filters?.status) params.set("status", filters.status);
  if (filters?.lockerId) params.set("lockerId", String(filters.lockerId));
  if (filters?.q) params.set("q", filters.q);
  const rec = await apiFetch<{ items: BackendPacket[]; hasMore: boolean; total?: number }>(`/packets?${params}`);
  return { items: (rec?.items || []).map(toView), hasMore: !!rec?.hasMore, total: rec?.total ?? 0 };
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
