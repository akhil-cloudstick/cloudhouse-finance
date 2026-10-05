const fs = require("node:fs");
const path = require("node:path");
const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");
const { loadEnvConfig } = require("@next/env");

const root = path.join(__dirname, "..");
loadEnvConfig(root, false);

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

const folder = (S3_FOLDER || "").replace(/^\/+|\/+$/g, "");
const dist = path.join(root, "dist");

const contentTypes = { ".json": "application/json", ".exe": "application/octet-stream" };

async function main() {
  const files = fs.readdirSync(dist).filter((f) => fs.statSync(path.join(dist, f)).isFile());
  if (!files.includes("latest.json")) {
    console.error("dist/latest.json is missing; run a dist script first.");
    process.exit(1);
  }

  // The feed goes last so no client reads it before the file it names exists.
  const ordered = [...files.filter((f) => f !== "latest.json"), "latest.json"];
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
