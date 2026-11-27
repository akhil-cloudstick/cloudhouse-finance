// "Bank Pledged"/"Returned" are only entered via the loan's bank pledge and its release.
// A movement with fromStatus === toStatus is a partial ornament release, not a stage change.
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

// A packet's "contents" are the ornaments of the loan it belongs to, nested under `loan`.
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
  releasedAt?: string | null;
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
  // Ornaments already handed back in a partial release (sent on a single-packet read only).
  releasedOrnaments?: PacketOrnament[];
  status: string;
  currentLockerId?: number;
  /** Filled by the API on list reads only. */
  lockerCode?: string;
  totalGrossWeight?: number;
  totalNetWeight?: number;
  movements?: PacketMovement[];
  createdAt: string;
  updatedAt: string;
};
