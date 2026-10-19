const { S3Client, ListObjectsV2Command, DeleteObjectCommand } = require("@aws-sdk/client-s3");
const path = require("node:path");
const { fetchTenantBranding } = require("./tenant-icon.cjs");
const { loadReleaseEnv } = require("./release-env.cjs");

const root = path.join(__dirname, "..");
loadReleaseEnv(root);

const { S3_ENDPOINT, S3_REGION, S3_BUCKET, S3_FOLDER, S3_ACCESS_KEY, S3_SECRET_KEY } = process.env;

// Keeps at most this many installers per tenant per OS in B2 (FCFO); never touches latest.json or the shared "common" package.
const KEEP = 5;

const client = new S3Client({
  endpoint: S3_ENDPOINT,
  region: S3_REGION,
  forcePathStyle: true,
  credentials: { accessKeyId: S3_ACCESS_KEY, secretAccessKey: S3_SECRET_KEY },
});

const baseFolder = (S3_FOLDER || "").replace(/^\/+|\/+$/g, "");

function semverParts(v) {
  const core = v.replace(/^v/i, "").split(".").map((n) => parseInt(n, 10) || 0);
  while (core.length < 3) core.push(0);
  return core;
}

function semverCompare(a, b) {
  const pa = semverParts(a);
  const pb = semverParts(b);
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] - pb[i];
  }
  return 0;
}

async function resolveTenantFolder() {
  if (process.env.RELEASE_TENANT) return process.env.RELEASE_TENANT;
  const apiBase = process.env.DESKTOP_API_BASE || process.env.NEXT_PUBLIC_API_BASE;
  if (apiBase) {
    const branding = await fetchTenantBranding(apiBase).catch(() => null);
    if (branding?.slug) return branding.slug;
  }
  return null;
}

async function main() {
  if (process.env.RELEASE_BUILD_TYPE === "content") {
    console.log("content releases are shared, not per-tenant — nothing to prune.");
    return;
  }
  const tenant = await resolveTenantFolder();
  if (!tenant || tenant === "common") {
    console.log("no tenant resolved — skipping prune.");
    return;
  }
  const prefix = [baseFolder, tenant].filter(Boolean).join("/") + "/";

  const listed = await client.send(new ListObjectsV2Command({ Bucket: S3_BUCKET, Prefix: prefix }));
  const files = (listed.Contents || []).map((o) => o.Key).filter((k) => k && !k.endsWith("latest.json"));

  // Groups by OS (e.g. "...-1.4.0-win.exe" -> "win") so each OS's limit is independent.
  const byOs = new Map();
  const pattern = /-(\d+\.\d+\.\d+(?:-[\w.]+)?)-(\w+)\.\w+$/;
  for (const key of files) {
    const m = pattern.exec(key);
    if (!m) continue;
    const [, version, os] = m;
    const list = byOs.get(os) || [];
    list.push({ key, version });
    byOs.set(os, list);
  }

  for (const [os, list] of byOs) {
    list.sort((a, b) => semverCompare(a.version, b.version));
    const toDelete = list.slice(0, Math.max(0, list.length - KEEP));
    for (const { key } of toDelete) {
      await client.send(new DeleteObjectCommand({ Bucket: S3_BUCKET, Key: key }));
      console.log(`pruned ${key} (${os}, keeping newest ${KEEP})`);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
