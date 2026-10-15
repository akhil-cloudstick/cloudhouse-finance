// Config plugin: Android paints a yellow highlight/outline over a field that was filled from an
// autofill suggestion. Turn it off for the whole app theme.
const { withAndroidStyles } = require("expo/config-plugins");

module.exports = function withNoAutofillHighlight(config) {
  return withAndroidStyles(config, (cfg) => {
    const styles = cfg.modResults.resources.style ?? [];
    const theme = styles.find((s) => s.$.name === "AppTheme");
    if (theme) {
      theme.item = (theme.item ?? []).filter((i) => i.$.name !== "android:autofilledHighlight");
      theme.item.push({ $: { name: "android:autofilledHighlight" }, _: "@android:color/transparent" });
    }
    return cfg;
  });
};
