/* Per-business theming — one picked colour drives the whole brand ramp.
 *
 * WHY THIS EXISTS. The `:root` block in app/app/app.css defines six brand
 * steps (deep/brand/mid/light/pale/faint) that 115 `var(--brand*)` rules read
 * from. Those six are not six independent choices: they are ONE colour walked
 * up and down a fixed lightness/chroma curve, all on the same hue. So a
 * business picks one colour and this file regenerates the curve around it —
 * which is why the superadmin console offers a single picker rather than six.
 *
 * Everything is oklch, matching app.css. Lightness in oklch is perceptual, so
 * holding L fixed and moving only the hue keeps each step's contrast roughly
 * where it was designed to be — the reason the ramp survives an arbitrary hue
 * at all, and why this could not be done by scaling sRGB channels.
 */

export type Oklch = { l: number; c: number; h: number };

/* The reference ramp, read straight off app.css's :root. L is absolute; C is
 * expressed as a RATIO of --brand's own chroma (0.162) so a muted pick stays
 * muted and a vivid one stays vivid, instead of every business landing on the
 * same saturation.
 *
 * Keep in step with app.css. If a step's L changes there, change it here — the
 * fallback stylesheet and the generated one must describe the same design. */
const BRAND_REFERENCE_CHROMA = 0.162;

const RAMP: { token: string; l: number; chromaRatio: number }[] = [
  { token: "--brand-deep", l: 0.4, chromaRatio: 0.145 / BRAND_REFERENCE_CHROMA },
  { token: "--brand", l: 0.515, chromaRatio: 1 },
  // Deliberately LIGHTER than --brand: it is a fill (tabs, selected days,
  // hairlines), never text. See app.css's note.
  { token: "--brand-mid", l: 0.58, chromaRatio: 0.15 / BRAND_REFERENCE_CHROMA },
  { token: "--brand-light", l: 0.75, chromaRatio: 0.1 / BRAND_REFERENCE_CHROMA },
  { token: "--brand-pale", l: 0.955, chromaRatio: 0.02 / BRAND_REFERENCE_CHROMA },
  { token: "--brand-faint", l: 0.983, chromaRatio: 0.008 / BRAND_REFERENCE_CHROMA },
];

/** The platform default, mirroring app.css and backend/internal/branding. */
export const DEFAULT_BRAND_COLOR = "#6054bf";

/* --- sRGB <-> OKLCH ---------------------------------------------------------
 *
 * Hand-rolled rather than pulled from a library: this is ~60 lines of
 * well-defined matrix maths, and the app has no colour dependency today
 * (package.json is next/react/react-dom/qrcode). Ottosson's OKLab transform.
 */

function srgbToLinear(v: number): number {
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

function linearToSrgb(v: number): number {
  return v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
}

export function hexToOklch(hex: string): Oklch | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const int = parseInt(m[1], 16);
  const r = srgbToLinear(((int >> 16) & 255) / 255);
  const g = srgbToLinear(((int >> 8) & 255) / 255);
  const b = srgbToLinear((int & 255) / 255);

  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m_ = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);

  const okL = 0.2104542553 * l + 0.793617785 * m_ - 0.0040720468 * s;
  const okA = 1.9779984951 * l - 2.428592205 * m_ + 0.4505937099 * s;
  const okB = 0.0259040371 * l + 0.7827717662 * m_ - 0.808675766 * s;

  const chroma = Math.sqrt(okA * okA + okB * okB);
  let hue = (Math.atan2(okB, okA) * 180) / Math.PI;
  if (hue < 0) hue += 360;
  return { l: okL, c: chroma, h: hue };
}

/* oklchToRgb returns channels in 0..1 and a flag for whether the colour fell
 * outside sRGB before clamping — which is what gamutFit below uses to walk
 * chroma down instead of letting the browser clip unpredictably. */
function oklchToLinearRgb({ l, c, h }: Oklch): { r: number; g: number; b: number; inGamut: boolean } {
  const hr = (h * Math.PI) / 180;
  const a = c * Math.cos(hr);
  const bb = c * Math.sin(hr);

  const l_ = (l + 0.3963377774 * a + 0.2158037573 * bb) ** 3;
  const m_ = (l - 0.1055613458 * a - 0.0638541728 * bb) ** 3;
  const s_ = (l - 0.0894841775 * a - 1.291485548 * bb) ** 3;

  const r = 4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_;
  const g = -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_;
  const b = -0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_;

  const eps = 1e-4;
  const inGamut = [r, g, b].every((v) => v >= -eps && v <= 1 + eps);
  return { r, g, b, inGamut };
}

/* gamutFit reduces chroma until the colour fits in sRGB.
 *
 * app.css's header warns that above the gamut ceiling browsers gamut-map
 * differently and Chrome and Safari disagree — which would desync the hex
 * mirrors this file also produces for print. Binary search on chroma keeps
 * lightness and hue exact and gives one answer everywhere. */
function gamutFit(color: Oklch): Oklch {
  if (oklchToLinearRgb(color).inGamut) return color;
  let lo = 0;
  let hi = color.c;
  for (let i = 0; i < 20; i++) {
    const mid = (lo + hi) / 2;
    if (oklchToLinearRgb({ ...color, c: mid }).inGamut) lo = mid;
    else hi = mid;
  }
  return { ...color, c: lo };
}

export function oklchToHex(color: Oklch): string {
  const { r, g, b } = oklchToLinearRgb(gamutFit(color));
  const to255 = (v: number) => {
    const n = Math.round(Math.min(1, Math.max(0, linearToSrgb(v))) * 255);
    return n.toString(16).padStart(2, "0");
  };
  return `#${to255(r)}${to255(g)}${to255(b)}`;
}

export function oklchToCss({ l, c, h }: Oklch): string {
  return `oklch(${l.toFixed(3)} ${c.toFixed(3)} ${h.toFixed(1)})`;
}

/* --- The ramp --------------------------------------------------------------- */

export type BrandRamp = Record<string, Oklch>;

/**
 * deriveBrandRamp regenerates all six brand steps from one picked colour,
 * keeping its hue and scaling the reference chroma curve by how saturated the
 * pick actually is.
 *
 * A malformed or unparseable value falls back to the platform default rather
 * than throwing: this runs during first paint, and a bad stored colour must
 * degrade to the default theme, never to a blank app.
 */
export function deriveBrandRamp(hex: string): BrandRamp {
  const picked = hexToOklch(hex) ?? hexToOklch(DEFAULT_BRAND_COLOR)!;
  const ramp: BrandRamp = {};
  for (const step of RAMP) {
    ramp[step.token] = gamutFit({
      l: step.l,
      c: picked.c * step.chromaRatio,
      h: picked.h,
    });
  }
  return ramp;
}

/** The six steps as hex — for the surfaces that cannot read a CSS variable. */
export function brandRampHex(hex: string): Record<string, string> {
  const ramp = deriveBrandRamp(hex);
  const out: Record<string, string> = {};
  for (const [token, color] of Object.entries(ramp)) out[token] = oklchToHex(color);
  return out;
}


/* The two decorations whose colour lives INSIDE a data-URI SVG, where CSS
 * cannot interpolate a variable — see the --page-pattern/--select-caret
 * block in app/app/app.css. Rebuilt here with the derived hex so they track
 * the business's colour like everything else.
 *
 * The `#` must be percent-encoded as %23 inside a data URI; leaving it raw
 * silently truncates the URL at the fragment and the image disappears. */
function pagePatternURI(hex: string): string {
  const c = encodeURIComponent(hex); // "#" becomes "%23"
  return `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120' viewBox='0 0 120 120'%3E%3Cg fill='none' stroke='${c}' stroke-width='0.5' opacity='0.035'%3E%3Cpath d='M60 8 L112 60 L60 112 L8 60 Z'/%3E%3Ccircle cx='60' cy='60' r='14'/%3E%3C/g%3E%3C/svg%3E")`;
}

function selectCaretURI(hex: string): string {
  const c = encodeURIComponent(hex);
  return `url("data:image/svg+xml;utf8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'%3E%3Cpath d='M1 1l4 4 4-4' stroke='${c}' stroke-width='1.6' fill='none' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E")`;
}
/**
 * applyBrandTheme writes the ramp onto the document root, where all 115
 * `var(--brand*)` consumers in app.css and login.css pick it up immediately.
 * login.css's `color-mix(in oklab, var(--brand) ...)` focus rings follow for
 * free, since they are expressed in terms of the variable rather than a
 * literal.
 *
 * Safe to call before React mounts, and safe to call repeatedly.
 */
export function applyBrandTheme(hex: string | null | undefined): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  const ramp = deriveBrandRamp(hex || DEFAULT_BRAND_COLOR);
  for (const [token, color] of Object.entries(ramp)) {
    root.style.setProperty(token, oklchToCss(color));
  }
  // The two data-URI decorations, which cannot read a variable from inside
  // the SVG and so are regenerated whole.
  const brandHex = oklchToHex(ramp["--brand"]);
  root.style.setProperty("--page-pattern", pagePatternURI(brandHex));
  root.style.setProperty("--select-caret", selectCaretURI(brandHex));
}

/* --- Pre-paint cache --------------------------------------------------------
 *
 * next.config.ts sets output: "export", so there is no server render to inject
 * the colour into — the first paint happens before any fetch can return. The
 * colour is therefore cached per business slug and replayed by a tiny blocking
 * script in app/layout.tsx, exactly like tenantSession.ts keys sessions per
 * slug so two businesses in two tabs cannot clobber each other.
 */

export const BRAND_COLOR_KEY_PREFIX = "cloudhouse_brand::";

export function cacheBrandColor(slug: string | null, hex: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(BRAND_COLOR_KEY_PREFIX + (slug || "default"), hex);
  } catch {
    /* Private mode / storage disabled — the theme still applies for this
     * page load, it just flashes the default on the next one. */
  }
}

export function readCachedBrandColor(slug: string | null): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(BRAND_COLOR_KEY_PREFIX + (slug || "default"));
  } catch {
    return null;
  }
}
