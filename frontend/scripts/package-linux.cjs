const { spawnSync } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { loadEnvConfig } = require("@next/env");
const { fetchTenantBranding, writeWindowTitleOverride, updateUrl, contentUrl } = require("./tenant-icon.cjs");

const root = path.join(__dirname, "..");
const { version: pkgVersion } = require(path.join(root, "package.json"));
const version = process.env.RELEASE_VERSION || pkgVersion;

loadEnvConfig(root, false);

function run(cmd, args, opts = {}) {
  const result = spawnSync(cmd, args, { stdio: "inherit", cwd: root, shell: cmd === "node" ? false : true, ...opts });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

// Window title only — no desktop-file/icon step here yet, so this build has
// no custom per-tenant icon until that's added.
async function applyTenantBranding() {
  const apiBase = process.env.DESKTOP_API_BASE || process.env.NEXT_PUBLIC_API_BASE;
  if (!apiBase) {
    writeWindowTitleOverride(root, null);
    return null;
  }
  const branding = await fetchTenantBranding(apiBase);
  if (!branding) {
    writeWindowTitleOverride(root, null);
    return null;
  }
  writeWindowTitleOverride(root, branding.name);
  return branding;
}

function stageAssets() {
  const assets = path.join(root, "desktop", "assets");
  for (const entry of fs.readdirSync(assets)) {
    if (entry !== ".gitkeep") fs.rmSync(path.join(assets, entry), { recursive: true, force: true });
  }
  fs.cpSync(path.join(root, "dist-desktop"), assets, { recursive: true });
}

async function main() {
  run("node", [path.join(__dirname, "build-desktop.cjs")]);
  stageAssets();
  const branding = await applyTenantBranding();

  const dist = path.join(root, "dist");
  fs.mkdirSync(dist, { recursive: true });
  const file = branding ? `${branding.slug}-finance-${version}-linux` : `cloudhouse-finance-${version}-linux`;
  const target = path.join(dist, file);

  const ldflags = `-s -w -X main.version=${version} -X main.updateURL=${updateUrl(branding?.slug)} -X main.contentUpdateURL=${contentUrl()}`;
  // webkit2_41: Wails' own build tag for Ubuntu 24.04+, which only ships webkit2gtk-4.1 (not 4.0).
  run("go", ["build", "-tags", "desktop,production,webkit2_41", "-ldflags", `"${ldflags}"`, "-o", `"${target}"`, "."], {
    cwd: path.join(root, "desktop"),
    env: { ...process.env, GOOS: "linux", GOARCH: "amd64" },
  });
  fs.chmodSync(target, 0o755);

  const bytes = fs.readFileSync(target);
  const manifest = {
    version,
    file,
    sha512: crypto.createHash("sha512").update(bytes).digest("hex"),
    size: bytes.length,
  };
  fs.writeFileSync(path.join(dist, "latest.json"), JSON.stringify(manifest, null, 2));

  console.log(`built ${file}`);
}

main();
