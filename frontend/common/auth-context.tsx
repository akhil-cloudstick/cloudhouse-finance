"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { AUTH_EMPLOYEE_KEY, AUTH_TOKEN_KEY } from "@/common/services/httpClient";
import { login as loginRequest, type AuthEmployee } from "@/common/services/authService";
import { fetchMyPermissions, type PermissionMap } from "@/common/services/permissionService";

/* sessionStorage mirror of the permission map — dies with the tab, cleared
 * explicitly on logout, never persisted long-term (see the house
 * role-permission standard's §9.3). Lets a refresh rehydrate instantly
 * instead of flashing a loading state. */
const PERMISSIONS_SESSION_KEY = "ambikagold_permissions";

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
  // Permission map — see the house role-permission standard's §9. Fetched on
  // login and on every app mount (fetchPermissions below), never derived
  // from the JWT (a revoked permission must take effect on next load without
  // waiting for the token to expire).
  permissions: PermissionMap;
  permissionsLoaded: boolean;
  permissionsFailed: boolean;
  // can(module, key) is the one lookup every gate/guard/nav-filter in this
  // app uses — `=== true` so a missing module/key/loading state all deny
  // (§10). Module/key names use the underscored form the backend already
  // derives (e.g. "Loan_Management", "can_view_loan").
  can: (moduleKey: string, permissionKey: string) => boolean;
  refetchPermissions: () => void;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [token, setToken] = useState<string | null>(null);
  const [employee, setEmployee] = useState<AuthEmployee | null>(null);
  const [loading, setLoading] = useState(true);

  const [permissions, setPermissions] = useState<PermissionMap>({});
  const [permissionsLoaded, setPermissionsLoaded] = useState(false);
  const [permissionsFailed, setPermissionsFailed] = useState(false);

  // Fetched on login AND on every app mount (the effect below) — a refresh
  // must not run on a potentially days-old cached grant (§9.2). Mirrors into
  // sessionStorage so a refresh rehydrates instantly; on failure sets
  // `loaded` anyway (so guards don't hang forever) plus `failed` (so a
  // retry banner can render) with an empty map (fail closed, §9.4).
  const loadPermissions = useCallback(async (emp: AuthEmployee) => {
    try {
      const data = await fetchMyPermissions(emp.id);
      setPermissions(data);
      setPermissionsFailed(false);
      window.sessionStorage.setItem(PERMISSIONS_SESSION_KEY, JSON.stringify(data));
    } catch {
      setPermissions({});
      setPermissionsFailed(true);
    } finally {
      setPermissionsLoaded(true);
    }
  }, []);

  // Restore session from localStorage on first mount, discarding it if the
  // token has already expired.
  useEffect(() => {
    const storedToken = window.localStorage.getItem(AUTH_TOKEN_KEY);
    const storedEmployee = window.localStorage.getItem(AUTH_EMPLOYEE_KEY);
    if (storedToken && isTokenValid(storedToken)) {
      setToken(storedToken);
      if (storedEmployee) {
        try {
          const emp = JSON.parse(storedEmployee) as AuthEmployee;
          setEmployee(emp);
          const cached = window.sessionStorage.getItem(PERMISSIONS_SESSION_KEY);
          if (cached) {
            try {
              setPermissions(JSON.parse(cached) as PermissionMap);
              setPermissionsLoaded(true);
            } catch {
              /* fall through to a live fetch below */
            }
          }
          void loadPermissions(emp);
        } catch {
          setEmployee(null);
        }
      }
    } else {
      window.localStorage.removeItem(AUTH_TOKEN_KEY);
      window.localStorage.removeItem(AUTH_EMPLOYEE_KEY);
      window.sessionStorage.removeItem(PERMISSIONS_SESSION_KEY);
    }
    setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const login = useCallback(
    async (identifier: string, password: string) => {
      const res = await loginRequest(identifier, password);
      window.localStorage.setItem(AUTH_TOKEN_KEY, res.token);
      window.localStorage.setItem(AUTH_EMPLOYEE_KEY, JSON.stringify(res.employee));
      setToken(res.token);
      setEmployee(res.employee);
      setPermissionsLoaded(false);
      void loadPermissions(res.employee);
      return res.employee;
    },
    [loadPermissions]
  );

  const logout = useCallback(() => {
    window.localStorage.removeItem(AUTH_TOKEN_KEY);
    window.localStorage.removeItem(AUTH_EMPLOYEE_KEY);
    window.sessionStorage.removeItem(PERMISSIONS_SESSION_KEY);
    setToken(null);
    setEmployee(null);
    setPermissions({});
    setPermissionsLoaded(false);
    setPermissionsFailed(false);
  }, []);

  const refetchPermissions = useCallback(() => {
    if (employee) void loadPermissions(employee);
  }, [employee, loadPermissions]);

  const can = useCallback(
    (moduleKey: string, permissionKey: string) => permissions?.[moduleKey]?.[permissionKey] === true,
    [permissions]
  );

  const role = useMemo(() => employee?.role ?? decodeJwtPayload(token || "")?.role ?? null, [employee, token]);

  const branchId = useMemo(() => {
    const fromEmployee = employee?.branchId;
    if (typeof fromEmployee === "number") return fromEmployee;
    const fromToken = decodeJwtPayload(token || "")?.branchId;
    return typeof fromToken === "number" ? fromToken : null;
  }, [employee, token]);

  const isAdmin = role === ADMIN_ROLE;

  const value = useMemo(
    () => ({
      token,
      employee,
      role,
      branchId,
      isAdmin,
      loading,
      login,
      logout,
      permissions,
      permissionsLoaded,
      permissionsFailed,
      can,
      refetchPermissions,
    }),
    [
      token,
      employee,
      role,
      branchId,
      isAdmin,
      loading,
      login,
      logout,
      permissions,
      permissionsLoaded,
      permissionsFailed,
      can,
      refetchPermissions,
    ]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
}

export { isTokenValid };
