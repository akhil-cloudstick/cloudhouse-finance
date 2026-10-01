"use client";

import { createContext, useCallback, useContext, useMemo, useState, useLayoutEffect } from "react";
import { login as loginRequest, type AuthEmployee } from "@/product/services/authService";
import { fetchMyPermissions, type PermissionMap } from "@/product/services/permissionService";
import {
  DEFAULT_APPROVAL_WORKFLOW,
  fetchApprovalWorkflow,
  type ApprovalWorkflowConfig,
} from "@/product/services/approvalWorkflowService";
import {
  activeBusinessSlug,
  businessCodeForRequest,
  clearSession,
  clearSessionsForToken,
  purgeStaleSession,
  readEmployeeRaw,
  readPermissionsRaw,
  readToken,
  writePermissionsRaw,
  writeSession,
} from "@/product/services/tenantSession";
import { clearSelectedBranch, getSelectedBranchId, setSelectedBranchId } from "@/product/services/branchSelection";

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
  // This business's approval-workflow configuration (which stages of each
  // approval flow are switched on) — loaded next to the permission map and
  // falling back to the catalogue defaults until/unless the fetch succeeds.
  // Read it through useApprovalWorkflow() below.
  approvalWorkflow: ApprovalWorkflowConfig;
  refreshApprovalWorkflow: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  // Every piece of session state below starts from the same SSR-safe
  // default (null/true/{}/false) on both the server and the client's FIRST
  // render — never a lazy initializer reading localStorage/sessionStorage
  // directly, which used to return one thing server-side (no storage exists
  // there) and a DIFFERENT thing on the client's first render (the real
  // stored session), a guaranteed hydration mismatch that threw away and
  // rebuilt this entire subtree on every page load in dev (`next dev` still
  // server-renders this "use client" page per-request; only the production
  // static export skips that step, which is why this only ever surfaced in
  // dev).
  //
  // The restore below still runs before the browser paints anything,
  // though: `useLayoutEffect` (unlike `useEffect`) fires synchronously after
  // the DOM commit but before paint, so a valid stored session still swaps
  // in fast enough that no visible blank/"headerless" frame appears — same
  // user-facing result the old synchronous initializers were after, just
  // moved to a point in the lifecycle where hydration has already reconciled
  // against the identical (default) values the server rendered.
  const [token, setToken] = useState<string | null>(null);
  const [employee, setEmployee] = useState<AuthEmployee | null>(null);

  // The branch switcher's current selection — session-scoped by design (see
  // branchSelection.ts's header comment).
  //
  // Declared here (ahead of login/logout below, which both reset it) purely
  // so those callbacks can reference the setter without a forward reference.
  const [selectedBranchId, setSelectedBranchIdState] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  const [permissions, setPermissions] = useState<PermissionMap>({});
  const [permissionsLoaded, setPermissionsLoaded] = useState(false);
  const [permissionsFailed, setPermissionsFailed] = useState(false);
  const [approvalWorkflow, setApprovalWorkflow] = useState<ApprovalWorkflowConfig>(DEFAULT_APPROVAL_WORKFLOW);

  // Not an authority either — every stage transition is enforced
  // server-side. On failure the catalogue defaults stay in place so trackers
  // and buttons still render something sensible.
  const loadApprovalWorkflow = useCallback(async () => {
    try {
      const data = await fetchApprovalWorkflow();
      if (data.length) setApprovalWorkflow(data);
    } catch {
      /* keep whatever is already loaded (defaults on first load) */
    }
  }, []);

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

  // Restore session from localStorage before the browser paints, discarding
  // it if the token has already expired. `useLayoutEffect`, not `useEffect`
  // — it runs synchronously right after this render commits to the DOM but
  // before the browser draws anything, so a valid stored session swaps in
  // ahead of the first visible frame instead of after it (no blank/
  // "headerless" flash), while every render up to and including this one
  // still matched the server's SSR-safe defaults (see the state
  // declarations' own comment above for why that match matters).
  useLayoutEffect(() => {
    // Housekeeping: drop the storage keys written under the app's previous
    // name. Nothing is carried over — the rebrand renamed the session keys,
    // so those values are unreadable and their holder signs in again once.
    purgeStaleSession();

    setSelectedBranchIdState(getSelectedBranchId());

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
          void loadApprovalWorkflow();
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
      void loadApprovalWorkflow();
      return res.employee;
    },
    [loadPermissions, loadApprovalWorkflow]
  );

  /* Signs out of THIS business only. Another business signed in in another
   * tab keeps its session, which is the point of keying by slug — logging out
   * of one customer's books must not log you out of another's. */
  const logout = useCallback(() => {
    /* Resolve the slug ONCE and clear everything against that one answer.
     *
     * clearSession() used to be called with no slug, which made it re-resolve
     * activeBusinessSlug() internally — and that walks path, then host, then
     * the remembered-business pointer. So the key it removed was whatever the
     * URL happened to say at that instant, while the login page then read the
     * key its OWN url resolved to. When those disagreed, the token survived,
     * the login page saw a valid session and bounced straight back to the
     * dashboard: the "first click on Sign out does nothing" bug. */
    const slug = activeBusinessSlug();
    clearSession(slug);
    /* ...and then again by TOKEN VALUE, which is the authoritative sweep.
     *
     * The slug above is still resolved from the URL, and the paragraph above
     * describes why that can be the wrong answer. When it is, the line above
     * removes a key that was never there and the real token lives on under
     * the bucket writeSession actually chose — so the login page reads a live
     * session and bounces back to the dashboard, the "sign out, see login for
     * a moment, land back on home" bug. clearSessionsForToken finds the token
     * wherever it is; matching on the value means it cannot touch another
     * business's session in another tab. */
    clearSessionsForToken(token);
    // A branch selection is a lens on THIS sign-in — the next person to log
    // in on this machine (or this person, on a different business) should
    // start at "all branches", not silently inherit whatever was selected.
    clearSelectedBranch(slug);
    setSelectedBranchIdState(null);
    setToken(null);
    setEmployee(null);
    setPermissions({});
    setPermissionsLoaded(false);
    setPermissionsFailed(false);
    setApprovalWorkflow(DEFAULT_APPROVAL_WORKFLOW);
    // `token` is a real dependency now, not incidental: clearSessionsForToken
    // matches on its value. Signing out with a stale closure would sweep the
    // PREVIOUS token's buckets and leave the current one behind.
  }, [token]);

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
      approvalWorkflow,
      refreshApprovalWorkflow: loadApprovalWorkflow,
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
      approvalWorkflow,
      loadApprovalWorkflow,
    ]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
}

/* The approval-workflow configuration plus a refresh (call after saving it
 * on the Roles & Permissions page). Pair with the lookup helpers in
 * approvalWorkflowService.ts (chainFor, stageByPending, isFinalStage, …). */
export function useApprovalWorkflow(): { config: ApprovalWorkflowConfig; refresh: () => Promise<void> } {
  const { approvalWorkflow, refreshApprovalWorkflow } = useAuth();
  return { config: approvalWorkflow, refresh: refreshApprovalWorkflow };
}

export { isTokenValid };
