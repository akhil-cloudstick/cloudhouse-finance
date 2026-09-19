"use client";

import { useEffect } from "react";
import { useAuth } from "@/product/providers/auth-context";
import { appPath, loginPath } from "@/product/services/tenantSession";

/* Cross-page moves are FULL document loads (window.location), not Next's
 * client router.
 *
 * The console, the sign-in page and the reset tool are three separate
 * documents in the static export, and the business-first URLs that reach them
 * (/ctfi/dashboard, /ctfi/login) exist only as a server-side fallback — see
 * webstatic's sluggedPage and next.config.ts's rewrites. Next's router knows
 * nothing about them and would try to client-navigate to a route it cannot
 * find. A real navigation also discards every provider and cache belonging to
 * the page being left, which is what moving between businesses requires.
 */

/* Root route is just a traffic director: signed-in visitors go straight to
 * the app shell's dashboard, everyone else to /login. The real login form
 * lives at /login (app/login/page.tsx). */
export default function RootPage() {
  const { token, loading } = useAuth();

  useEffect(() => {
    if (loading) return;
    window.location.replace(token ? appPath() : loginPath());
  }, [loading, token]);

  return null;
}
