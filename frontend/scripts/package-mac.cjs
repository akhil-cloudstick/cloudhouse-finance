const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { loadReleaseEnv } = require("./release-env.cjs");
const {
  fetchTenantBranding,
  generateIconFromLogo,
  generateDefaultIcon,
  writeWindowTitleOverride,
  updateUrl,
  contentUrl,
} = require("./tenant-icon.cjs");

const root = path.join(__dirname, "..");
const { version: pkgVersion } = require(path.join(root, "package.json"));
const version = process.env.RELEASE_VERSION || pkgVersion;

loadReleaseEnv(root);

function run(cmd, args, opts = {}) {
  const result = spawnSync(cmd, args, { stdio: "inherit", cwd: root, shell: cmd === "node" ? false : true, ...opts });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

// Window title plus the Dock/Finder icon (build/mac/icon.icns), both from the tenant's own branding.
async function applyTenantBranding() {
  const apiBase = process.env.DESKTOP_API_BASE || process.env.NEXT_PUBLIC_API_BASE;
  const branding = apiBase ? await fetchTenantBranding(apiBase) : null;
  writeWindowTitleOverride(root, branding ? branding.name : null);
  try {
    if (branding?.logoUrl) await generateIconFromLogo(branding.logoUrl, root);
    else await generateDefaultIcon(root);
  } catch (err) {
    console.warn(`Could not build the Mac icon (${err.message}) — trying the default logo.`);
    await generateDefaultIcon(root).catch(() => {});
  }
  return branding;
}

function stageAssets() {
  const assets = path.join(root, "desktop", "assets");
  for (const entry of fs.readdirSync(assets)) {
    if (entry !== ".gitkeep") fs.rmSync(path.join(assets, entry), { recursive: true, force: true });
  }
  fs.cpSync(path.join(root, "dist-desktop"), assets, { recursive: true });
}

function xmlEscape(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// A minimal .app bundle — required for codesign/notarization to apply at
// all (a bare Unix binary can't be notarized). See scripts/finalize-mac.cjs
// for the step that zips this up after signing.
function writeAppBundle(appDir, execName, slug, displayName) {
  const macOS = path.join(appDir, "Contents", "MacOS");
  const resources = path.join(appDir, "Contents", "Resources");
  fs.mkdirSync(macOS, { recursive: true });
  fs.mkdirSync(resources, { recursive: true });
  const icon = path.join(root, "build", "mac", "icon.icns");
  const hasIcon = fs.existsSync(icon);
  if (hasIcon) fs.copyFileSync(icon, path.join(resources, "icon.icns"));
  const name = xmlEscape(displayName);
  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleExecutable</key><string>${execName}</string>
  <key>CFBundleIdentifier</key><string>com.cloudhousefinance.desktop.${slug}</string>
  <key>CFBundleName</key><string>${name}</string>
  <key>CFBundleDisplayName</key><string>${name}</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>${version}</string>
  <key>CFBundleVersion</key><string>${version}</string>${hasIcon ? "\n  <key>CFBundleIconFile</key><string>icon</string>" : ""}
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
  const execPath = writeAppBundle(appDir, `${slug}-finance`, slug, branding?.name || "CloudHouse Finance");

  const ldflags = `-s -w -X main.version=${version} -X main.updateURL=${updateUrl(branding?.slug)} -X main.contentUpdateURL=${contentUrl()} -X main.buildTime=${Math.floor(Date.now() / 1000)}`;
  // One binary for both Intel and Apple-silicon Macs, so M-series Macs never ask to install Rosetta.
  const parts = ["amd64", "arm64"].map((arch) => {
    const out = path.join(dist, `${slug}-finance-${arch}`);
    run("go", ["build", "-tags", "desktop,production", "-ldflags", `"${ldflags}"`, "-o", `"${out}"`, "."], {
      cwd: path.join(root, "desktop"),
      // Wails' macOS webview binds WebKit via cgo — CGO_ENABLED=0 (fine for Windows) silently drops every cgo file.
      env: { ...process.env, GOOS: "darwin", GOARCH: arch, CGO_ENABLED: "1" },
    });
    return out;
  });
  run("lipo", ["-create", "-output", `"${execPath}"`, ...parts.map((p) => `"${p}"`)]);
  parts.forEach((p) => fs.rmSync(p, { force: true }));
  fs.chmodSync(execPath, 0o755);

  console.log(`built ${appName} (universal; release.yml signs it, then scripts/finalize-mac.cjs zips it)`);
}

main();
