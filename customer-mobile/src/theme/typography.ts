// Ported verbatim from mobile/src/theme/typography.ts. Loaded via
// @expo-google-fonts in app/_layout.tsx; reference the family names below
// rather than hardcoding font strings in screens.
// Headings use Nunito Sans rather than the Bodoni Moda SC the web frontend
// still uses (frontend/app/app/app.css) — a deliberate divergence for the
// mobile apps only: Bodoni's small caps and extreme thick/thin contrast get
// hard to read at phone sizes, especially h3, which is the size most headings
// on these screens actually are. `serif` keeps its name so every existing
// typeScale reference stays valid, though the family is now a humanist sans.
export const fonts = {
  body: "Jost_400Regular",
  bodyMedium: "Jost_500Medium",
  bodySemiBold: "Jost_600SemiBold",
  serif: "Jost_700Bold",
} as const;

export const typeScale = {
  // Headings run larger than the old Bodoni scale (28/22/18) — mixed-case
  // letterforms read visually smaller than Bodoni's small caps at the same
  // point size, so matching the old sizes would have made headings feel like
  // they shrank.
  h1: { fontFamily: fonts.serif, fontSize: 32, fontWeight: "700" as const },
  h2: { fontFamily: fonts.serif, fontSize: 26, fontWeight: "700" as const },
  h3: { fontFamily: fonts.serif, fontSize: 21, fontWeight: "700" as const },
  body: { fontFamily: fonts.body, fontSize: 15 },
  label: { fontFamily: fonts.bodyMedium, fontSize: 13 },
  small: { fontFamily: fonts.body, fontSize: 12 },
} as const;
