// Metro config — no new dependency, this is Expo's standard extension
// point (https://docs.expo.dev/guides/customizing-metro/).
//
// On Windows, Metro's fallback file watcher (used when Watchman isn't
// installed) can crash with ENOENT if it tries to watch a transient
// `.debugger-shell-*` folder that @expo/cli's bundled @react-native
// debugger-frontend tooling downloads/extracts into its own
// node_modules on first run (observed at
// node_modules/@expo/cli/node_modules/@react-native/.debugger-shell-*).
// That tooling isn't part of the app bundle, so excluding it from the
// watcher's blockList avoids the crash without needing Watchman or any
// other dependency.
const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);

config.resolver.blockList = [
  /node_modules[\/\\]@expo[\/\\]cli[\/\\]node_modules[\/\\]@react-native[\/\\]\.debugger-shell.*/,
];

module.exports = config;
