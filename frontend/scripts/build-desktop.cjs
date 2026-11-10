const { spawnSync } = require("node:child_process");
const { loadEnvConfig } = require("@next/env");

loadEnvConfig(process.cwd(), false);

const apiBase = process.env.DESKTOP_API_BASE || process.env.NEXT_PUBLIC_API_BASE;
if (!apiBase) {
  console.warn("DESKTOP_API_BASE is not set: the packaged app will call a relative /api/v1 with no host to serve it.");
}

const result = spawnSync("npx", ["next", "build"], {
  stdio: "inherit",
  shell: true,
  // DESKTOP_TENANT also names the business inside the window (its logo, name and sign-in), not just the exe icon.
  env: {
    ...process.env,
    DESKTOP_BUILD: "1",
    ...(apiBase ? { NEXT_PUBLIC_API_BASE: apiBase } : {}),
    NEXT_PUBLIC_DESKTOP_TENANT: (process.env.DESKTOP_TENANT || "").trim().toLowerCase(),
  },
});

process.exit(result.status ?? 1);
