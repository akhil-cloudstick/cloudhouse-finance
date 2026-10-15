import type { NextConfig } from "next";

// Production builds use `output: "export"` (static HTML, served by the Go
// binary itself — see backend/internal/webstatic) which doesn't support
// rewrites at all. `next dev` ignores `output: "export"` for dev-only
// features, so rewrites still work there — this proxies /api/v1 and
// /uploads through the Next dev server (port 3000) to the Go backend
// (port 8080), so the browser only ever talks to one port in dev too,
// matching production's single-origin setup. apiFetch/apiUpload keep using
// the relative "/api/v1" default (see common/services/httpClient.ts) — no NEXT_PUBLIC_API_BASE
// needed.
const BACKEND_ORIGIN = process.env.BACKEND_ORIGIN || "http://localhost:8080";

/* What may appear where a business code is expected, as a path-to-regexp
 * constraint on the :slug parameter.
 *
 * Without it the catch-all rules below match ANY path of the right depth,
 * including a missing /_next/static/*.js chunk — which then comes back as the
 * app shell's HTML with a 200, and the browser reports a MIME type error
 * instead of the 404 that would have explained it. The API and uploads escape
 * that only because their rewrites are listed first; these prefixes have no
 * rewrite of their own and need the exclusion.
 *
 * Mirrors RESERVED_ROOT_SEGMENTS in common/config/routes.ts and
 * isReservedSegment in backend/internal/webstatic. The app's own route names
 * are deliberately NOT excluded here: "/loans" has to reach the shell either
 * way, as the bare install's loans page. */
const SLUG = "((?!_next|api|uploads|assets|static|favicon\.ico)[a-z0-9][a-z0-9-]*)";

const nextConfig: NextConfig = {
  output: "export",

  // Dev only: LAN hosts allowed to load /_next/* (JS chunks, HMR) when the app
  // is opened from another device by IP. Add more via DEV_ORIGINS=ip1,ip2.
  allowedDevOrigins: ["192.168.0.128", ...(process.env.DEV_ORIGINS?.split(",").map((s) => s.trim()).filter(Boolean) ?? [])],

  // Set only by scripts/build-desktop.cjs, so the web build keeps writing to out/.
  distDir: process.env.DESKTOP_BUILD ? "dist-desktop" : undefined,

  async rewrites() {
    return [
      { source: "/api/v1/:path*", destination: `${BACKEND_ORIGIN}/api/v1/:path*` },
      { source: "/uploads/:path*", destination: `${BACKEND_ORIGIN}/uploads/:path*` },
      // /admin/whatsapp goes through the Go backend, exactly like production
      // (backend/internal/webstatic's WhatsApp proxy strips the prefix and
      // forwards to OpenWA on WHATSAPP_ORIGIN) — no separate OpenWA port to
      // know about in dev either; OpenWA's dashboard is pre-built and served
      // by OpenWA itself (see OpenWA's dev:embedded script), so the Go
      // backend is the only thing the browser ever talks to besides Next.
      { source: "/admin/whatsapp", destination: `${BACKEND_ORIGIN}/admin/whatsapp/` },
      { source: "/admin/whatsapp/:path*", destination: `${BACKEND_ORIGIN}/admin/whatsapp/:path*` },
      // Per-business links: /<slug>, /<slug>/login, /<slug>/reset,
      // /<slug>/<route> and /<slug>/<route>/<arg> all fall back to a plain
      // static page — /<slug> is NOT a Next dynamic route (see
      // common/components/layout/AuthGuard.tsx for why a [slug] segment doesn't work with
      // `output: "export"` + a runtime-created tenant slug). The real slug
      // is read client-side from window.location by parsePath()
      // (common/services/appRoutes.ts), never from anything Next resolves.
      //
      // ORDER MATTERS. The two-segment page rules must precede the catch-all
      // route rules, or /ctfi/login would be served the app shell instead of
      // the login page. These are afterFiles rewrites, so real pages
      // (/login, /forgot-password) and real assets still win over every
      // pattern here.
      //
      // Rewrites are dev-only (output: "export" does not support them), so
      // production needs the same fallback server-side — see
      // backend/internal/webstatic's sluggedPage. Keep the two in step: a
      // path that works in dev and 404s in production is worse than one that
      // never worked.
      { source: `/:slug${SLUG}/login`, destination: "/login" },
      { source: `/:slug${SLUG}/reset`, destination: "/reset" },
      { source: `/:slug${SLUG}`, destination: "/app" },
      { source: `/:slug${SLUG}/:route`, destination: "/app" },
      { source: `/:slug${SLUG}/:route/:arg`, destination: "/app" },
    ];
  },
};

export default nextConfig;
