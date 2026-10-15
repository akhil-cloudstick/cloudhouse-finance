import { StyleSheet, type StyleProp, type TextStyle } from "react-native";

// The app's typeface is IBM Plex Sans on both platforms (Regular / Medium / SemiBold),
// loaded via @expo-google-fonts in RootLayout.tsx. Reference the family names below
// rather than hardcoding font strings in screens. Nothing heavier than SemiBold is used.
export const fonts = {
  body: "IBMPlexSans_400Regular",
  bodyMedium: "IBMPlexSans_500Medium",
  bodySemiBold: "IBMPlexSans_600SemiBold",
  // Kept as aliases so older references keep working; the heaviest weight is SemiBold.
  bodyBold: "IBMPlexSans_600SemiBold",
  bodyExtraBold: "IBMPlexSans_600SemiBold",
  display: "IBMPlexSans_600SemiBold",
  serif: "IBMPlexSans_600SemiBold",
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

// App-wide text size multiplier, applied centrally in Txt (hardcoded
// StyleSheet sizes stay as authored). Rounded to the nearest 0.5.
export const FONT_SCALE = 1.04;
export const scaled = (size: number) => Math.round(size * FONT_SCALE * 2) / 2;

// Custom fonts ignore fontWeight, so pick the Plex file by weight.
export function fontFor(weight?: TextStyle["fontWeight"]): string {
  const w = weight === "bold" ? 700 : weight === "normal" || weight == null ? 400 : Number(weight);
  // Nothing heavier than SemiBold: 700/800 text read too heavy, so they share the 600 weight.
  if (w >= 600) return fonts.bodySemiBold;
  if (w >= 500) return fonts.bodyMedium;
  return fonts.body;
}

// Resolves a text style: optional size scaling plus the Plex family for the
// weight. An explicit fontFamily is respected untouched.
export function textStyle(style: StyleProp<TextStyle>, scale = true): TextStyle {
  const flat: TextStyle = { ...(StyleSheet.flatten(style) || {}) };
  if (scale) {
    if (typeof flat.fontSize === "number") flat.fontSize = scaled(flat.fontSize);
    if (typeof flat.lineHeight === "number") flat.lineHeight = scaled(flat.lineHeight);
  }
  if (!flat.fontFamily) {
    const family = fontFor(flat.fontWeight);
    if (family) {
      flat.fontFamily = family;
      flat.fontWeight = "normal";
    }
  }
  return flat;
}
