import type { NextConfig } from "next";

// Mirrors frontend/next.config.ts's own reasoning almost exactly — see that
// file's comments for the full explanation. The one thing this app does NOT
// need is the /login/:slug and /app/:slug rewrites: those exist only for the
// tenant app's per-business links, which this console has no equivalent of
// (its own two routes, "/" and "/login", are both static and known at build
// time).
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
