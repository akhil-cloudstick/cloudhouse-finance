"use client";

import { useEffect, useRef } from "react";
import { useAuth } from "@/common/providers/AuthProvider";
import { loginPath } from "@/common/services/tenantSession";

type AuthGuardProps = { children: React.ReactNode };

// Full document load (window.location), not Next's client router: these are separate static documents,
// and a [slug] route isn't viable since tenant slugs don't exist at build time (see next.config.ts rewrites).
export default function AuthGuard({ children }: AuthGuardProps) {
  const { token, loading } = useAuth();

  // Latched so sign-out's own navigation (from Topbar) and this guard don't both call replace() and race.
  const redirectedRef = useRef(false);

  useEffect(() => {
    if (loading || token || redirectedRef.current) return;
    redirectedRef.current = true;
    window.location.replace(loginPath());
  }, [loading, token]);

  if (loading || !token) return null;

  return <>{children}</>;
}
