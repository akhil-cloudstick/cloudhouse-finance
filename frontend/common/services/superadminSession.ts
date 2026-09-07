/* The superadmin console's own session — deliberately separate from
 * tenantSession.ts's staff/borrower keys.
 *
 * A superadmin belongs to no business (backend/internal/superadmin), so
 * there is no slug to key by and no tenant to establish. Kept as its own
 * storage key so a superadmin signed in in one tab and a tenant's own staff
 * signed in in another can never collide or be confused with each other. */

const TOKEN_KEY = "ambikagold_superadmin_token";
const USER_KEY = "ambikagold_superadmin_user";

export type SuperAdminUser = { id: number; name: string; username: string };

export function readSuperAdminToken(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(TOKEN_KEY);
}

export function readSuperAdminUser(): SuperAdminUser | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as SuperAdminUser;
  } catch {
    return null;
  }
}

export function writeSuperAdminSession(token: string, user: SuperAdminUser): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(TOKEN_KEY, token);
  window.localStorage.setItem(USER_KEY, JSON.stringify(user));
}

export function clearSuperAdminSession(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(TOKEN_KEY);
  window.localStorage.removeItem(USER_KEY);
}
