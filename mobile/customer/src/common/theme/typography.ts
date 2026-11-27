// `serif` is a legacy alias for `display` (Montserrat), kept so old fonts.serif references keep working.
export const fonts = {
  body: "Inter_400Regular",
  bodyMedium: "Inter_500Medium",
  bodySemiBold: "Inter_600SemiBold",
  display: "Montserrat_700Bold",
  serif: "Montserrat_700Bold",
} as const;

export const typeScale = {
  h1: { fontFamily: fonts.display, fontSize: 32, fontWeight: "700" as const },
  h2: { fontFamily: fonts.display, fontSize: 26, fontWeight: "700" as const },
  h3: { fontFamily: fonts.display, fontSize: 21, fontWeight: "700" as const },
  body: { fontFamily: fonts.body, fontSize: 15 },
  label: { fontFamily: fonts.bodyMedium, fontSize: 13 },
  small: { fontFamily: fonts.body, fontSize: 12 },
} as const;
