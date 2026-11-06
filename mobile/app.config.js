// Extends app.json. APP_VARIANT=development (set in eas.json) installs side by side
// with the production app by using a ".dev" id suffix. Preview/production keep the plain id.
const isDev = process.env.APP_VARIANT === "development";

module.exports = ({ config }) => ({
  ...config,
  name: isDev ? `${config.name} (Dev)` : config.name,
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
