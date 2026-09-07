// Ported from frontend/app/app/app.css ":root" — the Chittilapilly Thommana
// Financiers & Investments (CTFI) admin theme. Keep these values in sync with
// that file; do not invent new colors in screens/components, import from here
// instead.
//
// The key names below are the ROLE each colour plays, not its hue: they were
// renamed from goldDeep/gold/goldMid/charcoal/ivory when the app was
// re-themed from the previous gold identity to CTFI navy, so that the next
// re-theme is a values-only change. `brand` is the primary (buttons, links,
// active state); `accent` is the gold of the wordmark's "GOLD LOAN" badge and
// is deliberately rationed.
export const colors = {
  brandDeep: "#14306e",
  brand: "#1a3e93",
  brandMid: "#2450be",
  brandLight: "#a8beec",
  brandPale: "#e4ecfb",
  brandFaint: "#f2f6fd",

  nav: "#0e2050",
  nav2: "#14306e",

  accent: "#c9a227",
  accentDeep: "#9a7a12",
  accentPale: "#fbf3d8",

  ink: "#16233d",
  muted: "#64748b",

  bg: "#f5f7fb",
  card: "#ffffff",
  line: "#e1e7f2",

  green: "#157f4a",
  greenBg: "#e6f5ed",
  red: "#c0392b",
  redBg: "#fcebe9",
  amber: "#b57a0a",
  amberBg: "#fdf3dc",
  // Teal rather than blue, so an "informational" tone cannot be mistaken for
  // the brand navy at a glance.
  info: "#0e7490",
  infoBg: "#e0f2f7",
} as const;

// "brand"/"info" replace the old "gold"/"blue" tones — they name the role, so
// they survive a re-theme. Matches the .chip.* classes in the web app and the
// STATUS_COLOR map in frontend/common/utils/format.ts; keep all three in step.
export type StatusTone = "green" | "red" | "amber" | "info" | "brand" | "muted";

export function statusColors(tone: StatusTone): { fg: string; bg: string } {
  switch (tone) {
    case "green":
      return { fg: colors.green, bg: colors.greenBg };
    case "red":
      return { fg: colors.red, bg: colors.redBg };
    case "amber":
      return { fg: colors.amber, bg: colors.amberBg };
    case "info":
      return { fg: colors.info, bg: colors.infoBg };
    case "brand":
      return { fg: colors.brand, bg: colors.brandPale };
    default:
      return { fg: colors.muted, bg: colors.brandFaint };
  }
}
