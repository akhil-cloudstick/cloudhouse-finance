import type { BackendEmployee } from "@/modules/employees/types/employee-types";

/* Employee shape as returned inside the login/me responses (backend's
 * internal/employee.Employee, minus the password/reset fields which carry
 * `json:"-"`). Reuses BackendEmployee since it's the same struct. */
export type AuthEmployee = BackendEmployee & { isSystem: boolean };
export type LoginResponse = {
  token: string;
  employee: AuthEmployee;
};
/* QR sign-in of the mobile app (backend/internal/auth/qr.go). The "Connect
 * mobile app" modal asks for a one-time login token bound to the employee
 * signed in here and puts it in its QR; the phone that scans it is signed in
 * as that employee. */
export type QrLoginToken = { token: string; expiresIn: number };
