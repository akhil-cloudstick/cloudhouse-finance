import { apiRequestEnveloped as apiRequest } from "@/common/services/httpClient";
import { Customer } from "@/common/types/customer-types";

export type SessionResponse = {
  token: string;
  customer: Customer;
};

// POST /customer/auth/request-otp — sends a 6-digit OTP over WhatsApp to a
// registered customer's phone. Returns the confirmation as a plain string
// (httpx.SuccessMessage) — no caller reads the value today, only awaits it.
//
// businessCode names the lender. A borrower's phone number is unique only
// WITHIN a lender, so with more than one on the backend the phone alone is
// ambiguous and the server answers "please open your lender's app link". Empty
// is valid and correct for a single-lender backend, which resolves it itself —
// see src/common/services/businessCode.ts.
export function requestOtp(phone: string, businessCode = ""): Promise<string> {
  return apiRequest("/auth/request-otp", { method: "POST", body: { phone, businessCode }, skipAuth: true });
}

// POST /customer/auth/verify-otp — exchanges phone + OTP for a session JWT.
export function verifyOtp(phone: string, code: string, businessCode = ""): Promise<SessionResponse> {
  return apiRequest("/auth/verify-otp", { method: "POST", body: { phone, code, businessCode }, skipAuth: true });
}

// POST /customer/auth/register-device — called once right after a
// successful verifyOtp, while the freshly issued session token is still
// held (so this call is authenticated). Returns the raw device token,
// which the caller must store in SecureStore behind a biometric gate —
// see src/common/services/deviceToken.ts.
export function registerDevice(deviceId: string): Promise<{ deviceToken: string }> {
  return apiRequest("/auth/register-device", { method: "POST", body: { deviceId } });
}

// POST /customer/auth/device-login — exchanges a stored device token
// (released only after a successful local biometric check) for a fresh
// session JWT. Public: no session token is held yet at this point.
export function deviceLogin(deviceToken: string): Promise<SessionResponse> {
  return apiRequest("/auth/device-login", { method: "POST", body: { deviceToken }, skipAuth: true });
}

// POST /customer/auth/refresh — extends the current session, given an
// already-valid session JWT.
export function refresh(): Promise<{ token: string }> {
  return apiRequest("/auth/refresh", { method: "POST" });
}
