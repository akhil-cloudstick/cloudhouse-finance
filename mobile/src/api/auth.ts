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
// Username and phone must belong to the same employee — the backend answers
// one "don't match any account" error for every mismatch.
export function forgotPassword(username: string, phone: string, businessCode = "") {
  return apiRequest<string>("/auth/forgot-password", {
    method: "POST",
    body: { username, phone, businessCode },
    skipAuth: true,
  });
}

// Checks the texted code before the new-password step without consuming it;
// resetPassword checks it again. Wrong codes are capped server-side.
export function verifyResetCode(username: string, phone: string, otp: string, businessCode = "") {
  return apiRequest<string>("/auth/verify-reset-code", {
    method: "POST",
    body: { username, phone, otp, businessCode },
    skipAuth: true,
  });
}

export function resetPassword(username: string, phone: string, otp: string, newPassword: string, businessCode = "") {
  return apiRequest<string>("/auth/reset-password", {
    method: "POST",
    body: { username, phone, otp, newPassword, businessCode },
    skipAuth: true,
  });
}

export function me() {
  return apiRequest<Employee>("/auth/me");
}
