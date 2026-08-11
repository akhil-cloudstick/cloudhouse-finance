import type { NextConfig } from "next";

// Production builds use `output: "export"` (static HTML, served by the Go
// binary itself — see backend/internal/webstatic) which doesn't support
// rewrites at all. `next dev` ignores `output: "export"` for dev-only
// features, so rewrites still work there — this proxies /api/v1 and
// /uploads through the Next dev server (port 3000) to the Go backend
// (port 8080), so the browser only ever talks to one port in dev too,
// matching production's single-origin setup. apiFetch/apiUpload keep using
// the relative "/api/v1" default (see lib/api.ts) — no NEXT_PUBLIC_API_BASE
// needed.
const BACKEND_ORIGIN = process.env.BACKEND_ORIGIN || "http://localhost:8080";

const nextConfig: NextConfig = {
  output: "export",
  async rewrites() {
    return [
      { source: "/api/v1/:path*", destination: `${BACKEND_ORIGIN}/api/v1/:path*` },
      { source: "/uploads/:path*", destination: `${BACKEND_ORIGIN}/uploads/:path*` },
    ];
  },
};

export default nextConfig;
