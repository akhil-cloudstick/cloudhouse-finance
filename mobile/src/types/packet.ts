// Mirrors backend/internal/packet's JSON shape. Stage machine:
// "Packet Generated" -> "Locker Stored" -> "Bank Pledged" ->
// "Returned"/"Ready For Release" -> "Released".
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
  loan?: { id: number; loanNumber: string; ornaments?: PacketOrnament[] };
  status: string;
  currentLockerId?: number;
  movements?: PacketMovement[];
  createdAt: string;
  updatedAt: string;
};
