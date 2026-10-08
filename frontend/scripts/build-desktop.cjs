const { spawnSync } = require("node:child_process");
const { loadEnvConfig } = require("@next/env");

loadEnvConfig(process.cwd(), false);

if (!process.env.NEXT_PUBLIC_API_BASE) {
  console.warn("NEXT_PUBLIC_API_BASE is not set: the packaged app will call a relative /api/v1 with no host to serve it.");
}

const result = spawnSync("npx", ["next", "build"], {
  stdio: "inherit",
  shell: true,
  env: { ...process.env, DESKTOP_BUILD: "1" },
});

process.exit(result.status ?? 1);
