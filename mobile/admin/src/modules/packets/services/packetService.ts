import { apiRequestEnveloped as apiRequest } from "@/common/services/httpClient";
import { Packet, PacketMovement } from "@/modules/packets/types/packet-types";

export function listPackets(params?: { loanId?: number; lockerId?: number; status?: string }) {
  return apiRequest<Packet[]>("/packets", { params });
}

export function listPacketsPage(params: {
  loanId?: number;
  lockerId?: number;
  status?: string;
  /** Comma-joined ids — the Branch and Customer filters are multi-select. */
  branchId?: string;
  customerId?: string;
  /** Packet code / loan number / customer name. */
  q?: string;
  limit: number;
  offset: number;
}) {
  return apiRequest<{ items: Packet[]; hasMore: boolean; total?: number }>("/packets", { params });
}

export function getPacketByCode(code: string) {
  return apiRequest<Packet>(`/packets/by-code/${encodeURIComponent(code)}`);
}

export function getPacket(id: number) {
  return apiRequest<Packet>(`/packets/${id}`);
}

export function getPacketMovements(id: number) {
  return apiRequest<PacketMovement[]>(`/packets/${id}/movements`);
}

// 409 when the loan is Auctioned/Closed or the locker is full.
export function movePacket(id: number, input: { toStatus: string; lockerId?: number; employeeId: number; remarks?: string }) {
  return apiRequest<Packet>(`/packets/${id}/movements`, { method: "POST", body: input });
}
