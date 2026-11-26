// Keys name the ROLE each colour plays, not its hue, so a re-theme stays a values-only change.
export const colors = {
  brandDeep: "#8a0f5c",
  brand: "#c0177a",
  brandMid: "#d91786",
  brandLight: "#f2a3d0",
  brandPale: "#fce4f1",
  brandFaint: "#fdf4f9",

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
  // Teal rather than blue, so "informational" isn't mistaken for a brand tone at a glance.
  info: "#0e7490",
  infoBg: "#e0f2f7",
} as const;

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
