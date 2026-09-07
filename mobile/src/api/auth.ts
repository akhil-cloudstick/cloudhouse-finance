import { apiRequestEnveloped as apiRequest } from "./client";
import { Employee } from "../types/employee";

export type LoginResponse = { token: string; employee: Employee };

export function login(identifier: string, password: string, businessCode = "") {
  return apiRequest<LoginResponse>("/auth/login", {
    method: "POST",
    body: { identifier, password, businessCode },
    skipAuth: true,
  });
}

// Returns a plain confirmation string now (httpx.SuccessMessage), not
// {message: string} — no caller reads the value today, only awaits it.
export function forgotPassword(phone: string, businessCode = "") {
  return apiRequest<string>("/auth/forgot-password", {
    method: "POST",
    body: { phone, businessCode },
    skipAuth: true,
  });
}

export function resetPassword(phone: string, otp: string, newPassword: string, businessCode = "") {
  return apiRequest<string>("/auth/reset-password", {
    method: "POST",
    body: { phone, otp, newPassword, businessCode },
    skipAuth: true,
  });
}

export function me() {
  return apiRequest<Employee>("/auth/me");
}
