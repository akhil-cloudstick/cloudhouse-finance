// Per-business theming — one picked colour drives the whole brand ramp.
// Ported from frontend/common/config/theme.ts: same maths (Ottosson's OKLab
// transform, held-lightness ramp, gamut-fit binary search), producing hex
// directly since React Native has no CSS custom properties to write oklch()
// into — see that file's header comment for the full rationale.
//
// Keep the six steps' l/chromaRatio values in step with theme.ts's RAMP and
// with app.css's :root — all three describe the same design.

export type Oklch = { l: number; c: number; h: number };

const BRAND_REFERENCE_CHROMA = 0.162;

// token names match the keys in ./colors.ts (brandDeep/brand/brandMid/
// brandLight/brandPale/brandFaint), not theme.ts's "--brand*" CSS vars.
const RAMP: { token: string; l: number; chromaRatio: number }[] = [
  { token: "brandDeep", l: 0.4, chromaRatio: 0.145 / BRAND_REFERENCE_CHROMA },
  { token: "brand", l: 0.515, chromaRatio: 1 },
  { token: "brandMid", l: 0.58, chromaRatio: 0.15 / BRAND_REFERENCE_CHROMA },
  { token: "brandLight", l: 0.75, chromaRatio: 0.1 / BRAND_REFERENCE_CHROMA },
  { token: "brandPale", l: 0.955, chromaRatio: 0.02 / BRAND_REFERENCE_CHROMA },
  { token: "brandFaint", l: 0.983, chromaRatio: 0.008 / BRAND_REFERENCE_CHROMA },
];

/** The platform default, mirroring backend/internal/branding.DefaultBrandColor. */
export const DEFAULT_BRAND_COLOR = "#6054bf";

function srgbToLinear(v: number): number {
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

function linearToSrgb(v: number): number {
  return v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
}

function hexToOklch(hex: string): Oklch | null {
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

function oklchToHex(color: Oklch): string {
  const { r, g, b } = oklchToLinearRgb(gamutFit(color));
  const to255 = (v: number) => {
    const n = Math.round(Math.min(1, Math.max(0, linearToSrgb(v))) * 255);
    return n.toString(16).padStart(2, "0");
  };
  return `#${to255(r)}${to255(g)}${to255(b)}`;
}

export type BrandRampHex = {
  brandDeep: string;
  brand: string;
  brandMid: string;
  brandLight: string;
  brandPale: string;
  brandFaint: string;
};

/**
 * deriveBrandRampHex regenerates all six brand steps from one picked colour,
 * as hex, ready to spread into colors.ts's shape. A malformed/unparseable
 * value falls back to the platform default rather than throwing — this can
 * run before the first paint, and a bad stored colour must degrade to the
 * default theme, never crash the app.
 */
export function deriveBrandRampHex(hex: string | null | undefined): BrandRampHex {
  const picked = (hex && hexToOklch(hex)) || hexToOklch(DEFAULT_BRAND_COLOR)!;
  const out = {} as BrandRampHex;
  for (const step of RAMP) {
    out[step.token as keyof BrandRampHex] = oklchToHex(
      gamutFit({ l: step.l, c: picked.c * step.chromaRatio, h: picked.h })
    );
  }
  return out;
}
