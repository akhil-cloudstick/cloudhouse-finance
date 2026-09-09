"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { login as loginRequest, type AuthEmployee } from "@/common/services/authService";
import { fetchMyPermissions, type PermissionMap } from "@/common/services/permissionService";
import {
  activeBusinessSlug,
  businessCodeForRequest,
  clearSession,
  purgeStaleSession,
  readEmployeeRaw,
  readPermissionsRaw,
  readToken,
  writePermissionsRaw,
  writeSession,
} from "@/common/services/tenantSession";
import { clearSelectedBranch, getSelectedBranchId, setSelectedBranchId } from "@/common/services/branchSelection";

/* The session (token, employee, and the sessionStorage mirror of the
 * permission map) is stored per business by tenantSession, not under one
 * global key. Two businesses open in two tabs would otherwise overwrite each
 * other's sign-in.
 *
 * The permission mirror still dies with the tab, is still cleared on logout,
 * and is still never an authority — see the role-permission standard's §9.3.
 * It is only keyed now. */

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

// ADMIN_ROLE mirrors the backend's Administrator role — the one true
// "manages everything, including staff and settings" role. Kept separate
// from CROSS_BRANCH_ROLES below, which is a narrower question: which roles
// see every branch's data, not which role has full administrative rights.
const ADMIN_ROLE = "Administrator";

// CROSS_BRANCH_ROLES mirrors the backend's crossBranchRoles
// (platform.branch_scope.go) — Administrator and Management both see every
// branch of their own business and can switch which one they are viewing.
// Every other role is confined to its own branch server-side; this only
// drives client-side UI (showing/hiding the branch switcher), never
// enforcement — the backend ignores the switcher header entirely for a role
// not in this set.
const CROSS_BRANCH_ROLES = new Set(["Administrator", "Management"]);

type AuthContextValue = {
  token: string | null;
  employee: AuthEmployee | null;
  role: string | null;
  // branchId is the logged-in employee's own branch (from employee.branchId,
  // falling back to the JWT payload) — non-admin create forms auto-lock to
  // this. null while loading/logged out.
  branchId: number | null;
  isAdmin: boolean;
  // isCrossBranch: this role sees every branch of the business and can use
  // the branch switcher (Administrator, Management) — see CROSS_BRANCH_ROLES.
  isCrossBranch: boolean;
  // selectedBranchId: the branch the switcher currently narrows the view to,
  // or null for "all branches". Meaningless (and ignored server-side) for a
  // role that isn't isCrossBranch.
  selectedBranchId: number | null;
  setSelectedBranch: (branchId: number | null) => void;
  loading: boolean;
  login: (identifier: string, password: string, businessCode?: string) => Promise<AuthEmployee>;
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

  // The branch switcher's current selection, read from sessionStorage via a
  // lazy initializer — session-scoped by design (see branchSelection.ts's
  // header comment) — rather than a mount effect, so there is no render with
  // a briefly-wrong value to reconcile.
  //
  // Declared here (ahead of login/logout below, which both reset it) purely
  // so those callbacks can reference the setter without a forward reference.
  const [selectedBranchId, setSelectedBranchIdState] = useState<number | null>(() => getSelectedBranchId());
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
      writePermissionsRaw(activeBusinessSlug(), JSON.stringify(data));
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
    // Housekeeping: drop the storage keys written under the app's previous
    // name. Nothing is carried over — the rebrand renamed the session keys,
    // so those values are unreadable and their holder signs in again once.
    purgeStaleSession();

    const storedToken = readToken();
    const storedEmployee = readEmployeeRaw();
    if (storedToken && isTokenValid(storedToken)) {
      setToken(storedToken);
      if (storedEmployee) {
        try {
          const emp = JSON.parse(storedEmployee) as AuthEmployee;
          setEmployee(emp);
          const cached = readPermissionsRaw();
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
      clearSession();
    }
    setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* businessCode is optional: the per-business login link supplies it from
   * the URL slug, the bare /login form from its business-code field, and a
   * single-business installation not at all (the backend resolves it). It is
   * also the slug the resulting session is stored under, so signing into a
   * second business in another tab cannot overwrite the first. */
  const login = useCallback(
    async (identifier: string, password: string, businessCode?: string) => {
      const code = businessCode?.trim() || businessCodeForRequest();
      const res = await loginRequest(identifier, password, code);
      writeSession(code || null, res.token, JSON.stringify(res.employee));
      // A fresh sign-in starts at "all branches" rather than reopening
      // whatever a previous session under this business chose.
      clearSelectedBranch(code || null);
      setSelectedBranchIdState(null);
      setToken(res.token);
      setEmployee(res.employee);
      setPermissionsLoaded(false);
      void loadPermissions(res.employee);
      return res.employee;
    },
    [loadPermissions]
  );

  /* Signs out of THIS business only. Another business signed in in another
   * tab keeps its session, which is the point of keying by slug — logging out
   * of one customer's books must not log you out of another's. */
  const logout = useCallback(() => {
    clearSession();
    // A branch selection is a lens on THIS sign-in — the next person to log
    // in on this machine (or this person, on a different business) should
    // start at "all branches", not silently inherit whatever was selected.
    clearSelectedBranch(activeBusinessSlug());
    setSelectedBranchIdState(null);
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
  const isCrossBranch = !!role && CROSS_BRANCH_ROLES.has(role);

  // effectiveSelectedBranchId is null for a role that isn't cross-branch,
  // regardless of what sessionStorage holds.
  //
  // Derived at render rather than reset in an effect: the only way a
  // signed-in session's role can change at all is a fresh login, and login
  // already clears the stored selection (see the login callback above) — so
  // there is no transition to catch here, only a value to compute. A role
  // that is not cross-branch simply never sees a selection, whatever is
  // sitting in storage from a previous session under the same slug.
  const effectiveSelectedBranchId = isCrossBranch ? selectedBranchId : null;

  const setSelectedBranch = useCallback((branchId: number | null) => {
    setSelectedBranchId(branchId);
    setSelectedBranchIdState(branchId);
  }, []);

  const value = useMemo(
    () => ({
      token,
      employee,
      role,
      branchId,
      isAdmin,
      isCrossBranch,
      selectedBranchId: effectiveSelectedBranchId,
      setSelectedBranch,
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
      isCrossBranch,
      effectiveSelectedBranchId,
      setSelectedBranch,
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
