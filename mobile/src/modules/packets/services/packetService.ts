import { apiRequestEnveloped as apiRequest } from "@/common/services/httpClient";
import { Packet, PacketMovement } from "@/modules/packets/types/packet-types";

// loanId/lockerId/status are real server-side filters (see plan) — never
// filter a full packet list on-device.
export function listPackets(params?: { loanId?: number; lockerId?: number; status?: string }) {
  return apiRequest<Packet[]>("/packets", { params });
}

// Page-scoped variant: passing `limit` flips the backend (packet/handler.go's
// List) into the {items, hasMore} envelope — used by the paginated mobile
// Packets list (10/page, one API call per page).
export function listPacketsPage(params: {
  loanId?: number;
  lockerId?: number;
  status?: string;
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

// The only write on this module — packets themselves are auto-created when
// a loan is created, there's no direct POST /packets. Returns the updated
// packet; 409 when the loan is Auctioned/Closed or the locker is full.
export function movePacket(id: number, input: { toStatus: string; lockerId?: number; employeeId: number; remarks?: string }) {
  return apiRequest<Packet>(`/packets/${id}/movements`, { method: "POST", body: input });
}
