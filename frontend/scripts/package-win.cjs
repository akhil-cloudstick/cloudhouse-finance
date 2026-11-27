const { spawnSync } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { loadReleaseEnv } = require("./release-env.cjs");
const {
  fetchTenantBranding,
  generateIconFromLogo,
  generateDefaultIcon,
  regenerateWindowsResource,
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
    // A business was named explicitly, so a default-branded exe would be the wrong product: stop instead of shipping it.
    if ((process.env.DESKTOP_TENANT || "").trim()) {
      console.error(`DESKTOP_TENANT="${process.env.DESKTOP_TENANT}" is set but its branding could not be fetched from ${apiBase}. Start the backend (or point DESKTOP_API_BASE at a reachable one) and build again.`);
      process.exit(1);
    }
    console.warn(`Could not fetch tenant branding from ${apiBase} — building with the default CloudHouse icon/title.`);
    writeWindowTitleOverride(root, null);
    return null;
  }
  writeWindowTitleOverride(root, branding.name);
  try {
    if (branding.logoUrl) {
      await generateIconFromLogo(branding.logoUrl, root);
    } else {
      // No logo yet: the default logo, never a stale previous tenant's icon.
      await generateDefaultIcon(root);
    }
    regenerateWindowsResource(root, run, branding.name);
    console.log(`Applied "${branding.name}" branding (icon + title) for tenant "${branding.slug}".`);
  } catch (err) {
    console.warn(`Could not build a tenant icon (${err.message}) — the exe icon may be stale for this tenant.`);
  }
  return branding;
}

function findIscc() {
  const candidates = [
    process.env.ISCC_PATH,
    ...["7", "6"].flatMap((v) => [
      process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, "Programs", `Inno Setup ${v}`, "ISCC.exe"),
      `C:\\Program Files (x86)\\Inno Setup ${v}\\ISCC.exe`,
      `C:\\Program Files\\Inno Setup ${v}\\ISCC.exe`,
    ]),
  ];
  return candidates.find((p) => p && fs.existsSync(p)) || null;
}

// PNG-embedded ICO (Vista+), so the installer icon needs no extra dependency.
function writeIco(pngPaths, icoPath) {
  const images = pngPaths.map((p) => fs.readFileSync(p));
  const header = Buffer.alloc(6 + 16 * images.length);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  let offset = header.length;
  images.forEach((img, i) => {
    const w = img.readUInt32BE(16);
    const h = img.readUInt32BE(20);
    const e = 6 + 16 * i;
    header.writeUInt8(w >= 256 ? 0 : w, e);
    header.writeUInt8(h >= 256 ? 0 : h, e + 1);
    header.writeUInt16LE(1, e + 4);
    header.writeUInt16LE(32, e + 6);
    header.writeUInt32LE(img.length, e + 8);
    header.writeUInt32LE(offset, e + 12);
    offset += img.length;
  });
  fs.writeFileSync(icoPath, Buffer.concat([header, ...images]));
}

// Stable per tenant, so a newer setup upgrades the existing install instead of adding a second one.
function appIdFor(slug) {
  const h = crypto.createHash("sha1").update(`cloudhouse-finance:${slug}`).digest("hex");
  return `{{${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}}`.toUpperCase();
}

function buildInstaller(exePath, dist, branding) {
  const iscc = findIscc();
  if (!iscc) {
    console.warn("Inno Setup 6/7 not found (set ISCC_PATH or install it) — built the portable exe only, no setup file.");
    return null;
  }
  const slug = branding ? branding.slug : "cloudhouse";
  const winDir = path.join(root, "build", "windows");
  const icon = path.join(require("node:os").tmpdir(), `${slug}-installer.ico`);
  writeIco([256, 48, 32, 16].map((px) => path.join(winDir, `icon-${px}.png`)), icon);

  const outputBase = `${slug}-finance-${version}-setup`;
  run(iscc, [
    "/Q",
    `/DAppId=${appIdFor(slug)}`,
    `/DAppName=${branding ? branding.name : "CloudHouse Finance"}`,
    `/DAppVersion=${version}`,
    `/DExeName=${slug}-finance.exe`,
    `/DSourceExe=${exePath}`,
    `/DOutputDir=${dist}`,
    `/DOutputBase=${outputBase}`,
    `/DIconFile=${icon}`,
    path.join(winDir, "installer.iss"),
  ], { shell: false });
  fs.rmSync(icon, { force: true });
  return `${outputBase}.exe`;
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
  const setup = buildInstaller(target, dist, branding);
  if (setup) console.log(`built ${setup}`);
}

main();
