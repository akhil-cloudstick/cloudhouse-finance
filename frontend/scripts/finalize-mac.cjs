const { spawnSync } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const dist = path.join(root, "dist");

function run(cmd, args, opts = {}) {
  const result = spawnSync(cmd, args, { stdio: "inherit", cwd: dist, ...opts });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

// Zips whatever .app package-mac.cjs built (signed/notarized by now, if the
// Mac secrets were set — see .github/workflows/release.yml's mac job) and
// writes the manifest, exactly like the other package-*.cjs scripts do.
function main() {
  const appName = fs.readdirSync(dist).find((f) => f.endsWith(".app"));
  if (!appName) {
    console.error("no .app bundle found in dist/ — run npm run dist:mac first.");
    process.exit(1);
  }
  const file = appName.replace(/\.app$/, ".zip");
  run("zip", ["-r", "-X", "-y", file, appName]);

  const bytes = fs.readFileSync(path.join(dist, file));
  const version = require(path.join(root, "package.json")).version;
  const manifest = {
    version: process.env.RELEASE_VERSION || version,
    file,
    sha512: crypto.createHash("sha512").update(bytes).digest("hex"),
    size: bytes.length,
  };
  fs.writeFileSync(path.join(dist, "latest.json"), JSON.stringify(manifest, null, 2));

  console.log(`finalized ${file}`);
}

main();
