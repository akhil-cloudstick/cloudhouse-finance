import { apiRequestEnveloped as apiRequest } from "@/common/services/httpClient";
import { Customer } from "@/common/types/customer-types";

export type SessionResponse = {
  token: string;
  customer: Customer;
};

// businessCode disambiguates phone across lenders; empty is valid for a single-lender backend.
export function requestOtp(phone: string, businessCode = ""): Promise<string> {
  return apiRequest("/auth/request-otp", { method: "POST", body: { phone, businessCode }, skipAuth: true });
}

export function verifyOtp(phone: string, code: string, businessCode = ""): Promise<SessionResponse> {
  return apiRequest("/auth/verify-otp", { method: "POST", body: { phone, code, businessCode }, skipAuth: true });
}

// Caller must store the returned device token in SecureStore behind a biometric gate.
export function registerDevice(deviceId: string): Promise<{ deviceToken: string }> {
  return apiRequest("/auth/register-device", { method: "POST", body: { deviceId } });
}

export function deviceLogin(deviceToken: string): Promise<SessionResponse> {
  return apiRequest("/auth/device-login", { method: "POST", body: { deviceToken }, skipAuth: true });
}

export function refresh(): Promise<{ token: string }> {
  return apiRequest("/auth/refresh", { method: "POST" });
}
