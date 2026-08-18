import { apiRequest } from "./client";
import { Customer } from "../types/customer";

export type SessionResponse = {
  token: string;
  customer: Customer;
};

// POST /customer/auth/request-otp — sends a 6-digit OTP over WhatsApp to a
// registered customer's phone.
export function requestOtp(phone: string): Promise<{ message: string }> {
  return apiRequest("/auth/request-otp", { method: "POST", body: { phone }, skipAuth: true });
}

// POST /customer/auth/verify-otp — exchanges phone + OTP for a session JWT.
export function verifyOtp(phone: string, code: string): Promise<SessionResponse> {
  return apiRequest("/auth/verify-otp", { method: "POST", body: { phone, code }, skipAuth: true });
}

// POST /customer/auth/register-device — called once right after a
// successful verifyOtp, while the freshly issued session token is still
// held (so this call is authenticated). Returns the raw device token,
// which the caller must store in SecureStore behind a biometric gate —
// see src/auth/deviceToken.ts.
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
