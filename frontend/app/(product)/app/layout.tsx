"use client";

import { useEffect, useRef } from "react";
import { useAuth } from "@/product/providers/auth-context";
import { loginPath } from "@/product/services/tenantSession";

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
 *
 * This is a plain static route (not a dynamic [slug] segment): `output:
 * "export"` requires every dynamic segment's params to be known at build
 * time, and tenant slugs are created at runtime by the vendor, so there is no
 * real list to generate. A [slug] folder was tried and reverted — Next 16's
 * dev server enforces generateStaticParams() even in `next dev`, so any real
 * slug other than the build-time placeholder 500'd. The rewrites in
 * next.config.ts (dev) and webstatic's sluggedPage (prod) already map every
 * business URL down to this one static page; the real slug is read from
 * window.location by parsePath()/appRoutes.ts, never from a route param. */
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
