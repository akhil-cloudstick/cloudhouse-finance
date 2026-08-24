import React, { createContext, useContext, useEffect, useState, useCallback, useMemo } from "react";
import { Employee } from "../types/employee";
import * as authApi from "../api/auth";
import { saveToken, getToken, clearToken } from "./tokenStorage";
import { ApiError } from "../api/client";
import { fetchMyPermissions, type PermissionMap } from "../api/permissions";

type AuthState = {
  employee: Employee | null;
  isLoading: boolean;
  signIn: (identifier: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
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
  const [employee, setEmployee] = useState<Employee | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [permissions, setPermissions] = useState<PermissionMap>({});
  const [permissionsLoaded, setPermissionsLoaded] = useState(false);
  const [permissionsFailed, setPermissionsFailed] = useState(false);

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
        const token = await getToken();
        if (token) {
          const emp = await authApi.me();
          setEmployee(emp);
          await loadPermissions(emp);
        }
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) {
          await clearToken();
        }
      } finally {
        setIsLoading(false);
      }
    })();
  }, [loadPermissions]);

  const signIn = useCallback(
    async (identifier: string, password: string) => {
      const { token, employee: emp } = await authApi.login(identifier, password);
      await saveToken(token);
      setEmployee(emp);
      setPermissionsLoaded(false);
      await loadPermissions(emp);
    },
    [loadPermissions]
  );

  const signOut = useCallback(async () => {
    await clearToken();
    setEmployee(null);
    setPermissions({});
    setPermissionsLoaded(false);
    setPermissionsFailed(false);
  }, []);

  const can = useCallback(
    (moduleKey: string, permissionKey: string) => permissions?.[moduleKey]?.[permissionKey] === true,
    [permissions]
  );

  const value = useMemo(
    () => ({ employee, isLoading, signIn, signOut, permissions, permissionsLoaded, permissionsFailed, can }),
    [employee, isLoading, signIn, signOut, permissions, permissionsLoaded, permissionsFailed, can]
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
