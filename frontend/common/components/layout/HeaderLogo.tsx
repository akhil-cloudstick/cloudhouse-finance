"use client";

import { useState } from "react";
import { type HeaderLayout } from "@/common/config/headerLayout";
import { logoBoxStyle } from "./BrandHeader";

type HeaderLogoProps = {
  layout: HeaderLayout;
  logoUrl: string;
  logoDisplay: string;
  alt: string;
};

export function HeaderLogo({
  layout,
  logoUrl,
  logoDisplay,
  alt,
}: HeaderLogoProps) {
  /* A logo that fails to load degrades to the business's own initial, never
   * to a broken image or another brand — the same rule as BrandLogo. Keyed on
   * src so a replaced logo gets a fresh attempt. */
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const failed = failedSrc === logoUrl;
  return (
    <span
      className="bh-logo"
      data-shape={layout.logoShape}
      data-backing={logoDisplay || "transparent"}
      style={logoBoxStyle(layout)}
    >
      {logoUrl && !failed ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={logoUrl} alt={alt} draggable={false} onError={() => setFailedSrc(logoUrl)} />
      ) : (
        <span className="bh-initial" role="img" aria-label={alt}>
          {alt.trim().charAt(0).toUpperCase()}
        </span>
      )}
    </span>
  );
}
