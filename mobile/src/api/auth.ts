import { apiRequest } from "./client";
import { Employee } from "../types/employee";

export type LoginResponse = { token: string; employee: Employee };

export function login(identifier: string, password: string) {
  return apiRequest<LoginResponse>("/auth/login", {
    method: "POST",
    body: { identifier, password },
    skipAuth: true,
  });
}

export function forgotPassword(phone: string) {
  return apiRequest<{ message: string }>("/auth/forgot-password", {
    method: "POST",
    body: { phone },
    skipAuth: true,
  });
}

export function resetPassword(phone: string, otp: string, newPassword: string) {
  return apiRequest<{ message: string }>("/auth/reset-password", {
    method: "POST",
    body: { phone, otp, newPassword },
    skipAuth: true,
  });
}

export function me() {
  return apiRequest<Employee>("/auth/me");
}
