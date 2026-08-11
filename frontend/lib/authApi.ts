import { apiFetch } from "@/lib/api";
import type { BackendEmployee } from "@/lib/employeeApi";

/* Employee shape as returned inside the login/me responses (backend's
 * internal/employee.Employee, minus the password/reset fields which carry
 * `json:"-"`). Reuses BackendEmployee since it's the same struct. */
export type AuthEmployee = BackendEmployee;

export type LoginResponse = {
  token: string;
  employee: AuthEmployee;
};

export function login(email: string, password: string): Promise<LoginResponse> {
  return apiFetch<LoginResponse>("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
}

export function forgotPassword(email: string): Promise<{ message: string }> {
  return apiFetch<{ message: string }>("/auth/forgot-password", {
    method: "POST",
    body: JSON.stringify({ email }),
  });
}

export function resetPassword(token: string, newPassword: string): Promise<{ message: string }> {
  return apiFetch<{ message: string }>("/auth/reset-password", {
    method: "POST",
    body: JSON.stringify({ token, newPassword }),
  });
}

export function fetchMe(): Promise<AuthEmployee> {
  return apiFetch<AuthEmployee>("/auth/me");
}
