import { Platform } from "react-native";

// Body text is 'Inter', headings 'Montserrat' — matching the web app
// (frontend/app/layout.tsx). Loaded via @expo-google-fonts in
// app/_layout.tsx; reference the family names below rather than hardcoding
// font strings in screens.
//
// Web and mobile finally agree on typography. They used not to: the web app
// set headings in Bodoni Moda SC, which these apps refused to adopt because
// its small caps and extreme thick/thin contrast are hard to read at phone
// sizes — so `serif` was aliased to a sans here and the two drifted. The CloudHouse
// re-theme dropped Bodoni everywhere in favour of Montserrat, which carries
// the wordmark's voice and holds up at h3, the size most headings on these
// screens actually are.
//
// `display` is the real name for the heading family. `serif` is kept as an
// alias purely so existing typeScale references and any screen that reached
// for fonts.serif keep working; it has not been an actual serif since before
// this re-theme.
// iOS uses the system face, San Francisco (weights come from fontWeight in
// typeScale). SF's licence limits it to Apple platforms, so Android keeps
// Inter/Montserrat — Inter is the closest freely-licensed match to SF.
const ios = Platform.OS === "ios";
export const fonts = {
  body: ios ? "System" : "Inter_400Regular",
  bodyMedium: ios ? "System" : "Inter_500Medium",
  bodySemiBold: ios ? "System" : "Inter_600SemiBold",
  display: ios ? "System" : "Montserrat_700Bold",
  serif: ios ? "System" : "Montserrat_700Bold",
};

export const typeScale = {
  // Headings run larger than the old Bodoni scale (28/22/18) — mixed-case
  // letterforms read visually smaller than Bodoni's small caps at the same
  // point size, so matching the old sizes would have made headings feel like
  // they shrank.
  h1: { fontFamily: fonts.display, fontSize: 32, fontWeight: "700" as const },
  h2: { fontFamily: fonts.display, fontSize: 26, fontWeight: "700" as const },
  h3: { fontFamily: fonts.display, fontSize: 21, fontWeight: "700" as const },
  body: { fontFamily: fonts.body, fontSize: 15 },
  label: { fontFamily: fonts.bodyMedium, fontSize: 13, fontWeight: "500" as const },
  small: { fontFamily: fonts.body, fontSize: 12 },
} as const;
