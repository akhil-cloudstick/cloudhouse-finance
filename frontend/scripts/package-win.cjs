const { spawnSync } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { loadEnvConfig } = require("@next/env");
const {
  fetchTenantBranding,
  generateIconFromLogo,
  generateIconFromInitials,
  regenerateWindowsResource,
  writeWindowTitleOverride,
  updateUrl,
  contentUrl,
} = require("./tenant-icon.cjs");

const root = path.join(__dirname, "..");
const { version: pkgVersion } = require(path.join(root, "package.json"));
const version = process.env.RELEASE_VERSION || pkgVersion;

loadEnvConfig(root, false);

function run(cmd, args, opts = {}) {
  const result = spawnSync(cmd, args, { stdio: "inherit", cwd: root, shell: cmd === "node" ? false : true, ...opts });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

/* Full white-label for a desktop build: when DESKTOP_API_BASE (or, for an
 * older .env.local, NEXT_PUBLIC_API_BASE) names a tenant subdomain, pull
 * that tenant's own name and logo and bake them into the exe (icon + window
 * title) — same source of truth build-desktop.cjs resolves the actual API
 * base from, just read once more here at build time. A build with no tenant
 * URL (or an unreachable one) silently keeps the platform default exe,
 * exactly as before this existed. */
async function applyTenantBranding() {
  const apiBase = process.env.DESKTOP_API_BASE || process.env.NEXT_PUBLIC_API_BASE;
  if (!apiBase) {
    writeWindowTitleOverride(root, null);
    return null;
  }
  const branding = await fetchTenantBranding(apiBase);
  if (!branding) {
    console.warn(`Could not fetch tenant branding from ${apiBase} — building with the default CloudHouse icon/title.`);
    writeWindowTitleOverride(root, null);
    return null;
  }
  writeWindowTitleOverride(root, branding.name);
  try {
    if (branding.logoUrl) {
      await generateIconFromLogo(branding.logoUrl, root);
    } else {
      // No logo yet: an initials icon on the tenant's own colour, never a
      // stale previous tenant's icon or the platform's.
      await generateIconFromInitials(branding.name, branding.brandColor, root);
    }
    regenerateWindowsResource(root, run);
    console.log(`Applied "${branding.name}" branding (icon + title) for tenant "${branding.slug}".`);
  } catch (err) {
    console.warn(`Could not build a tenant icon (${err.message}) — the exe icon may be stale for this tenant.`);
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

async function main() {
  run("node", [path.join(__dirname, "build-desktop.cjs")]);
  stageAssets();
  const branding = await applyTenantBranding();

  const dist = path.join(root, "dist");
  fs.mkdirSync(dist, { recursive: true });
  // A tenant-specific filename, not just the icon, matters: Windows caches an
  // exe's icon by its file PATH, so a second tenant built to the exact same
  // filename can keep showing the previous tenant's icon in the taskbar/file
  // explorer until the cache is cleared — a distinct name per tenant avoids
  // relying on the user to do that.
  const file = branding ? `${branding.slug}-finance-${version}-win.exe` : `cloudhouse-finance-${version}-win.exe`;
  const target = path.join(dist, file);

  const ldflags = `-H windowsgui -s -w -X main.version=${version} -X main.updateURL=${updateUrl(branding?.slug)} -X main.contentUpdateURL=${contentUrl()}`;
  run("go", ["build", "-tags", "desktop,production", "-ldflags", `"${ldflags}"`, "-o", `"${target}"`, "."], {
    cwd: path.join(root, "desktop"),
    env: { ...process.env, GOOS: "windows", GOARCH: "amd64", CGO_ENABLED: "0" },
  });

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
