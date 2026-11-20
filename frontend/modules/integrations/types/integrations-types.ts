/* OpenWA's session states, plus "not_connected" for a business with no session
 * yet — see backend/modules/WhatsApp/models/session.go. */
export type WhatsAppStatus =
  | "not_connected"
  | "created"
  | "initializing"
  | "qr_ready"
  | "authenticating"
  | "ready"
  | "disconnected"
  | "action_required"
  | "failed";

export interface WhatsAppSession {
  status: WhatsAppStatus;
  connected: boolean;
  phone: string;
}

export interface WhatsAppQR {
  qrCode: string;
  status: WhatsAppStatus;
}

export interface WhatsAppPairing {
  pairingCode: string;
  status: WhatsAppStatus;
}
