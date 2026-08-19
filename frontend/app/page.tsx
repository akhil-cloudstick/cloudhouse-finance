"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/common/auth-context";

/* Root route is just a traffic director: signed-in visitors go straight to
 * the app shell's dashboard, everyone else to /login. The real login form
 * lives at /login (app/login/page.tsx). */
export default function RootPage() {
  const router = useRouter();
  const { token, loading } = useAuth();

  useEffect(() => {
    if (loading) return;
    router.replace(token ? "/app#dashboard" : "/login");
  }, [loading, token, router]);

  return null;
}
