const { execFileSync } = require("node:child_process");
const path = require("node:path");

const { version } = require(path.join(__dirname, "..", "package.json"));
const tag = `v${version}`;

execFileSync("git", ["tag", tag], { stdio: "inherit" });
execFileSync("git", ["push", "origin", tag], { stdio: "inherit" });
console.log(`pushed ${tag}`);
