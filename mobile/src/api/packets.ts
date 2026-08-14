import { apiRequest } from "./client";
import { Packet, PacketMovement } from "../types/packet";

// loanId/lockerId/status are real server-side filters (see plan) — never
// filter a full packet list on-device.
export function listPackets(params?: { loanId?: number; lockerId?: number; status?: string }) {
  return apiRequest<Packet[]>("/packets", { params });
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
// a loan is created, there's no direct POST /packets.
export function movePacket(id: number, input: { toStatus: string; lockerId?: number; employeeId: number; remarks?: string }) {
  return apiRequest<PacketMovement>(`/packets/${id}/movements`, { method: "POST", body: input });
}
