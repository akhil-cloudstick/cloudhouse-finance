import { apiFetchEnveloped as apiFetch } from "@/common/services/httpClient";
import type { WhatsAppPairing, WhatsAppQR, WhatsAppSession } from "@/modules/integrations/types/integrations-types";

export function getWhatsAppSession(): Promise<WhatsAppSession> {
  return apiFetch<WhatsAppSession>("/integrations/whatsapp");
}

export function connectWhatsApp(): Promise<WhatsAppSession> {
  return apiFetch<WhatsAppSession>("/integrations/whatsapp/connect", { method: "POST" });
}

export function getWhatsAppQR(): Promise<WhatsAppQR> {
  return apiFetch<WhatsAppQR>("/integrations/whatsapp/qr");
}

export function requestWhatsAppPairingCode(phone: string): Promise<WhatsAppPairing> {
  return apiFetch<WhatsAppPairing>("/integrations/whatsapp/pairing-code", {
    method: "POST",
    body: JSON.stringify({ phone }),
  });
}

export async function disconnectWhatsApp(): Promise<void> {
  await apiFetch<string>("/integrations/whatsapp/disconnect", { method: "POST" });
}
