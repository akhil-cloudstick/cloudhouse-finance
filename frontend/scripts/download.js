const path = require("node:path");
const { fetchTenantBranding } = require("./tenant-icon.cjs");
const { loadReleaseEnv } = require("./release-env.cjs");

loadReleaseEnv(path.join(__dirname, ".."));

const { S3_ENDPOINT, S3_BUCKET, S3_FOLDER } = process.env;
if (!S3_ENDPOINT || !S3_BUCKET) {
  console.error("S3_ENDPOINT and S3_BUCKET must be set to verify a release.");
  process.exit(1);
}

const baseFolder = (S3_FOLDER || "").replace(/^\/+|\/+$/g, "");
const buildType = process.env.RELEASE_BUILD_TYPE === "content" ? "content" : "full";

async function resolveTenantFolder() {
  if (buildType === "content") return "common";
  if (process.env.RELEASE_TENANT) return process.env.RELEASE_TENANT;
  const apiBase = process.env.DESKTOP_API_BASE || process.env.NEXT_PUBLIC_API_BASE;
  if (apiBase) {
    const branding = await fetchTenantBranding(apiBase).catch(() => null);
    if (branding?.slug) return branding.slug;
  }
  return "common";
}

async function main() {
  const tenantFolder = await resolveTenantFolder();
  const folder = [S3_ENDPOINT.replace(/\/+$/, ""), S3_BUCKET, baseFolder, tenantFolder].filter(Boolean).join("/");
  const feedName = buildType === "content" ? "latest-content.json" : "latest.json";

  const feed = await fetch(`${folder}/${feedName}`);
  if (!feed.ok) throw new Error(`feed returned ${feed.status}`);
  const manifest = await feed.json();

  const head = await fetch(`${folder}/${manifest.file}`, { method: "HEAD" });
  if (!head.ok) throw new Error(`feed names ${manifest.file} but it returned ${head.status}`);

  const size = Number(head.headers.get("content-length"));
  if (manifest.size && size !== manifest.size) {
    throw new Error(`${manifest.file} is ${size} bytes in the bucket, the feed says ${manifest.size}`);
  }
  console.log(`verified ${manifest.version} in ${tenantFolder}/: ${manifest.file} (${size} bytes)`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
