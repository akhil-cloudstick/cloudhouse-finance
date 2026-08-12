"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { AUTH_EMPLOYEE_KEY, AUTH_TOKEN_KEY } from "@/lib/api";
import { login as loginRequest, type AuthEmployee } from "@/lib/authApi";

type JwtPayload = {
  employeeId?: number;
  role?: string;
  branchId?: number;
  exp?: number;
  iat?: number;
};

/* Decodes the payload segment of a JWT client-side — base64url decode +
 * JSON.parse, no signature verification (the backend is the source of
 * truth for validity; this is only used to read `exp`/role/branchId for
 * UI purposes and to know locally whether a stored token has expired). */
function decodeJwtPayload(token: string): JwtPayload | null {
  try {
    const part = token.split(".")[1];
    if (!part) return null;
    const base64 = part.replace(/-/g, "+").replace(/_/g, "/");
    const json = decodeURIComponent(
      atob(base64)
        .split("")
        .map((c) => "%" + ("00" + c.charCodeAt(0).toString(16)).slice(-2))
        .join("")
    );
    return JSON.parse(json) as JwtPayload;
  } catch {
    return null;
  }
}

function isTokenValid(token: string | null): boolean {
  if (!token) return false;
  const payload = decodeJwtPayload(token);
  if (!payload?.exp) return false;
  return payload.exp * 1000 > Date.now();
}

// ADMIN_ROLE mirrors the backend's sole branch-scoping bypass role
// (platform.AdministratorRole, "Administrator") — every other role is
// confined to its own branch server-side; this only drives client-side UI
// (auto-locking/hiding branch selectors), never enforcement.
const ADMIN_ROLE = "Administrator";

type AuthContextValue = {
  token: string | null;
  employee: AuthEmployee | null;
  role: string | null;
  // branchId is the logged-in employee's own branch (from employee.branchId,
  // falling back to the JWT payload) — non-admin create forms auto-lock to
  // this. null while loading/logged out.
  branchId: number | null;
  isAdmin: boolean;
  loading: boolean;
  login: (identifier: string, password: string) => Promise<AuthEmployee>;
  logout: () => void;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [token, setToken] = useState<string | null>(null);
  const [employee, setEmployee] = useState<AuthEmployee | null>(null);
  const [loading, setLoading] = useState(true);

  // Restore session from localStorage on first mount, discarding it if the
  // token has already expired.
  useEffect(() => {
    const storedToken = window.localStorage.getItem(AUTH_TOKEN_KEY);
    const storedEmployee = window.localStorage.getItem(AUTH_EMPLOYEE_KEY);
    if (storedToken && isTokenValid(storedToken)) {
      setToken(storedToken);
      if (storedEmployee) {
        try {
          setEmployee(JSON.parse(storedEmployee) as AuthEmployee);
        } catch {
          setEmployee(null);
        }
      }
    } else {
      window.localStorage.removeItem(AUTH_TOKEN_KEY);
      window.localStorage.removeItem(AUTH_EMPLOYEE_KEY);
    }
    setLoading(false);
  }, []);

  const login = useCallback(async (identifier: string, password: string) => {
    const res = await loginRequest(identifier, password);
    window.localStorage.setItem(AUTH_TOKEN_KEY, res.token);
    window.localStorage.setItem(AUTH_EMPLOYEE_KEY, JSON.stringify(res.employee));
    setToken(res.token);
    setEmployee(res.employee);
    return res.employee;
  }, []);

  const logout = useCallback(() => {
    window.localStorage.removeItem(AUTH_TOKEN_KEY);
    window.localStorage.removeItem(AUTH_EMPLOYEE_KEY);
    setToken(null);
    setEmployee(null);
  }, []);

  const role = useMemo(() => employee?.role ?? decodeJwtPayload(token || "")?.role ?? null, [employee, token]);

  const branchId = useMemo(() => {
    const fromEmployee = employee?.branchId;
    if (typeof fromEmployee === "number") return fromEmployee;
    const fromToken = decodeJwtPayload(token || "")?.branchId;
    return typeof fromToken === "number" ? fromToken : null;
  }, [employee, token]);

  const isAdmin = role === ADMIN_ROLE;

  const value = useMemo(
    () => ({ token, employee, role, branchId, isAdmin, loading, login, logout }),
    [token, employee, role, branchId, isAdmin, loading, login, logout]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
}

export { isTokenValid };
