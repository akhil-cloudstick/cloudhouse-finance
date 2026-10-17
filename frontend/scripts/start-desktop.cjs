const { spawn, spawnSync } = require("node:child_process");
const http = require("node:http");
const path = require("node:path");
const { loadEnvConfig } = require("@next/env");
const {
  fetchTenantBranding,
  generateIconFromLogo,
  generateIconFromInitials,
  regenerateWindowsResource,
  writeWindowTitleOverride,
} = require("./tenant-icon.cjs");

const root = path.join(__dirname, "..");
loadEnvConfig(root, true);

const port = 3001;
const devURL = `http://localhost:${port}`;
const backend = (process.env.BACKEND_ORIGIN || "http://localhost:8080").replace(/\/+$/, "");
const apiBase = process.env.NEXT_PUBLIC_API_BASE || `${backend}/api/v1`;

function isUp() {
  return new Promise((resolve) => {
    const req = http.get(devURL, (res) => {
      res.resume();
      resolve(true);
    });
    req.on("error", () => resolve(false));
    req.setTimeout(2000, () => {
      req.destroy();
      resolve(false);
    });
  });
}

function stop(child) {
  if (child && child.pid) spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
}

function run(cmd, args, opts = {}) {
  const result = spawnSync(cmd, args, { stdio: "inherit", cwd: root, shell: true, ...opts });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

async function main() {
  // `go run` links the same .syso resource file as a real build, so the
  // taskbar icon during `npm run start` reflects whatever tenant's icon was
  // last generated — regenerated here too, not just on `npm run dist`, so it
  // never shows a stale tenant's icon while you're testing a different one.
  const branding = await fetchTenantBranding(apiBase);
  writeWindowTitleOverride(root, branding ? branding.name : null);
  if (branding) {
    try {
      if (branding.logoUrl) {
        await generateIconFromLogo(branding.logoUrl, root);
      } else {
        // No logo yet: an initials icon, never a stale previous tenant's.
        await generateIconFromInitials(branding.name, branding.brandColor, root);
      }
      regenerateWindowsResource(root, run);
    } catch (err) {
      console.warn(`Could not build a tenant icon (${err.message}) — the taskbar icon may be stale for this tenant.`);
    }
  }

  // Its own dev server and distDir, so it never fights `npm run dev` for the lock on .next.
  const env = { ...process.env, DESKTOP_BUILD: "1", NEXT_PUBLIC_API_BASE: apiBase };

  let next = null;
  if (!(await isUp())) {
    next = spawn("npx", ["next", "dev", "-p", String(port)], { cwd: root, stdio: "inherit", shell: true, env });
    while (!(await isUp())) await new Promise((r) => setTimeout(r, 1000));
  }

  const shell = spawn("go", ["run", "-tags", "desktop,dev", "."], {
    cwd: path.join(root, "desktop"),
    stdio: "inherit",
    shell: true,
    env: { ...env, DESKTOP_DEV_URL: devURL },
  });

  shell.on("exit", (code) => {
    stop(next);
    process.exit(code ?? 0);
  });
  process.on("SIGINT", () => {
    stop(shell);
    stop(next);
    process.exit(0);
  });
}

main();
