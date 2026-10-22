const path = require("node:path");
const { loadEnvConfig } = require("@next/env");

// B2 write credentials live only in backend/.env, never frontend/.env.local; this fills in whatever frontend's own env didn't set.
function loadReleaseEnv(frontendRoot) {
  loadEnvConfig(frontendRoot, false);
  loadEnvConfig(path.join(frontendRoot, "..", "backend"), false);
}

module.exports = { loadReleaseEnv };
