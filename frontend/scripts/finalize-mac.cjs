const { spawnSync } = require("node:child_process");
const { feedNameFor } = require("./feed-name.cjs");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const dist = path.join(root, "dist");

function run(cmd, args, opts = {}) {
  const result = spawnSync(cmd, args, { stdio: "inherit", cwd: dist, ...opts });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

// The name people see for the app, from the bundle package-mac.cjs wrote.
function displayName(appDir) {
  const plist = fs.readFileSync(path.join(appDir, "Contents", "Info.plist"), "utf8");
  const m = /<key>CFBundleDisplayName<\/key><string>([^<]*)<\/string>/.exec(plist);
  const name = m ? m[1].replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&") : "CloudHouse Finance";
  return name.trim() || "CloudHouse Finance";
}

// The .dmg people download and install from: opens to the app beside an Applications shortcut, so installing is
// one drag. The update feed keeps using the .zip (the app unpacks it itself, see desktop/update/install_darwin.go).
function buildDmg(appName) {
  const name = displayName(path.join(dist, appName));
  const stage = path.join(dist, "dmg-stage");
  fs.rmSync(stage, { recursive: true, force: true });
  fs.mkdirSync(stage);
  // ditto keeps the bundle's signature intact.
  run("ditto", [appName, path.join(stage, `${name}.app`)]);
  fs.symlinkSync("/Applications", path.join(stage, "Applications"));
  const dmg = appName.replace(/\.app$/, ".dmg");
  fs.rmSync(path.join(dist, dmg), { force: true });
  run("hdiutil", ["create", "-volname", name, "-srcfolder", stage, "-ov", "-format", "UDZO", dmg]);
  fs.rmSync(stage, { recursive: true, force: true });
  if (process.env.MACOS_SIGNING_IDENTITY) {
    run("codesign", ["--force", "--timestamp", "--sign", process.env.MACOS_SIGNING_IDENTITY, dmg]);
  }
  return dmg;
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
  const dmg = buildDmg(appName);
  // The bundle itself is not uploaded (upload.js sends files only); remove it so dist/ holds just what ships.
  fs.rmSync(path.join(dist, appName), { recursive: true, force: true });
  fs.writeFileSync(path.join(dist, feedNameFor("mac")), JSON.stringify(manifest, null, 2));

  console.log(`finalized ${file} (update) and ${dmg} (download)`);
}

main();
