// Mirrors backend/internal/packet's JSON shape. Manual moves:
// "Packet Generated" -> "Locker Stored" -> "Released"; "Returned" ->
// "Locker Stored" | "Released". "Bank Pledged"/"Returned" are only entered
// via the loan's bank pledge and its release. "Ready For Release" is legacy:
// nothing moves into it, a packet already there can go -> "Released".
// A movement with fromStatus === toStatus is a partial ornament release
// (remarks explain it), not a stage change.
export type PacketMovement = {
  id: number;
  packetId: number;
  fromStatus: string;
  toStatus: string;
  lockerId?: number;
  actorEmployeeId?: number;
  remarks?: string;
  createdAt: string;
};

// A packet's "contents" are the ornaments of the loan it belongs to — the
// backend preloads them (packet/repository.go's Preload("Loan.Ornaments")),
// so they arrive nested under `loan`, not on the packet itself. Mirrors
// backend/internal/loan/model.go's Ornament.
export type PacketOrnament = {
  id: number;
  name: string;
  purity: string;
  grossWeight: number;
  deductionWeight?: number;
  netWeight: number;
  quantity: number;
  goldValue: number;
  remarks?: string;
};

export type Packet = {
  id: number;
  code: string;
  loanId: number;
  // `ornaments` holds only the still-unreleased ornaments.
  loan?: {
    id: number;
    loanNumber: string;
    branchId?: number;
    branch?: { id: number; name: string };
    customer?: { id: number; name: string };
    status?: string;
    ornaments?: PacketOrnament[];
  };
  status: string;
  currentLockerId?: number;
  totalGrossWeight?: number;
  totalNetWeight?: number;
  movements?: PacketMovement[];
  createdAt: string;
  updatedAt: string;
};
