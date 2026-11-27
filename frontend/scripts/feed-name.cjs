// The per-OS update feed in a tenant's folder. Windows keeps the original "latest.json" so apps already installed
// keep finding their updates; macOS and Linux get their own, so a Mac build finishing last can no longer overwrite the
// Windows feed (and offer a Windows PC the Mac file). Keep in step with desktop/update/update.go's feedName.
const FEEDS = { win: "latest.json", mac: "latest-mac.json", linux: "latest-linux.json" };
const FEED_FILE = /^latest(-mac|-linux)?\.json$/;

function feedNameFor(os) {
  return FEEDS[os];
}

module.exports = { feedNameFor, FEED_FILE, FEEDS };
