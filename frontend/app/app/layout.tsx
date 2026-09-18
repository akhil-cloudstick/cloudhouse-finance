"use client";

import { useEffect, useRef } from "react";
import { useAuth } from "@/common/auth-context";
import { loginPath } from "@/common/services/tenantSession";

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

/* Single guard point for the whole authenticated app shell (app/app/page.tsx
 * and anything else added under app/app/*). If there's no valid, unexpired
 * JWT once the auth state has finished restoring from localStorage, bounce
 * to the login page. /login, /forgot-password, /reset-password live outside this
 * route segment and are unaffected. */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { token, loading } = useAuth();

  /* Fires at most once per document. Signing out drops the token here AND
   * navigates from Topbar's own handler, so without the latch this guard
   * issued a second replace() into a navigation that was already in flight —
   * the later call aborts the earlier one, and an aborted leave is how the
   * browser ends up sitting on a page it was told twice to leave. Once we
   * have decided to go, the decision stands. */
  const redirectedRef = useRef(false);

  useEffect(() => {
    if (loading || token || redirectedRef.current) return;
    redirectedRef.current = true;
    // Keeps the business slug, so a bounced user lands back on their own
    // organisation's sign-in link rather than a bare form that would ask
    // for a business code they may never have been told.
    window.location.replace(loginPath());
  }, [loading, token]);

  if (loading || !token) return null;

  return <>{children}</>;
}
