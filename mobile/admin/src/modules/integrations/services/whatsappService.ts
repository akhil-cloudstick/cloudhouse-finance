import { apiRequestEnveloped as apiRequest } from "@/common/services/httpClient";
import type { WhatsAppPairing, WhatsAppQR, WhatsAppSession } from "@/modules/integrations/types/integrations-types";

export function getWhatsAppSession() {
  return apiRequest<WhatsAppSession>("/integrations/whatsapp");
}

export function connectWhatsApp() {
  return apiRequest<WhatsAppSession>("/integrations/whatsapp/connect", { method: "POST" });
}

export function getWhatsAppQR() {
  return apiRequest<WhatsAppQR>("/integrations/whatsapp/qr");
}

export function requestWhatsAppPairingCode(phone: string) {
  return apiRequest<WhatsAppPairing>("/integrations/whatsapp/pairing-code", { method: "POST", body: { phone } });
}

export function disconnectWhatsApp() {
  return apiRequest<string>("/integrations/whatsapp/disconnect", { method: "POST" });
}
