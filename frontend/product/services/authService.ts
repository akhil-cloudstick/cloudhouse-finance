import { apiFetchEnveloped as apiFetch } from "@/product/services/httpClient";
import type { BackendEmployee } from "@/product/pages/employees/services/employeeService";

/* Employee shape as returned inside the login/me responses (backend's
 * internal/employee.Employee, minus the password/reset fields which carry
 * `json:"-"`). Reuses BackendEmployee since it's the same struct. */
export type AuthEmployee = BackendEmployee;

export type LoginResponse = {
  token: string;
  employee: AuthEmployee;
};

/* Every endpoint here runs BEFORE a session exists, so none of them can take
 * the business from a token — each carries a `businessCode` instead.
 *
 * The code is optional and empty is a valid value: with one business the
 * backend resolves it on its own, and with several it answers "please use
 * your organisation's sign-in link, or enter your business code". A wrong
 * code returns the SAME error as a wrong password, deliberately, so the login
 * page cannot be used to enumerate which businesses exist — which is also why
 * nothing here reports "no such business" separately.
 *
 * Login identifies an employee by Username OR Phone (never email) — see
 * backend/internal/auth/model.go's LoginInput. */
export function login(identifier: string, password: string, businessCode = ""): Promise<LoginResponse> {
  return apiFetch<LoginResponse>("/auth/login", {
    method: "POST",
    body: JSON.stringify({ identifier, password, businessCode }),
  });
}

/* Forgotten passwords are reset via a 6-digit OTP texted to the employee's
 * Phone (platform.SMSSender), not an emailed link. Both endpoints now return
 * the confirmation as a plain string (httpx.SuccessMessage), not
 * {message: string} — no caller reads the value today, only awaits it.
 *
 * Both carry the business for a concrete reason: a phone number is unique
 * only WITHIN a business now, so without it the backend cannot tell which
 * employee is asking.
 *
 * Username and phone must belong to the same employee — the backend answers
 * one "don't match any account" error for every mismatch. */
export function forgotPassword(username: string, phone: string, businessCode = ""): Promise<string> {
  return apiFetch<string>("/auth/forgot-password", {
    method: "POST",
    body: JSON.stringify({ username, phone, businessCode }),
  });
}

/* Checks the texted code before the new-password step without consuming it;
 * resetPassword checks it again. Wrong codes are capped server-side. */
export function verifyResetCode(
  username: string,
  phone: string,
  otp: string,
  businessCode = ""
): Promise<string> {
  return apiFetch<string>("/auth/verify-reset-code", {
    method: "POST",
    body: JSON.stringify({ username, phone, otp, businessCode }),
  });
}

export function resetPassword(
  username: string,
  phone: string,
  otp: string,
  newPassword: string,
  businessCode = ""
): Promise<string> {
  return apiFetch<string>("/auth/reset-password", {
    method: "POST",
    body: JSON.stringify({ username, phone, otp, newPassword, businessCode }),
  });
}

export function fetchMe(): Promise<AuthEmployee> {
  return apiFetch<AuthEmployee>("/auth/me");
}

/* QR sign-in of the mobile app (backend/internal/auth/qr.go). The "Connect
 * mobile app" modal asks for a one-time login token bound to the employee
 * signed in here and puts it in its QR; the phone that scans it is signed in
 * as that employee. */
export type QrLoginToken = { token: string; expiresIn: number };

export function issueQrLogin(): Promise<QrLoginToken> {
  return apiFetch<QrLoginToken>("/auth/qr/issue", { method: "POST", cache: "no-store" });
}
