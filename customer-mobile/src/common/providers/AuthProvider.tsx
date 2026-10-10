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
  // Called after any successful sign-in path (OTP verify or device-login):
  // persists the session token and stores the customer in memory.
  completeLogin: (session: SessionResponse) => Promise<void>;
  // Used by app/_layout.tsx's cold-start bootstrap when a stored session
  // token is refreshed successfully — marks the session valid; callers
  // should also call refreshProfile() to populate `customer` on this path
  // (see the Batch 4 GET /customer/profile endpoint).
  markAuthenticated: () => void;
  // Batch 4: (re)fetches the full profile via GET /customer/profile and
  // updates `customer`. Used both to fill the gap left by markAuthenticated
  // (session-refresh bootstrap has no customer object of its own) and after
  // a PAN/Aadhaar verification completes, to reflect the new KYC status.
  refreshProfile: () => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthState | undefined>(undefined);

type AuthProviderProps = { children: React.ReactNode };

// Unlike the staff app's AuthContext, there was no "rehydrate on mount by
// calling /me" here until Batch 4 — the customer app's bootstrap is the
// biometric/device token flow in app/_layout.tsx (device-login already
// resolves the customer). refreshProfile() now covers the one bootstrap
// path that didn't: a stored-session-token refresh, which has no customer
// object of its own to hand back.
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
      // The lender code may have just changed, and the theme can now use
      // the authenticated /branding endpoint instead of the public one.
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
