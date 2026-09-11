"use client";

import { useState } from "react";
import { BRAND } from "@/common/config/brand";
import { useBranding } from "@/common/BrandingProvider";
import BrandMark from "@/common/components/BrandMark";

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
};

export default function BrandLogo({ size = 46, className }: Props) {
  /* The signed-in business's own logo, falling back to the platform mark
   * when it has none. Two fallbacks stack: no logoUrl at all (here), and a
   * logoUrl that fails to load (onError below).
   *
   * `failed` is keyed on src so it resets when the logo changes. Without
   * that, one business's broken logo would leave the flag stuck on and the
   * next business signed into the same tab would render the platform mark
   * even though its own logo is fine. */
  const { logoUrl, legalName } = useBranding();
  const src = logoUrl || BRAND.markSrc;
  const alt = legalName || BRAND.legalName;

  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const failed = failedSrc === src;

  if (failed) {
    return (
      <BrandMark
        size={size}
        className={className}
        // gradient, not currentColor: this stands in for a full-colour
        // raster, and it has to read on both the violet sidebar and the
        // white auth panels, neither of which shares a text colour.
        gradient
        title={alt}
      />
    );
  }

  return (
    <img
      src={src}
      alt={alt}
      className={className}
      width={size}
      height={size}
      // contain, so a non-square asset keeps its aspect ratio instead of
      // being stretched to the square box.
      style={{ objectFit: "contain", flexShrink: 0 }}
      onError={() => setFailedSrc(src)}
    />
  );
}
