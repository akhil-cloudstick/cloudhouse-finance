import { deriveBrandRampHex, DEFAULT_BRAND_COLOR } from "./brandRamp";

// Ported from frontend/app/app/app.css ":root" — the CloudHouse Finance
// admin theme. Keep these values in sync with that file; do not invent new
// colors in screens/components, import from here instead.
//
// The key names below are the ROLE each colour plays, not its hue, so a
// re-theme stays a values-only change: `brand` is the primary (buttons,
// links, active state), set per business at runtime (see below);
// `nav`/`nav2` are the violet dark grounds; `accent` is the orange the
// logo's gradient lands on and is deliberately rationed.
//
// The six brand* steps are not literals: they are derived from the platform
// default (backend/internal/branding.DefaultBrandColor) with the same ramp
// the web app uses, so "no branding set" looks identical on both. At runtime
// ThemeProvider swaps in the business's own ramp — so read brand* through
// useTheme().colors, never from this static object, or that screen ignores
// the business's colour. The neutral tokens below never change per business
// and may be imported directly.
export const colors = {
  ...deriveBrandRampHex(DEFAULT_BRAND_COLOR),

  nav: "#2b1a5e",
  nav2: "#45248f",

  accent: "#ef7f28",
  accentDeep: "#a85205",
  accentPale: "#fdeeda",

  ink: "#16233d",
  muted: "#64748b",

  bg: "#f7f6fb",
  card: "#ffffff",
  line: "#e9e4f2",

  green: "#157f4a",
  greenBg: "#e6f5ed",
  red: "#c0392b",
  redBg: "#fcebe9",
  amber: "#b57a0a",
  amberBg: "#fdf3dc",
  // Teal rather than blue, so an "informational" tone cannot be mistaken for
  // a brand tone at a glance.
  info: "#0e7490",
  infoBg: "#e0f2f7",
};

// Every token as a plain string — a themed ramp replaces the brand* values at
// runtime, so they cannot be typed as their default literals.
export type Colors = { [K in keyof typeof colors]: string };

// "brand"/"info" replace the old "gold"/"blue" tones — they name the role, so
// they survive a re-theme. Matches the .chip.* classes in the web app and the
// STATUS_COLOR map in frontend/common/utils/format.ts; keep all three in step.
export type StatusTone = "green" | "red" | "amber" | "info" | "brand" | "muted";

// Pass useTheme().colors from inside a component so the "brand" tone follows
// the business's colour; defaults to the static (platform) set.
export function statusColors(tone: StatusTone, c: Colors = colors): { fg: string; bg: string } {
  switch (tone) {
    case "green":
      return { fg: c.green, bg: c.greenBg };
    case "red":
      return { fg: c.red, bg: c.redBg };
    case "amber":
      return { fg: c.amber, bg: c.amberBg };
    case "info":
      return { fg: c.info, bg: c.infoBg };
    case "brand":
      return { fg: c.brand, bg: c.brandPale };
    default:
      return { fg: c.muted, bg: c.brandFaint };
  }
}
