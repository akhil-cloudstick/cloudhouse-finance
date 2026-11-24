const path = require("node:path");
const fs = require("node:fs");

function bucketBase() {
  const { S3_ENDPOINT, S3_BUCKET, S3_FOLDER } = process.env;
  if (!S3_ENDPOINT || !S3_BUCKET) return "";
  return [S3_ENDPOINT.replace(/\/+$/, ""), S3_BUCKET, (S3_FOLDER || "").replace(/^\/+|\/+$/g, "")]
    .filter(Boolean)
    .join("/");
}

// This tenant's own subfolder in B2, so its update check never sees another tenant's version.
function updateUrl(tenantSlug) {
  const base = bucketBase();
  if (!base) return "";
  return `${base}/${process.env.RELEASE_TENANT || tenantSlug || "common"}`;
}

// The shared "common" folder every tenant's app also checks, for a content-only release.
function contentUrl() {
  const base = bucketBase();
  return base ? `${base}/common` : "";
}

// Tenant subdomain from NEXT_PUBLIC_API_BASE's host; falls back to "default"
// (e.g. localhost) so local testing still refreshes the icon.
function slugFromApiBase(apiBase) {
  // DESKTOP_TENANT names the business directly (its code, e.g. "default"), for when the API address does not carry it:
  // a localhost or shared address would otherwise give "default", and an address with another subdomain that business.
  const forced = (process.env.DESKTOP_TENANT || "").trim().toLowerCase();
  if (forced) return forced;
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
    const base = apiBase.replace(/\/+$/, "");
    // The host-resolved lookup is what the sign-in page uses (the subdomain is matched to the business); the by-code
    // one only matches when the subdomain equals the business code. An unknown code answers with the platform default
    // (no logo), which is why the exe got the plain "C" icon, so ask by host first and take the first answer with a logo.
    let data = null;
    const byCode = `${base}/public/branding/${encodeURIComponent(slug)}`;
    // a business named explicitly is looked up by its code only: the host-resolved answer is for whatever the address maps to
    const urls = (process.env.DESKTOP_TENANT || "").trim() ? [byCode] : [`${base}/public/branding`, byCode];
    for (const url of urls) {
      const res = await fetch(url);
      if (!res.ok) continue;
      const body = await res.json();
      const found = body && body.data;
      if (!found) continue;
      data = data && !found.logo_url ? data : found;
      if (found.logo_url) break;
    }
    if (!data) return null;
    const origin = new URL(apiBase).origin;
    const logoUrl = data.logo_url ? new URL(data.logo_url, origin).toString() : "";
    if (!logoUrl) console.warn(`Branding for "${slug}" has no logo (logo_url empty) — the exe gets an initials icon. Upload a logo for this business, or check that "${slug}" is its code/subdomain.`);
    const name = data.name || data.legal_name || data.short_name || slug;
    const brandColor = /^#[0-9a-f]{6}$/i.test(data.brand_color || "") ? data.brand_color : "#6054bf";
    return { slug, name, logoUrl, brandColor };
  } catch {
    return null;
  }
}

// Logo trimmed of its empty margins and centred full-size on a transparent square.
async function generateIconFromLogo(logoUrl, root) {
  const res = await fetch(logoUrl);
  if (!res.ok) throw new Error(`logo fetch failed: ${res.status}`);
  await generateIconFromBuffer(Buffer.from(await res.arrayBuffer()), root);
}

// The default logo (public/cloudhouse-icon.png), for a business that has no logo of its own.
async function generateDefaultIcon(root) {
  await generateIconFromBuffer(fs.readFileSync(path.join(root, "public", "cloudhouse-icon.png")), root);
}

async function generateIconFromBuffer(logoBuffer, root) {
  const sharp = require("sharp");

  const trimmed = await sharp(logoBuffer).ensureAlpha().trim().png().toBuffer();
  const meta = await sharp(trimmed).metadata();
  const size = Math.max(meta.width, meta.height);
  const square = await sharp(trimmed)
    .resize({ width: size, height: size, fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
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
function regenerateWindowsResource(root, run, name) {
  const dir = path.join(root, "desktop", "winres");
  let input = "winres.json";
  let generated = null;
  // The business's own name goes into the exe's properties (Task Manager, the file's Details tab, the manifest), not only the title.
  if (name) {
    const base = JSON.parse(fs.readFileSync(path.join(dir, "winres.json"), "utf8"));
    base.RT_MANIFEST["#1"]["0409"].description = name;
    base.RT_VERSION = {
      "#1": {
        "0000": {
          fixed: { file_version: "0.1.0.0", product_version: "0.1.0.0" },
          info: { "0409": { CompanyName: name, FileDescription: name, ProductName: name, InternalName: name, LegalCopyright: name } },
        },
      },
    };
    generated = "winres.tenant.json";
    fs.writeFileSync(path.join(dir, generated), JSON.stringify(base, null, 2));
    input = generated;
  }
  try {
    run("go", ["run", "github.com/tc-hib/go-winres@latest", "make", "--in", input, "--out", "../rsrc", "--arch", "amd64"], { cwd: dir });
  } finally {
    if (generated) fs.rmSync(path.join(dir, generated), { force: true });
  }
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
  generateDefaultIcon,
  generateIconFromInitials,
  regenerateWindowsResource,
  writeWindowTitleOverride,
  updateUrl,
  contentUrl,
};
