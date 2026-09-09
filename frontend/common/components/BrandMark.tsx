/* Inline-SVG rendering of the CloudHouse mark: the cloud with the house "h"
 * cut out of it.
 *
 * The raster at BRAND.markSrc is the authoritative artwork and is what the
 * sidebar and login use. This component exists for the places a PNG is the
 * wrong tool: it stays crisp at 16px, inherits `currentColor` so it can sit
 * on the violet sidebar or a white document, and — because it is markup
 * rather than a file — it renders in a print window with no asset request.
 * It is also the fallback when the raster is missing, so a fresh checkout
 * never shows a broken-image icon in the brand slot.
 *
 * Deliberately a reconstruction, not a trace: overlapping lobes for the cloud
 * and a stroked geometric "h". Use the raster where fidelity to the real logo
 * matters.
 */

// useId (not a counter or Math.random) because these ids are baked into the
// SSR'd markup: a value that differs between the server and client render
// trips a hydration mismatch.
"use client";

import { useId } from "react";

type Props = {
  /** Rendered box, px. The whole mark scales from this. */
  size?: number;
  /** Fill with the logo's violet → magenta → orange sweep instead of
   *  `currentColor`. Off by default: the mono form is what reads on the
   *  sidebar and in print. */
  gradient?: boolean;
  className?: string;
  title?: string;
};

export default function BrandMark({ size = 40, gradient, className, title }: Props) {
  // Unique per instance: two marks on one page would otherwise share the
  // mask and gradient ids, and the second would reference the first's.
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const fill = gradient ? `url(#${uid}-g)` : "currentColor";

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
        {gradient && (
          <linearGradient id={`${uid}-g`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#6855bc" />
            <stop offset="52%" stopColor="#d91786" />
            <stop offset="100%" stopColor="#f49e35" />
          </linearGradient>
        )}

        {/* The cloud is painted through this mask so the "h" is a hole in it
            rather than a white shape sitting on top — that way the mark works
            on any background, which is the whole point of the SVG form. */}
        <mask id={`${uid}-m`}>
          {/* Four lobes, not three: with three the silhouette dips between
              the left and right circles and the "h" legs cut two notches out
              of the base instead of ending flush against it. */}
          <g fill="white">
            <circle cx="110" cy="76" r="50" />
            <circle cx="78" cy="98" r="64" />
            <circle cx="114" cy="110" r="52" />
            <circle cx="148" cy="114" r="48" />
          </g>
          <g
            fill="none"
            stroke="black"
            strokeWidth="17"
            strokeLinecap="butt"
            strokeLinejoin="miter"
          >
            <path d="M95 52 L95 156" />
            <path d="M95 101 C95 79 140 79 140 105 L140 156" />
          </g>
        </mask>
      </defs>

      <rect width="200" height="200" fill={fill} mask={`url(#${uid}-m)`} />
    </svg>
  );
}
