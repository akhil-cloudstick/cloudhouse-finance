import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import { Employee } from "../types/employee";
import * as authApi from "../api/auth";
import { saveToken, getToken, clearToken } from "./tokenStorage";
import { ApiError } from "../api/client";

type AuthState = {
  employee: Employee | null;
  isLoading: boolean;
  signIn: (identifier: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthState | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [employee, setEmployee] = useState<Employee | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Rehydrate session on app restart: if a token is stored, confirm it's
  // still valid by calling /auth/me rather than trusting a decoded JWT.
  useEffect(() => {
    (async () => {
      try {
        const token = await getToken();
        if (token) {
          const emp = await authApi.me();
          setEmployee(emp);
        }
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) {
          await clearToken();
        }
      } finally {
        setIsLoading(false);
      }
    })();
  }, []);

  const signIn = useCallback(async (identifier: string, password: string) => {
    const { token, employee: emp } = await authApi.login(identifier, password);
    await saveToken(token);
    setEmployee(emp);
  }, []);

  const signOut = useCallback(async () => {
    await clearToken();
    setEmployee(null);
  }, []);

  return (
    <AuthContext.Provider value={{ employee, isLoading, signIn, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}

// Role-gating helpers — mirror the web app's per-role UI conventions
// (frontend/components/*) so the mobile UI hides actions the backend would
// reject anyway (e.g. Cashier can't create a loan) without re-implementing
// the backend's authority on the rule.
export function useRole(): string | undefined {
  return useAuth().employee?.role;
}

export function useIsAdministrator(): boolean {
  return useRole() === "Administrator";
}
