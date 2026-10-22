const { spawnSync } = require("node:child_process");
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

// Window title only — there's no per-tenant .icns yet, so the bundle's icon stays the platform default until that's added.
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

// A minimal .app bundle — required for codesign/notarization to apply at
// all (a bare Unix binary can't be notarized). See scripts/finalize-mac.cjs
// for the step that zips this up after signing.
function writeAppBundle(appDir, execName, slug) {
  const macOS = path.join(appDir, "Contents", "MacOS");
  fs.mkdirSync(macOS, { recursive: true });
  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleExecutable</key><string>${execName}</string>
  <key>CFBundleIdentifier</key><string>com.cloudhousefinance.desktop.${slug}</string>
  <key>CFBundleName</key><string>CloudHouse Finance</string>
  <key>CFBundleDisplayName</key><string>CloudHouse Finance</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>${version}</string>
  <key>CFBundleVersion</key><string>${version}</string>
  <key>NSHighResolutionCapable</key><true/>
  <key>LSMinimumSystemVersion</key><string>11.0</string>
</dict>
</plist>
`;
  fs.writeFileSync(path.join(appDir, "Contents", "Info.plist"), plist);
  return path.join(macOS, execName);
}

async function main() {
  run("node", [path.join(__dirname, "build-desktop.cjs")]);
  stageAssets();
  const branding = await applyTenantBranding();
  const slug = branding?.slug || "cloudhouse";

  const dist = path.join(root, "dist");
  fs.mkdirSync(dist, { recursive: true });
  const appName = `${slug}-finance-${version}-mac.app`;
  const appDir = path.join(dist, appName);
  fs.rmSync(appDir, { recursive: true, force: true });
  const execPath = writeAppBundle(appDir, `${slug}-finance`, slug);

  const ldflags = `-s -w -X main.version=${version} -X main.updateURL=${updateUrl(branding?.slug)} -X main.contentUpdateURL=${contentUrl()}`;
  run("go", ["build", "-tags", "desktop,production", "-ldflags", `"${ldflags}"`, "-o", `"${execPath}"`, "."], {
    cwd: path.join(root, "desktop"),
    env: { ...process.env, GOOS: "darwin", GOARCH: "amd64" },
  });
  fs.chmodSync(execPath, 0o755);

  console.log(`built ${appName} (unsigned — scripts/finalize-mac.cjs signs/notarizes/zips it)`);
}

main();
