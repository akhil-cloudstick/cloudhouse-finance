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
const path = require("path");
const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);

config.resolver.blockList = [
  /node_modules[\/\\]@expo[\/\\]cli[\/\\]node_modules[\/\\]@react-native[\/\\]\.debugger-shell.*/,
];

// The tab view's scene wrapper is swapped for our own — see
// src/common/components/layout/TabSceneFallback.tsx for why (SDK 58 hid the page being swiped
// in, so it showed blank with no spinner). Only the bottom-tabs import is redirected.
const TAB_VIEWS_DIR = /expo-router[\/\\]build[\/\\]react-navigation[\/\\]bottom-tabs[\/\\]views$/;
const TAB_SCENE_FALLBACK = path.resolve(__dirname, "src/common/components/layout/TabSceneFallback.tsx");
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === "./ScreenFallback" && TAB_VIEWS_DIR.test(path.dirname(context.originModulePath))) {
    return { type: "sourceFile", filePath: TAB_SCENE_FALLBACK };
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
