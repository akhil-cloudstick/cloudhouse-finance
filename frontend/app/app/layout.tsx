"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/common/auth-context";

/* Single guard point for the whole authenticated app shell (app/app/page.tsx
 * and anything else added under app/app/*). If there's no valid, unexpired
 * JWT once the auth state has finished restoring from localStorage, bounce
 * to /login. /login, /forgot-password, /reset-password live outside this
 * route segment and are unaffected. */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { token, loading } = useAuth();

  useEffect(() => {
    if (!loading && !token) {
      router.replace("/login");
    }
  }, [loading, token, router]);

  if (loading || !token) return null;

  return <>{children}</>;
}
