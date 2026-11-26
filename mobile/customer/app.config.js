// Extends app.json. APP_VARIANT=development (set in eas.json) installs side by side
// with the customer app by using a ".dev" id suffix. Preview/production keep the plain id.
// extra.releaseVersion is expo.version, the number the in-app update check compares with the latest.json the GitHub
// build publishes (src/common/utils/app-update.ts).
const isDev = process.env.APP_VARIANT === "development";

module.exports = ({ config }) => ({
  ...config,
  name: isDev ? `${config.name} (Dev)` : config.name,
  scheme: isDev ? `${config.scheme}-dev` : config.scheme,
  extra: { ...config.extra, releaseVersion: config.version },
  ios: {
    ...config.ios,
    bundleIdentifier: isDev
      ? `${config.ios.bundleIdentifier}.dev`
      : config.ios.bundleIdentifier,
  },
  android: {
    ...config.android,
    package: isDev ? `${config.android.package}.dev` : config.android.package,
  },
});
