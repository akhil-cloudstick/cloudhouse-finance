// Body text is 'Jost', matching the web app (frontend/app/app/app.css).
// Loaded via @expo-google-fonts in app/_layout.tsx; reference the family
// names below rather than hardcoding font strings in screens.
// Headings deliberately diverge from the web frontend, which still uses
// Bodoni Moda SC: its small caps and extreme thick/thin contrast get hard to
// read at phone sizes. customer-mobile/src/theme/typography.ts matches —
// keep the two in sync.
export const fonts = {
  body: "Jost_400Regular",
  bodyMedium: "Jost_500Medium",
  bodySemiBold: "Jost_600SemiBold",
  serif: "NunitoSans_800ExtraBold",
} as const;

export const typeScale = {
  // Headings run larger than the old Bodoni scale (28/22/18) — Playfair's
  // mixed-case letterforms read visually smaller than Bodoni's small caps at
  // the same point size, so matching the old sizes would have made headings
  // feel like they shrank.
  h1: { fontFamily: fonts.serif, fontSize: 32 },
  h2: { fontFamily: fonts.serif, fontSize: 26 },
  h3: { fontFamily: fonts.serif, fontSize: 21 },
  body: { fontFamily: fonts.body, fontSize: 15 },
  label: { fontFamily: fonts.bodyMedium, fontSize: 13 },
  small: { fontFamily: fonts.body, fontSize: 12 },
} as const;
