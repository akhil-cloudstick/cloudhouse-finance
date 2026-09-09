"use client";

import { useState } from "react";
import { BRAND } from "@/common/config/brand";
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
  const [failed, setFailed] = useState(false);

  if (failed) {
    return (
      <BrandMark
        size={size}
        className={className}
        // gradient, not currentColor: this stands in for a full-colour
        // raster, and it has to read on both the violet sidebar and the
        // white auth panels, neither of which shares a text colour.
        gradient
        title={BRAND.legalName}
      />
    );
  }

  return (
    <img
      src={BRAND.markSrc}
      alt={BRAND.legalName}
      className={className}
      width={size}
      height={size}
      // contain, so a non-square asset keeps its aspect ratio instead of
      // being stretched to the square box.
      style={{ objectFit: "contain", flexShrink: 0 }}
      onError={() => setFailed(true)}
    />
  );
}
