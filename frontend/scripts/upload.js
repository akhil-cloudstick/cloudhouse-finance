const fs = require("node:fs");
const path = require("node:path");
const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");
const { fetchTenantBranding } = require("./tenant-icon.cjs");
const { loadReleaseEnv } = require("./release-env.cjs");

const root = path.join(__dirname, "..");
loadReleaseEnv(root);

const { S3_ENDPOINT, S3_REGION, S3_BUCKET, S3_FOLDER, S3_ACCESS_KEY, S3_SECRET_KEY } = process.env;
for (const [key, value] of Object.entries({ S3_ENDPOINT, S3_REGION, S3_BUCKET, S3_ACCESS_KEY, S3_SECRET_KEY })) {
  if (!value) {
    console.error(`${key} is not set; fill the S3_* keys in .env first.`);
    process.exit(1);
  }
}

const client = new S3Client({
  endpoint: S3_ENDPOINT,
  region: S3_REGION,
  forcePathStyle: true,
  credentials: { accessKeyId: S3_ACCESS_KEY, secretAccessKey: S3_SECRET_KEY },
});

const baseFolder = (S3_FOLDER || "").replace(/^\/+|\/+$/g, "");
const contentTypes = { ".json": "application/json", ".exe": "application/octet-stream", ".zip": "application/zip" };

// "content" publishes once into the shared "common" folder; "full" (default) goes into the tenant's own folder.
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
  const dist = path.join(root, buildType === "content" ? "dist-content" : "dist");
  const feedName = buildType === "content" ? "latest-content.json" : "latest.json";

  const files = fs.readdirSync(dist).filter((f) => fs.statSync(path.join(dist, f)).isFile());
  if (!files.includes(feedName)) {
    console.error(`${dist}/${feedName} is missing; run the matching dist script first.`);
    process.exit(1);
  }

  const tenantFolder = await resolveTenantFolder();
  const folder = [baseFolder, tenantFolder].filter(Boolean).join("/");

  // The feed goes last so no client reads it before the file it names exists.
  const ordered = [...files.filter((f) => f !== feedName), feedName];
  for (const name of ordered) {
    const key = folder ? `${folder}/${name}` : name;
    await client.send(
      new PutObjectCommand({
        Bucket: S3_BUCKET,
        Key: key,
        Body: fs.readFileSync(path.join(dist, name)),
        ACL: "public-read",
        ContentType: contentTypes[path.extname(name)] || "application/octet-stream",
      }),
    );
    console.log(`uploaded ${key}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
