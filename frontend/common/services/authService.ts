import { apiFetchEnveloped as apiFetch } from "@/common/services/httpClient";
import type { BackendEmployee } from "@/modules/employees/services/employeeService";

/* Employee shape as returned inside the login/me responses (backend's
 * internal/employee.Employee, minus the password/reset fields which carry
 * `json:"-"`). Reuses BackendEmployee since it's the same struct. */
export type AuthEmployee = BackendEmployee;

export type LoginResponse = {
  token: string;
  employee: AuthEmployee;
};

/* Login identifies an employee by Username OR Phone (never email) — see
 * backend/internal/auth/model.go's LoginInput. */
export function login(identifier: string, password: string): Promise<LoginResponse> {
  return apiFetch<LoginResponse>("/auth/login", {
    method: "POST",
    body: JSON.stringify({ identifier, password }),
  });
}

/* Forgotten passwords are reset via a 6-digit OTP texted to the employee's
 * Phone (platform.SMSSender), not an emailed link. Both endpoints now return
 * the confirmation as a plain string (httpx.SuccessMessage), not
 * {message: string} — no caller reads the value today, only awaits it. */
export function forgotPassword(phone: string): Promise<string> {
  return apiFetch<string>("/auth/forgot-password", {
    method: "POST",
    body: JSON.stringify({ phone }),
  });
}

export function resetPassword(phone: string, otp: string, newPassword: string): Promise<string> {
  return apiFetch<string>("/auth/reset-password", {
    method: "POST",
    body: JSON.stringify({ phone, otp, newPassword }),
  });
}

export function fetchMe(): Promise<AuthEmployee> {
  return apiFetch<AuthEmployee>("/auth/me");
}
