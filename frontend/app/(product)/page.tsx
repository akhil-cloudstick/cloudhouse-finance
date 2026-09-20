"use client";

import { useEffect } from "react";
import { isTokenValid } from "@/product/providers/auth-context";
import {
  appPath,
  businessSlugFromHost,
  businessSlugFromPath,
  loginPath,
  readToken,
} from "@/product/services/tenantSession";

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
 * the app shell's dashboard, everyone else to a login page.
 *
 * The slug this page acts on comes ONLY from the path and the host, never
 * from useAuth()/activeBusinessSlug() — both of those also fall back to
 * whatever business was last remembered in this browser's localStorage. With
 * several tenants opened in the same browser over time, that remembered
 * value is whichever business was visited most recently, not "no business
 * named" — so a bare "/" would silently follow that tenant instead of
 * landing somewhere predictable. Reading the token for the resolved slug
 * directly (readToken(slug), not the ambient useAuth() token) keeps this
 * page's decision a pure function of the URL: "/" always means THIS
 * deployment's own business ("default"), while an explicit business URL
 * (/ctfi, ctfi.localhost) still wins and shows THAT business, independent of
 * whatever else is signed in in this browser. The real login form lives at
 * /login (app/login/page.tsx). */
export default function RootPage() {
  useEffect(() => {
    const slug = businessSlugFromPath() ?? businessSlugFromHost() ?? "default";
    const signedIn = isTokenValid(readToken(slug));
    window.location.replace(signedIn ? appPath(slug) : loginPath(slug));
  }, []);

  return null;
}
