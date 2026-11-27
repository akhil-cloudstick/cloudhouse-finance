import React, { createContext, useContext, useEffect, useRef, useState, useCallback, useMemo } from "react";
import { AppState } from "react-native";
import { Employee } from "@/modules/employees/types/employee-types";
import * as authApi from "@/common/services/authService";
import { saveToken, getToken, clearToken } from "@/common/services/tokenStorage";
import { clearBusinessCode, getBusinessCode, normalizeBusinessCode, saveBusinessCode } from "@/common/services/businessCode";
import { ApiError, setUnauthorizedHandler } from "@/common/services/httpClient";
import { fetchMyPermissions } from "@/common/services/permissionService";
import { type PermissionMap } from "@/common/types/permission-types";
import { useTheme } from "@/common/theme/ThemeProvider";
import { queryClient } from "@/common/services/queryClient";
import { clearPersistedState } from "@/common/hooks/use-persisted-state";
import { toast } from "@/common/components/ui/ToastHost";
import { setSelectedBranchId } from "@/common/services/branchSelection";
import { withPrintProgress } from "@/common/components/ui/PrintProgressHost";

type AuthState = {
  employee: Employee | null;
  isLoading: boolean;
  signIn: (identifier: string, password: string, businessCode?: string) => Promise<void>;
  signOut: () => Promise<void>;
  // The business this device is connected to ("" = none yet → the connect
  // screen). Set by connectBusiness (QR scan / typed code), kept across a
  // plain sign-out, and cleared only by exitBusiness.
  businessCode: string;
  connectBusiness: (code: string) => Promise<void>;
  // Adopts a session the backend already issued — the connect QR's login
  // token (see src/common/services/authService.ts redeemQrLogin) — instead of a typed password.
  signInWithSession: (token: string, emp: Employee, businessCode: string) => Promise<void>;
  // Signs out AND forgets the business, so the app goes back to the scanner.
  exitBusiness: () => Promise<void>;
  // Permission map — see the house role-permission standard's §9. Fetched
  // on sign-in AND on every app cold-start (the rehydrate effect below), not
  // persisted to device storage: SecureStore's per-item size limit is too
  // small for the full catalogue, and re-fetching on every launch is what
  // keeps a revoked permission from surviving past the next app open anyway.
  permissions: PermissionMap;
  permissionsLoaded: boolean;
  permissionsFailed: boolean;
  refetchPermissions: () => Promise<void>;
  // can(module, key) — `=== true` so a missing module/key/loading state all
  // deny (§10). Module/key names use the underscored form the backend
  // derives (e.g. "Loan_Management", "can_view_loan_module").
  can: (moduleKey: string, permissionKey: string) => boolean;
  // The branch switcher's selection: the branch every list is narrowed to, or null for "All branches".
  // Session-only (every sign-in starts at all branches) and ignored for a role that can't see every branch.
  selectedBranchId: number | null;
  setSelectedBranch: (branchId: number | null) => void;
};

const AuthContext = createContext<AuthState | undefined>(undefined);

type AuthProviderProps = { children: React.ReactNode };

export function AuthProvider({ children }: AuthProviderProps) {
  const { refreshBranding } = useTheme();
  const [employee, setEmployee] = useState<Employee | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [permissions, setPermissions] = useState<PermissionMap>({});
  const [permissionsLoaded, setPermissionsLoaded] = useState(false);
  const [permissionsFailed, setPermissionsFailed] = useState(false);
  const [businessCode, setBusinessCode] = useState("");
  const [selectedBranchId, setSelectedBranchState] = useState<number | null>(null);
  const employeeRef = useRef<Employee | null>(null);
  useEffect(() => {
    employeeRef.current = employee;
  }, [employee]);

  const loadPermissions = useCallback(async (emp: Employee) => {
    try {
      const data = await fetchMyPermissions(emp.id);
      setPermissions(data);
      setPermissionsFailed(false);
    } catch {
      // Fail closed (empty map) but still mark `loaded` — a guard blocking
      // on `loaded` must not hang forever (§9.4).
      setPermissions({});
      setPermissionsFailed(true);
    } finally {
      setPermissionsLoaded(true);
    }
  }, []);

  // Rehydrate session on app restart: if a token is stored, confirm it's
  // still valid by calling /auth/me rather than trusting a decoded JWT, then
  // load this session's permissions fresh (§9.2 — every app mount, not just
  // login).
  useEffect(() => {
    (async () => {
      try {
        setBusinessCode(await getBusinessCode());

        const token = await getToken();
        if (token) {
          // Only a 401 means a bad session; network/408/5xx are retried with a
          // short backoff, then the error propagates (and the session is kept).
          let emp: Employee | null = null;
          for (let attempt = 0; emp === null; attempt++) {
            try {
              emp = await authApi.me();
            } catch (e) {
              const transient = e instanceof ApiError && (e.status === 0 || e.status === 408 || e.status >= 500);
              if (!transient || attempt >= 2) throw e;
              await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
            }
          }
          setEmployee(emp);
          await loadPermissions(emp);
        }
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) {
          await clearToken();
          // The theme may have tried the signed-in /branding with this dead
          // token; re-fetch now that it's gone so the public one is used.
          refreshBranding();
        }
      } finally {
        setIsLoading(false);
      }
    })();
  }, [loadPermissions, refreshBranding]);

  const signIn = useCallback(
    async (identifier: string, password: string, businessCode = "") => {
      const code = normalizeBusinessCode(businessCode);
      const { token, employee: emp } = await authApi.login(identifier, password, code);
      // Remembered only after login actually worked, so a mistyped code is
      // never persisted and offered back on the next sign-in.
      await saveBusinessCode(code);
      if (code) setBusinessCode(code);
      await saveToken(token);
      // A fresh sign-in starts at "All branches", not at whatever the last session had picked.
      setSelectedBranchId(null);
      setSelectedBranchState(null);
      // Permissions first, employee last: the root redirect fires on `employee`, and the tabs
      // would otherwise open on the permissions spinner.
      await loadPermissions(emp);
      setEmployee(emp);
      // The business code (and therefore its branding) may have just
      // changed, and the theme can now use the authenticated /branding
      // endpoint instead of the public one.
      refreshBranding();
    },
    [loadPermissions, refreshBranding]
  );

  const signInWithSession = useCallback(
    async (token: string, emp: Employee, code: string) => {
      await saveBusinessCode(code);
      const saved = await getBusinessCode();
      await saveToken(token);
      setSelectedBranchId(null);
      setSelectedBranchState(null);
      // Set together (batched) so the root navigator never sees a business
      // with no employee, which would flash the login page before the dashboard.
      await loadPermissions(emp);
      setBusinessCode(saved);
      setEmployee(emp);
      refreshBranding();
    },
    [loadPermissions, refreshBranding]
  );

  const signOut = useCallback(async () => {
    await clearToken();
    setSelectedBranchId(null);
    setSelectedBranchState(null);
    queryClient.clear();
    clearPersistedState();
    setEmployee(null);
    setPermissions({});
    setPermissionsLoaded(false);
    setPermissionsFailed(false);
    // Drops back to the public branding endpoint for the still-remembered
    // business code (my /branding was only valid for the ended session).
    refreshBranding();
  }, [refreshBranding]);

  const refetchPermissions = useCallback(async () => {
    if (employeeRef.current) await loadPermissions(employeeRef.current);
  }, [loadPermissions]);

  // Back in the foreground: pick up permission changes silently, keeping the
  // current map until the new one arrives.
  useEffect(() => {
    const sub = AppState.addEventListener("change", (status) => {
      const emp = employeeRef.current;
      if (status !== "active" || !emp) return;
      fetchMyPermissions(emp.id)
        .then((data) => {
          if (employeeRef.current?.id !== emp.id) return;
          setPermissions(data);
          setPermissionsFailed(false);
        })
        .catch(() => {});
    });
    return () => sub.remove();
  }, []);

  // A 401 on any signed-in call ends the session (see httpClient).
  useEffect(() => {
    setUnauthorizedHandler((message) => {
      if (!employeeRef.current) return;
      employeeRef.current = null;
      toast.error("Signed out", message);
      signOut();
    });
    return () => setUnauthorizedHandler(null);
  }, [signOut]);

  const connectBusiness = useCallback(
    async (code: string) => {
      await saveBusinessCode(code);
      setBusinessCode(await getBusinessCode());
      refreshBranding();
    },
    [refreshBranding]
  );

  const exitBusiness = useCallback(async () => {
    await signOut();
    await clearBusinessCode();
    setBusinessCode("");
    refreshBranding();
  }, [signOut, refreshBranding]);

  const can = useCallback(
    (moduleKey: string, permissionKey: string) => permissions?.[moduleKey]?.[permissionKey] === true,
    [permissions]
  );

  // A role that can't see every branch never has a selection, whatever the state holds.
  const effectiveSelectedBranchId = can("Branch_Management", "can_view_all_branches") ? selectedBranchId : null;

  const setSelectedBranch = useCallback((branchId: number | null) => {
    setSelectedBranchId(branchId);
    setSelectedBranchState(branchId);
    // Every list is now scoped to another branch (X-Branch-Id): drop what was cached for the old scope and
    // refetch what is on screen.
    // Everything except the branch list itself (which must stay instant) and only the screens that are mounted;
    // the rest are marked stale and load when next opened.
    // The loading overlay stays up until the screens that are open have their new data (invalidateQueries
    // resolves when those refetches settle); capped so a dead connection can never leave it covering the app.
    const reload = queryClient.invalidateQueries({ predicate: (q) => q.queryKey[0] !== "branches" || q.queryKey[1] !== "switchable" });
    withPrintProgress(() => Promise.race([reload, new Promise((r) => setTimeout(r, 15000))]), "Loading branch…").catch(() => {});
  }, []);

  const value = useMemo(
    () => ({ employee, isLoading, signIn, signOut, businessCode, connectBusiness, signInWithSession, exitBusiness, permissions, permissionsLoaded, permissionsFailed, refetchPermissions, can, selectedBranchId: effectiveSelectedBranchId, setSelectedBranch }),
    [employee, isLoading, signIn, signOut, businessCode, connectBusiness, signInWithSession, exitBusiness, permissions, permissionsLoaded, permissionsFailed, refetchPermissions, can, effectiveSelectedBranchId, setSelectedBranch]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}

export function usePermission(moduleKey: string, permissionKey: string): boolean {
  return useAuth().can(moduleKey, permissionKey);
}

// Role display helper — mirrors the employee's role name for UI text (e.g.
// "Admin · Administrator" in MoreSheet). Never used for authorization
// decisions any more — see usePermission/can above, which read the real
// permissions table instead of a hardcoded role-name check.
export function useRole(): string | undefined {
  return useAuth().employee?.role;
}
