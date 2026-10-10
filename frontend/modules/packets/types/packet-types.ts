

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
export type PacketFilters = { loanId?: number; branchId?: number | number[]; customerId?: number[]; status?: string | string[]; lockerId?: number; q?: string };
export type RecordMovementInput = { toStatus: string; lockerId?: number; employeeId: number; remarks?: string };
