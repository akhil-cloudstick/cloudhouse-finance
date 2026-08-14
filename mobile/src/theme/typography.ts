// Web app uses 'Jost' for body text and 'Bodoni Moda' (serif) for headings —
// see frontend/app/app/app.css lines 29/38. Loaded via @expo-google-fonts in
// app/_layout.tsx; reference the family names below rather than hardcoding
// font strings in screens.
export const fonts = {
  body: "Jost_400Regular",
  bodyMedium: "Jost_500Medium",
  bodySemiBold: "Jost_600SemiBold",
  serif: "BodoniModaSC_600SemiBold",
} as const;

export const typeScale = {
  h1: { fontFamily: fonts.serif, fontSize: 28 },
  h2: { fontFamily: fonts.serif, fontSize: 22 },
  h3: { fontFamily: fonts.serif, fontSize: 18 },
  body: { fontFamily: fonts.body, fontSize: 15 },
  label: { fontFamily: fonts.bodyMedium, fontSize: 13 },
  small: { fontFamily: fonts.body, fontSize: 12 },
} as const;
