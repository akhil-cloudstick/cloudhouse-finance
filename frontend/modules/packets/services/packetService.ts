import { apiFetchEnveloped as apiFetch } from "@/common/services/httpClient";
import { enqueueAndWait, newEntry, offlineReady } from "@/common/offline";
import { currentActor } from "@/common/offline/actor";
import { createsLocker, findLocalRequest, LOCKER_REF } from "@/common/offline/requestRef";
import { isSmallScreen } from "@/common/utils/responsive";
import type { BackendPacket, BackendPacketMovement, PacketView, MovementView, PacketFilters, RecordMovementInput } from "@/modules/packets/types/packet-types";

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
    // Ornaments still in the packet first, then the ones already released (a partial release), marked as such.
    items: [...ornaments.map((o) => ({ o, released: false })), ...(p.releasedOrnaments || []).map((o) => ({ o, released: true }))].map(({ o, released }) => ({
      id: o.id,
      name: o.name,
      purity: o.purity || "—",
      grossWeight: o.grossWeight || 0,
      deductionWeight: o.deductionWeight || 0,
      netWeight: o.netWeight || 0,
      quantity: o.quantity || 1,
      goldValue: o.goldValue || 0,
      remarks: o.remarks || "",
      released,
      releasedAt: o.releasedAt || null,
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

const csv = (v: string | number | (string | number)[]) => (Array.isArray(v) ? v.join(",") : String(v));
const hasValue = (v?: string | number | (string | number)[]) => (Array.isArray(v) ? v.length > 0 : !!v);

export async function listPackets(filters?: PacketFilters): Promise<PacketView[]> {
  const params = new URLSearchParams();
  if (filters?.loanId) params.set("loanId", String(filters.loanId));
  if (filters && hasValue(filters.branchId)) params.set("branchId", csv(filters.branchId!));
  if (filters && hasValue(filters.customerId)) params.set("customerId", csv(filters.customerId!));
  if (filters && hasValue(filters.status)) params.set("status", csv(filters.status!));
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
  if (filters && hasValue(filters.branchId)) params.set("branchId", csv(filters.branchId!));
  if (filters && hasValue(filters.customerId)) params.set("customerId", csv(filters.customerId!));
  if (filters && hasValue(filters.status)) params.set("status", csv(filters.status!));
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

export async function recordMovement(packetId: number, input: RecordMovementInput): Promise<PacketView | null> {
  // Desktop: the movement goes into the outbox first and the packet shows its new stage at once (see
  // common/offline/statusAdjust.ts); the sender posts it. A packet with no server id yet cannot be moved.
  if (offlineReady() && packetId > 0) {
    let body: unknown = input;
    // a locker made on this PC has no server id yet: the movement names it by the entry that creates it, or by the
    // server's id when that entry has already been sent (see common/offline/requestRef.ts)
    if (input.lockerId !== undefined && input.lockerId < 0) {
      const found = await findLocalRequest(input.lockerId, createsLocker);
      if (!found) throw new Error("This locker is no longer on this PC — refresh and pick it again.");
      body = { ...input, lockerId: "serverId" in found ? found.serverId : `${LOCKER_REF}${found.entryId}` };
    }
    const entry = newEntry("POST", `/packets/${packetId}/movements`, body, currentActor(), [`packet:${packetId}`]);
    await enqueueAndWait(entry, () => undefined, () => undefined);
    return getPacket(packetId).catch(() => null);
  }
  const rec = await apiFetch<BackendPacket>(`/packets/${packetId}/movements`, {
    method: "POST",
    body: JSON.stringify(input),
  });
  return toView(rec);
}
