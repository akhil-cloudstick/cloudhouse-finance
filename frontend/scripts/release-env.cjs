const path = require("node:path");
const { loadEnvConfig } = require("@next/env");

const quiet = { info() {}, error: console.error };

// B2 write credentials live only in backend/.env, never frontend/.env.local; this fills in whatever frontend's own env
// didn't set. @next/env caches its first load and ignores a second loadEnvConfig call (it only reloads with
// forceReload, which first resets process.env), so backend/.env is read on its own and merged in by hand — otherwise
// the S3_* keys never arrive and the build gets no update address.
function loadReleaseEnv(frontendRoot, dev = false) {
  const { combinedEnv: backend } = loadEnvConfig(path.join(frontendRoot, "..", "backend"), dev, quiet, true);
  const backendEnv = { ...backend };
  loadEnvConfig(frontendRoot, dev, undefined, true);
  for (const [key, value] of Object.entries(backendEnv)) {
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

module.exports = { loadReleaseEnv };
