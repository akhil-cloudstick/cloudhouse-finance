import { apiFetchEnveloped as apiFetch } from "@/common/services/httpClient";
import type { AuthEmployee, LoginResponse, QrLoginToken } from "@/common/types/auth-types";

// Runs before a session exists, so businessCode (optional) substitutes for a token; a wrong code errors like a wrong password to avoid enumeration.
export function login(identifier: string, password: string, businessCode = ""): Promise<LoginResponse> {
	return apiFetch<LoginResponse>("/auth/login", {
		method: "POST",
		body: JSON.stringify({ identifier, password, businessCode }),
	});
}

// Trades the one-time code from the superadmin console's "Login as" for a session (no password involved).
export function loginAs(code: string): Promise<LoginResponse> {
	return apiFetch<LoginResponse>("/auth/login-as", {
		method: "POST",
		body: JSON.stringify({ code }),
	});
}

// Resets via a texted OTP (no emailed link); businessCode is required since a phone number is unique only within a business.
export function forgotPassword(username: string, phone: string, businessCode = ""): Promise<string> {
	return apiFetch<string>("/auth/forgot-password", {
		method: "POST",
		body: JSON.stringify({ username, phone, businessCode }),
	});
}

// Checks the OTP without consuming it; resetPassword checks it again.
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

export function issueQrLogin(): Promise<QrLoginToken> {
	return apiFetch<QrLoginToken>("/auth/qr/issue", { method: "POST", cache: "no-store" });
}
