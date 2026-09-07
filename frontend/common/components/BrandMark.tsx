/* Inline-SVG rendering of the CTFI circular seal.
 *
 * The raster at BRAND.markSrc is the authoritative artwork and is what the
 * sidebar and login use. This component exists for the places a JPEG/PNG is
 * the wrong tool: it stays crisp at 16px, inherits `currentColor` so it can
 * sit on the navy sidebar or a white document, and — because it is markup
 * rather than a file — it renders in a print window with no asset request.
 * It is also the fallback when the raster is missing, so a fresh checkout
 * never shows a broken-image icon in the brand slot.
 *
 * Deliberately a simplification, not a trace: concentric rules, the wrapped
 * name on a circular path, and the monogram. Use the raster where fidelity
 * to the real seal matters.
 */

// useId (not a counter or Math.random) because these ids are baked into the
// SSR'd markup: a value that differs between the server and client render
// trips a hydration mismatch.
"use client";

import { useId } from "react";

type Props = {
  /** Rendered box, px. The whole mark scales from this. */
  size?: number;
  /** Drop the ring text below ~40px, where it turns to mud. */
  showText?: boolean;
  className?: string;
  title?: string;
};

export default function BrandMark({ size = 40, showText = true, className, title }: Props) {
  // Unique per instance: two marks on one page would otherwise share the
  // textPath ids and the second would render its text along the first's arc.
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");

  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 200 200"
      role={title ? "img" : "presentation"}
      aria-label={title}
      aria-hidden={title ? undefined : true}
    >
      <defs>
        {/* Text baselines. r=80 sits inside the outer rule; the lower arc is
            drawn right-to-left so its glyphs read the right way up. */}
        <path id={`${uid}-top`} d="M 100 100 m -80 0 a 80 80 0 0 1 160 0" fill="none" />
        <path id={`${uid}-bot`} d="M 100 100 m 80 0 a 80 80 0 0 1 -160 0" fill="none" />
      </defs>

      {/* Outer rule, then the thin inner pair that frames the ring text */}
      <circle cx="100" cy="100" r="96" fill="none" stroke="currentColor" strokeWidth="7" />
      <circle cx="100" cy="100" r="86" fill="none" stroke="currentColor" strokeWidth="2" />
      <circle cx="100" cy="100" r="64" fill="none" stroke="currentColor" strokeWidth="2" />

      {showText && (
        <g fill="currentColor" fontFamily="var(--font-display), Montserrat, sans-serif" fontWeight="700">
          <text fontSize="17" letterSpacing="1.6">
            <textPath href={`#${uid}-top`} startOffset="50%" textAnchor="middle">
              CHITTILAPILLY THOMMANA
            </textPath>
          </text>
          <text fontSize="14" letterSpacing="1.4">
            <textPath href={`#${uid}-bot`} startOffset="50%" textAnchor="middle">
              FINANCIERS &amp; INVESTMENTS
            </textPath>
          </text>
        </g>
      )}

      {/* Monogram disc. The counter-form is punched out with the page colour
          via a mask so the disc reads correctly on any background. */}
      <mask id={`${uid}-m`}>
        <rect width="200" height="200" fill="black" />
        <circle cx="100" cy="100" r="56" fill="white" />
        <path d="M100 60a40 40 0 1 0 28 68l-11-11a26 26 0 1 1-17-44Z" fill="black" />
        <text
          x="100"
          y="118"
          textAnchor="middle"
          fill="black"
          fontSize="52"
          fontStyle="italic"
          fontWeight="700"
          fontFamily="var(--font-display), Georgia, serif"
        >
          tfi
        </text>
      </mask>
      <circle cx="100" cy="100" r="56" fill="currentColor" mask={`url(#${uid}-m)`} />
    </svg>
  );
}
