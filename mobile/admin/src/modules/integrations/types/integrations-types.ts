// "not_connected" covers a business with no session yet.
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
