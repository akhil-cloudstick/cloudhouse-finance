const { spawnSync } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { loadEnvConfig } = require("@next/env");

const root = path.join(__dirname, "..");
const { version } = require(path.join(root, "package.json"));

loadEnvConfig(root, false);

function run(cmd, args, opts = {}) {
  const result = spawnSync(cmd, args, { stdio: "inherit", cwd: root, shell: cmd === "node" ? false : true, ...opts });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function updateUrl() {
  const { S3_ENDPOINT, S3_BUCKET, S3_FOLDER } = process.env;
  if (!S3_ENDPOINT || !S3_BUCKET) return "";
  return [S3_ENDPOINT.replace(/\/+$/, ""), S3_BUCKET, (S3_FOLDER || "").replace(/^\/+|\/+$/g, "")]
    .filter(Boolean)
    .join("/");
}

function stageAssets() {
  const assets = path.join(root, "desktop", "assets");
  for (const entry of fs.readdirSync(assets)) {
    if (entry !== ".gitkeep") fs.rmSync(path.join(assets, entry), { recursive: true, force: true });
  }
  fs.cpSync(path.join(root, "dist-desktop"), assets, { recursive: true });
}

run("node", [path.join(__dirname, "build-desktop.cjs")]);
stageAssets();

const dist = path.join(root, "dist");
fs.mkdirSync(dist, { recursive: true });
const file = `cloudhouse-finance-${version}-win.exe`;
const target = path.join(dist, file);

const ldflags = `-H windowsgui -s -w -X main.version=${version} -X main.updateURL=${updateUrl()}`;
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
