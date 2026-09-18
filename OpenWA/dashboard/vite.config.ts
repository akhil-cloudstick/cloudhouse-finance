import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Single source of truth for the version shown in the dashboard: the ROOT package.json, which is
// what a release bumps and what `npm run check:versions` gates. Resolved relative to this config
// file (not process.cwd()), because the dashboard is normally built from inside `dashboard/` — where
// cwd-relative resolution picks up `dashboard/package.json` instead. That file is not touched by a
// release, so the Login screen kept rendering whatever version it happened to be pinned at while the
// gateway moved on. The sidebar hid the drift by replacing the build-time value with the live
// version from the API (see Layout.tsx); the Login screen has no session yet, so it shows this
// constant verbatim. APP_VERSION env still overrides if explicitly provided.
const { version: pkgVersion } = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf-8'),
) as {
  version: string;
};

// https://vite.dev/config/
// Served under /admin/whatsapp on the gold-app frontend's single origin
// (see frontend/next.config.ts in dev, and backend/internal/webstatic's
// WhatsApp proxy in production) rather than its own port. `base` makes every
// asset/HMR/index URL Vite emits carry that prefix, matching what the
// gold-app proxy layer forwards; the /api and /socket.io proxy rules below
// strip it back off before reaching this dev server's own Nest API, which
// stays unaware of the prefix.
const PUBLIC_PATH = '/admin/whatsapp/';

export default defineConfig({
  base: PUBLIC_PATH,
  plugins: [react()],
  appType: 'spa', // Enable SPA fallback for client-side routing
  define: {
    __APP_VERSION__: JSON.stringify(process.env.APP_VERSION || pkgVersion),
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  },
  server: {
    port: 2886,
    proxy: {
      '^/admin/whatsapp/api': {
        target: 'http://localhost:2785',
        changeOrigin: true,
        secure: false,
        rewrite: (path) => path.replace(/^\/admin\/whatsapp/, ''),
      },
      // Proxy the WebSocket (socket.io) transport so the dashboard's real-time
      // chats/sessions streams work against the dev backend.
      '^/admin/whatsapp/socket.io': {
        target: 'http://localhost:2785',
        ws: true,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/admin\/whatsapp/, ''),
      },
    },
  },
});
