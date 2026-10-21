import React, { createContext, useContext, useState, useCallback } from "react";
import { Customer } from "@/common/types/customer-types";
import { SessionResponse } from "@/modules/auth/services/authService";
import { saveToken, clearToken } from "@/common/services/tokenStorage";
import { clearDeviceToken } from "@/common/services/deviceToken";
import * as profileApi from "@/common/services/profileService";
import { useTheme } from "@/common/theme/ThemeProvider";

type AuthState = {
  customer: Customer | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  setLoading: (v: boolean) => void;
  completeLogin: (session: SessionResponse) => Promise<void>;
  // Marks the session valid on a refreshed stored token; callers should also call refreshProfile().
  markAuthenticated: () => void;
  refreshProfile: () => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthState | undefined>(undefined);

type AuthProviderProps = { children: React.ReactNode };

export function AuthProvider({ children }: AuthProviderProps) {
  const { refreshBranding } = useTheme();
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  const completeLogin = useCallback(
    async (session: SessionResponse) => {
      await saveToken(session.token);
      setCustomer(session.customer);
      setIsAuthenticated(true);
      refreshBranding();
    },
    [refreshBranding]
  );

  const markAuthenticated = useCallback(() => {
    setIsAuthenticated(true);
  }, []);

  const refreshProfile = useCallback(async () => {
    const profile = await profileApi.getProfile();
    setCustomer(profile);
  }, []);

  const signOut = useCallback(async () => {
    await clearToken();
    await clearDeviceToken();
    setCustomer(null);
    setIsAuthenticated(false);
    refreshBranding();
  }, [refreshBranding]);

  return (
    <AuthContext.Provider
      value={{
        customer,
        isAuthenticated,
        isLoading,
        setLoading: setIsLoading,
        completeLogin,
        markAuthenticated,
        refreshProfile,
        signOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
