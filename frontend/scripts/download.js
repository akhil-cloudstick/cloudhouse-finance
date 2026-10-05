const path = require("node:path");
const { loadEnvConfig } = require("@next/env");

loadEnvConfig(path.join(__dirname, ".."), false);

const { S3_ENDPOINT, S3_BUCKET, S3_FOLDER } = process.env;
if (!S3_ENDPOINT || !S3_BUCKET) {
  console.error("S3_ENDPOINT and S3_BUCKET must be set to verify a release.");
  process.exit(1);
}

const base = [S3_ENDPOINT.replace(/\/+$/, ""), S3_BUCKET, (S3_FOLDER || "").replace(/^\/+|\/+$/g, "")]
  .filter(Boolean)
  .join("/");

async function main() {
  const feed = await fetch(`${base}/latest.json`);
  if (!feed.ok) throw new Error(`feed returned ${feed.status}`);
  const manifest = await feed.json();

  const head = await fetch(`${base}/${manifest.file}`, { method: "HEAD" });
  if (!head.ok) throw new Error(`feed names ${manifest.file} but it returned ${head.status}`);

  const size = Number(head.headers.get("content-length"));
  if (manifest.size && size !== manifest.size) {
    throw new Error(`${manifest.file} is ${size} bytes in the bucket, the feed says ${manifest.size}`);
  }
  console.log(`verified ${manifest.version}: ${manifest.file} (${size} bytes)`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
