const path = require("node:path");
const fs = require("node:fs");

// Tenant subdomain from NEXT_PUBLIC_API_BASE's host; falls back to "default"
// (e.g. localhost) so local testing still refreshes the icon.
function slugFromApiBase(apiBase) {
  try {
    const host = new URL(apiBase).hostname.toLowerCase();
    const labels = host.split(".");
    return labels.length >= 3 ? labels[0] : "default";
  } catch {
    return null;
  }
}

/* Fetches the tenant's public name + logo straight from the backend, the
 * same unauthenticated endpoint the sign-in page itself calls. Never throws:
 * a build with no NEXT_PUBLIC_API_BASE, or a backend that's unreachable at
 * build time, should still produce the default-branded exe rather than fail. */
async function fetchTenantBranding(apiBase) {
  const slug = slugFromApiBase(apiBase);
  if (!slug) return null;
  try {
    const res = await fetch(`${apiBase.replace(/\/+$/, "")}/public/branding/${encodeURIComponent(slug)}`);
    if (!res.ok) return null;
    const body = await res.json();
    const data = body && body.data;
    if (!data) return null;
    const origin = new URL(apiBase).origin;
    const logoUrl = data.logo_url ? new URL(data.logo_url, origin).toString() : "";
    const name = data.name || data.legal_name || data.short_name || slug;
    const brandColor = /^#[0-9a-f]{6}$/i.test(data.brand_color || "") ? data.brand_color : "#6054bf";
    return { slug, name, logoUrl, brandColor };
  } catch {
    return null;
  }
}

/* Builds the 4 Windows icon sizes from a tenant's logo (often a wide
 * wordmark, not pre-squared) by padding it onto a square black canvas,
 * matching the dark-pad style already used for this logo elsewhere in the
 * app (see common/components/BrandLogo.tsx's "dark-pad" display option). */
async function generateIconFromLogo(logoUrl, root) {
  const sharp = require("sharp");
  const res = await fetch(logoUrl);
  if (!res.ok) throw new Error(`logo fetch failed: ${res.status}`);
  const logoBuffer = Buffer.from(await res.arrayBuffer());

  const meta = await sharp(logoBuffer).metadata();
  const size = Math.max(meta.width, meta.height);
  const shrunk = await sharp(logoBuffer)
    .resize({ width: Math.round(meta.width * 0.8), height: Math.round(meta.height * 0.8), fit: "inside" })
    .toBuffer();
  const shrunkMeta = await sharp(shrunk).metadata();
  const left = Math.round((size - shrunkMeta.width) / 2);
  const top = Math.round((size - shrunkMeta.height) / 2);
  const square = await sharp({ create: { width: size, height: size, channels: 4, background: "#000000" } })
    .composite([{ input: shrunk, left, top }])
    .png()
    .toBuffer();

  const winDir = path.join(root, "build", "windows");
  for (const px of [256, 48, 32, 16]) {
    await sharp(square).resize(px, px).toFile(path.join(winDir, `icon-${px}.png`));
  }
  await sharp(square).resize(256, 256).toFile(path.join(winDir, "icon.png"));
}

/* Builds the 4 Windows icon sizes from the tenant's NAME when they have no
 * logo uploaded yet — the tenant's initial on their own brand colour, the
 * same placeholder common/components/BrandLogo.tsx draws in the app itself
 * for the exact same case. Without this, a logo-less tenant's build would
 * either keep a stale previous tenant's icon on disk or fall back to
 * CloudHouse's, both wrong: the icon must always match the CURRENT build. */
async function generateIconFromInitials(name, brandColor, root) {
  const sharp = require("sharp");
  const initial = (name.trim().charAt(0) || "?").toUpperCase();
  const size = 256;
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">
      <rect width="${size}" height="${size}" rx="${Math.round(size * 0.2)}" fill="${brandColor}" />
      <text x="50%" y="50%" text-anchor="middle" dominant-baseline="central"
        font-family="Arial, sans-serif" font-weight="700" font-size="${Math.round(size * 0.5)}" fill="#ffffff">${initial}</text>
    </svg>`;
  const square = await sharp(Buffer.from(svg)).png().toBuffer();

  const winDir = path.join(root, "build", "windows");
  for (const px of [256, 48, 32, 16]) {
    await sharp(square).resize(px, px).toFile(path.join(winDir, `icon-${px}.png`));
  }
  await sharp(square).resize(256, 256).toFile(path.join(winDir, "icon.png"));
}

/* Regenerates desktop/rsrc_windows_amd64.syso from the (now tenant-branded)
 * PNGs in build/windows/ — Go's build tool links whatever .syso sits next to
 * main.go automatically, no further wiring needed. */
function regenerateWindowsResource(root, run) {
  run("go", ["run", "github.com/tc-hib/go-winres@latest", "make", "--in", "winres.json", "--out", "../rsrc", "--arch", "amd64"], {
    cwd: path.join(root, "desktop", "winres"),
  });
}

/* Writes (or removes) the generated file that overrides main.go's default
 * windowTitle. A separate generated file rather than an ldflags -X value:
 * ldflags -X needs the value to survive raw shell word-splitting, which a
 * tenant name with a space in it ("AJ Finance") does not. */
function writeWindowTitleOverride(root, name) {
  const genPath = path.join(root, "desktop", "tenant_title_generated.go");
  if (!name) {
    fs.rmSync(genPath, { force: true });
    return;
  }
  const escaped = name.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  fs.writeFileSync(
    genPath,
    `package main\n\n// Generated by scripts/tenant-icon.cjs for this tenant build. Do not edit by hand.\nfunc init() { windowTitle = "${escaped}" }\n`
  );
}

module.exports = {
  fetchTenantBranding,
  generateIconFromLogo,
  generateIconFromInitials,
  regenerateWindowsResource,
  writeWindowTitleOverride,
};
