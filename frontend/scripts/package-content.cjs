const { spawnSync } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { loadEnvConfig } = require("@next/env");

const root = path.join(__dirname, "..");
const { version: pkgVersion } = require(path.join(root, "package.json"));
const version = process.env.RELEASE_VERSION || pkgVersion;

loadEnvConfig(root, false);

function run(cmd, args, opts = {}) {
  const result = spawnSync(cmd, args, { stdio: "inherit", cwd: root, shell: cmd === "node" ? false : true, ...opts });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

// Builds only the web-app content (no Go, no branding) into one package shared by every tenant.
function zipDir(srcDir, zipPath) {
  // Avoid a new dependency: shell out to the platform's own zip tool.
  if (process.platform === "win32") {
    run("powershell", [
      "-NoProfile",
      "-Command",
      `Compress-Archive -Path '${srcDir}\\*' -DestinationPath '${zipPath}' -Force`,
    ]);
  } else {
    run("zip", ["-r", "-X", zipPath, "."], { cwd: srcDir });
  }
}

async function main() {
  run("node", [path.join(__dirname, "build-desktop.cjs")]);

  const outDir = path.join(root, "dist-content");
  fs.mkdirSync(outDir, { recursive: true });
  for (const entry of fs.readdirSync(outDir)) {
    fs.rmSync(path.join(outDir, entry), { recursive: true, force: true });
  }

  const file = `content-${version}.zip`;
  const zipPath = path.join(outDir, file);
  zipDir(path.join(root, "dist-desktop"), zipPath);

  const bytes = fs.readFileSync(zipPath);
  const manifest = {
    version,
    file,
    sha512: crypto.createHash("sha512").update(bytes).digest("hex"),
    size: bytes.length,
  };
  fs.writeFileSync(path.join(outDir, "latest-content.json"), JSON.stringify(manifest, null, 2));

  console.log(`built ${file}`);
}

main();
