"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/common/auth-context";
import { loginPath } from "@/common/services/tenantSession";

/* Single guard point for the whole authenticated app shell (app/app/page.tsx
 * and anything else added under app/app/*). If there's no valid, unexpired
 * JWT once the auth state has finished restoring from localStorage, bounce
 * to the login page. /login, /forgot-password, /reset-password live outside this
 * route segment and are unaffected. */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { token, loading } = useAuth();

  useEffect(() => {
    if (!loading && !token) {
      // Keeps the business slug, so a bounced user lands back on their own
      // organisation's sign-in link rather than a bare form that would ask
      // for a business code they may never have been told.
      router.replace(loginPath());
    }
  }, [loading, token, router]);

  if (loading || !token) return null;

  return <>{children}</>;
}
