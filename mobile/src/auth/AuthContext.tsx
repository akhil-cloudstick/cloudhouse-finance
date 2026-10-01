import React, { createContext, useContext, useEffect, useState, useCallback, useMemo } from "react";
import { Employee } from "../types/employee";
import * as authApi from "../api/auth";
import { saveToken, getToken, clearToken } from "./tokenStorage";
import { clearBusinessCode, getBusinessCode, normalizeBusinessCode, saveBusinessCode } from "./businessCode";
import { ApiError } from "../api/client";
import { fetchMyPermissions, type PermissionMap } from "../api/permissions";
import { useTheme } from "../theme/ThemeProvider";

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
  // can(module, key) — `=== true` so a missing module/key/loading state all
  // deny (§10). Module/key names use the underscored form the backend
  // derives (e.g. "Loan_Management", "can_view_loan").
  can: (moduleKey: string, permissionKey: string) => boolean;
};

const AuthContext = createContext<AuthState | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const { refreshBranding } = useTheme();
  const [employee, setEmployee] = useState<Employee | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [permissions, setPermissions] = useState<PermissionMap>({});
  const [permissionsLoaded, setPermissionsLoaded] = useState(false);
  const [permissionsFailed, setPermissionsFailed] = useState(false);
  const [businessCode, setBusinessCode] = useState("");

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
          const emp = await authApi.me();
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
      setEmployee(emp);
      setPermissionsLoaded(false);
      await loadPermissions(emp);
      // The business code (and therefore its branding) may have just
      // changed, and the theme can now use the authenticated /branding
      // endpoint instead of the public one.
      refreshBranding();
    },
    [loadPermissions, refreshBranding]
  );

  const signOut = useCallback(async () => {
    await clearToken();
    setEmployee(null);
    setPermissions({});
    setPermissionsLoaded(false);
    setPermissionsFailed(false);
    // Drops back to the public branding endpoint for the still-remembered
    // business code (my /branding was only valid for the ended session).
    refreshBranding();
  }, [refreshBranding]);

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

  const value = useMemo(
    () => ({ employee, isLoading, signIn, signOut, businessCode, connectBusiness, exitBusiness, permissions, permissionsLoaded, permissionsFailed, can }),
    [employee, isLoading, signIn, signOut, businessCode, connectBusiness, exitBusiness, permissions, permissionsLoaded, permissionsFailed, can]
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
