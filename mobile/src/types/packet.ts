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

export type Packet = {
  id: number;
  code: string;
  loanId: number;
  loan?: { id: number; loanNumber: string };
  status: string;
  currentLockerId?: number;
  movements?: PacketMovement[];
  createdAt: string;
  updatedAt: string;
};
