"use client";

import { useState, type CSSProperties } from "react";
import { BRAND } from "@/common/config/brand";
import { useBranding } from "@/common/BrandingProvider";
import BrandMark from "@/common/components/BrandMark";
import { DEFAULT_LOGO_DISPLAY, DEFAULT_LOGO_SCALE, LOGO_SCALES } from "@/common/config/theme";

/* The brand seal, as used by the sidebar, the three auth pages and the
 * DigiLocker callback.
 *
 * The artwork is rendered exactly as supplied: no crop, no background, no
 * border, no rounding. Earlier revisions of this component cropped to the
 * monogram and sat it on a white disc to raise contrast against the violet
 * sidebar; that was rejected — the logo is shown as-is by instruction.
 *
 * The one thing this still owns is the fallback: if the raster at
 * BRAND.markSrc is missing, it renders the inline-SVG BrandMark rather than a
 * broken-image icon. The five call sites used to hardcode an <img> at their
 * own copy of the logo path, so a renamed asset broke all of them
 * independently.
 */

type Props = {
  size?: number;
  className?: string;
  /** Whether the tenant's "Logo size in the sidebar/header" setting scales
   * THIS instance. Defaults true. The login page's own 168px mark already
   * matches the reference design's own login logo size exactly — applying
   * the SAME scale meant for an ~48px sidebar slot to a 168px one blew it
   * up far past the sidebar-sized intent the setting's own label promises.
   * Pass false for any usage that isn't the sidebar/header slot the setting
   * is actually named after. */
  scalable?: boolean;
};

export default function BrandLogo({ size = 46, className, scalable = true }: Props) {
  /* The signed-in business's own logo, falling back to the platform mark
   * when it has none. Two fallbacks stack: no logoUrl at all (here), and a
   * logoUrl that fails to load (onError below).
   *
   * `failed` is keyed on src so it resets when the logo changes. Without
   * that, one business's broken logo would leave the flag stuck on and the
   * next business signed into the same tab would render the platform mark
   * even though its own logo is fine. */
  const { logoUrl, legalName, logoScale, logoDisplay } = useBranding();
  const src = logoUrl || BRAND.markSrc;
  const alt = legalName || BRAND.legalName;

  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const failed = failedSrc === src;

  // A fixed `size` is deliberately wrong for every tenant: a wordmark-shaped
  // logo shrunk to a square slot goes illegible, a small mark blown up to
  // fill it looks oversized. `scale` is a per-tenant, admin-set correction
  // (superadmin console) on top of the fixed slot bound `size` still gives —
  // "small"/"default"/"large" for the cases where objectFit:contain's
  // automatic aspect-ratio fit still reads as visually smaller/larger than
  // its neighbours (thin linework vs. a solid block mark).
  const scale = scalable ? LOGO_SCALES[logoScale || DEFAULT_LOGO_SCALE] ?? 1 : 1;
  // The wrapper's OWN footprint scales — not the image past a fixed-size
  // wrapper. An earlier version kept the wrapper at the base `size` and
  // scaled the <img> inside it past 100%, which any parent's implicit or
  // explicit overflow clipping (the sidebar mark's own CSS class crops a
  // logo's outer edge — see app.css) simply cut off: the image never
  // visibly got bigger, it got zoomed-in-and-cropped instead. Scaling the
  // wrapper itself grows the whole visible slot, which the sidebar's
  // flex layout (the text column next to it is flex:1) accommodates.
  const effectiveSize = Math.round(size * scale);
  const display = logoDisplay || DEFAULT_LOGO_DISPLAY;
  // "light-pad"/"dark-pad" give a logo that only reads against one
  // background a backing swatch + a little breathing room, without
  // permanently cropping or recolouring the asset itself.
  const wrapperStyle: CSSProperties =
    display === "transparent"
      ? { display: "inline-flex", width: effectiveSize, height: effectiveSize, flexShrink: 0 }
      : {
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: effectiveSize,
          height: effectiveSize,
          flexShrink: 0,
          borderRadius: "20%",
          background: display === "dark-pad" ? "rgba(0,0,0,0.72)" : "#fff",
          padding: Math.round(effectiveSize * 0.08),
          boxSizing: "border-box",
        };

  if (failed) {
    return (
      <span style={wrapperStyle} className={className}>
        <BrandMark
          size={effectiveSize}
          // gradient, not currentColor: this stands in for a full-colour
          // raster, and it has to read on both the violet sidebar and the
          // white auth panels, neither of which shares a text colour.
          gradient
          title={alt}
        />
      </span>
    );
  }

  return (
    <span style={wrapperStyle} className={className}>
      <img
        src={src}
        alt={alt}
        // contain, so a non-square asset keeps its aspect ratio instead of
        // being stretched to the square box. 100%/100% of the wrapper,
        // which already carries the scale — see the comment above.
        style={{ objectFit: "contain", width: "100%", height: "100%" }}
        onError={() => setFailedSrc(src)}
      />
    </span>
  );
}
