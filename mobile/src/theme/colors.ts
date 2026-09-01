// Ported from frontend/app/app/app.css ":root" — the "Ambika Gold Finance
// Admin UI" theme. Keep these values in sync with that file; do not invent
// new colors in screens/components, import from here instead.
export const colors = {
  goldDeep: "#9a6f0f",
  gold: "#c9971c",
  goldMid: "#d4af37",
  goldLight: "#eccd6f",
  goldPale: "#f7e9c4",

  charcoal: "#231f18",
  charcoal2: "#2e2921",
  ink: "#3a3325",
  muted: "#8a7d5a",

  ivory: "#faf6ec",
  card: "#fffdf7",
  line: "#e8dcba",

  green: "#4d7c2a",
  greenBg: "#eef4e2",
  red: "#a3372a",
  redBg: "#fbeae6",
  amber: "#a06d08",
  amberBg: "#faf0d4",
  blue: "#3b5f7a",
  blueBg: "#e8f0f6",
} as const;

export type StatusTone = "green" | "red" | "amber" | "blue" | "muted";

export function statusColors(tone: StatusTone): { fg: string; bg: string } {
  switch (tone) {
    case "green":
      return { fg: colors.green, bg: colors.greenBg };
    case "red":
      return { fg: colors.red, bg: colors.redBg };
    case "amber":
      return { fg: colors.amber, bg: colors.amberBg };
    case "blue":
      return { fg: colors.blue, bg: colors.blueBg };
    default:
      return { fg: colors.muted, bg: colors.goldPale };
  }
}
