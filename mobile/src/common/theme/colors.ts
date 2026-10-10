// Staff app palette — the maroon theme from ui-demos/staff-app-prototype.html
// (its `:root` block). That prototype is the source of truth for the staff UI:
// do not invent colours in screens/components, import from here instead.
//
// The palette is fixed for every business — per-tenant brand tinting was
// removed from the staff app with the prototype redesign, so these values can
// be imported directly or read through useTheme().colors interchangeably.
//
// Key names are the ROLE each colour plays (`brand` = primary, `nav`/`nav2` =
// dark grounds), so existing screens keep compiling against the same keys.
export const colors = {
  // prototype: --brand-deep / --brand / --brand-pale / --brand-faint
  brandDeep: "#6e1423",
  brand: "#8a2035",
  brandMid: "#a8475a",
  brandLight: "#d49aa5",
  brandPale: "#f6e3e6",
  brandFaint: "#fbf0f1",

  // prototype: --nav / --nav2 (hero header gradient runs nav → nav2 → brand)
  nav: "#3b0d14",
  nav2: "#6e1423",

  // prototype: --accent (stepper "current" dot)
  accent: "#c9a24b",
  accentDeep: "#9a7a2e",
  accentPale: "#f7eed8",

  ink: "#2b1013",
  muted: "#7a5a5e",

  bg: "#faf6f6",
  card: "#ffffff",
  line: "#eee0e1",

  green: "#157f4a",
  greenBg: "#e6f5ed",
  red: "#c0392b",
  redBg: "#fcebe9",
  amber: "#b57a0a",
  amberBg: "#fdf3dc",
  blue: "#1d6fd8",
  blueBg: "#e6f0fd",
  // "info" is the prototype's blue — kept as an alias for existing call sites.
  info: "#1d6fd8",
  infoBg: "#e6f0fd",
};

export type Colors = { [K in keyof typeof colors]: string };

export type StatusTone = "green" | "red" | "amber" | "info" | "brand" | "muted";

// Maps onto the prototype's four chip styles: .status-active (green),
// .status-overdue (red), .status-due (amber), .status-closed (faint/muted).
export function statusColors(tone: StatusTone, c: Colors = colors): { fg: string; bg: string } {
  switch (tone) {
    case "green":
      return { fg: c.green, bg: c.greenBg };
    case "red":
      return { fg: c.red, bg: c.redBg };
    case "amber":
      return { fg: c.amber, bg: c.amberBg };
    case "info":
      return { fg: c.blue, bg: c.blueBg };
    case "brand":
      return { fg: c.brandDeep, bg: c.brandPale };
    default:
      return { fg: c.muted, bg: c.brandFaint };
  }
}
