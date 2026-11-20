"use client";

import { useState, type CSSProperties } from "react";

import { useBranding } from "@/common/providers/BrandingProvider";

import { DEFAULT_LOGO_DISPLAY, DEFAULT_LOGO_SCALE, LOGO_SCALES } from "@/common/config/theme";

/* The brand seal, as used by the sidebar, the three auth pages and the
 * DigiLocker callback.
 *
 * The artwork is rendered exactly as supplied: no crop, no background, no
 * border, no rounding. Earlier revisions of this component cropped to the
 * monogram and sat it on a white disc to raise contrast against the violet
 * sidebar; that was rejected — the logo is shown as-is by instruction.
 *
 * The one thing this still owns is the fallback, and it is deliberately NOT
 * the platform mark: a business must only ever see its own brand, so a
 * missing or broken logo degrades to that business's own initial, and to a
 * neutral placeholder while even its name is still unknown. The five call
 * sites used to hardcode an <img> at their own copy of the platform logo
 * path, which is how the vendor's mark ended up flashing on every tenant's
 * screen on a cold load.
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
  const { logoUrl, legalName, name, loaded, cached, logoScale, logoDisplay, headerLayout } = useBranding();
  /* No platform fallback, by product rule: a business must never be shown a
   * brand that is not its own — not another tenant's and not the vendor's,
   * not even for the frames before its branding arrives. So an absent logo
   * renders either the business's own initial (once its name is known) or a
   * neutral placeholder block, never CloudHouse's mark. */
  const src = logoUrl;
  const alt = legalName || name || "";

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
  /* A logo the vendor marked WIDE (superadmin Branding step) is a wordmark:
   * fitted into this square slot it shrinks to a thin strip, which is how it
   * looked on the sign-in page. The fixed slots (sign-in, forgot/reset
   * password — the non-scalable ones) give it a wide box instead: about twice
   * the slot's width, never taller than the logo needs, never wider than its
   * container. The sidebar slot is unaffected — an arranged header draws its
   * own logo at the width the vendor dragged it to. */
  const wide = !scalable && headerLayout?.logoShape === "wide" && !!src;
  const wideStyle: CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    width: Math.round(size * 2.1),
    maxWidth: "100%",
    flexShrink: 0,
    boxSizing: "border-box",
    ...(display === "transparent"
      ? {}
      : {
          borderRadius: 12,
          background: display === "dark-pad" ? "rgba(0,0,0,0.72)" : "#fff",
          padding: Math.round(size * 0.08),
        }),
  };
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

  /* Three states share one slot, all of them tenant-safe:
   *   - a real logo (below),
   *   - the business's initial, when it has no logo or the file 404s,
   *   - a neutral pulsing block, when even the name is not known yet.
   * The last only happens on a browser that has never opened this business;
   * every later load replays the name and logo from cache before first paint
   * (see BrandingProvider's initialBranding), so it is not a visible state
   * for a returning user. */
  if (!src || failed) {
    const initial = alt.trim().charAt(0).toUpperCase();
    const settled = loaded || cached;
    return (
      <span
        style={{
          ...wrapperStyle,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          borderRadius: "20%",
          background: settled && initial ? "var(--brand)" : "var(--brand-pale, rgba(0,0,0,.06))",
          color: "#fff",
          fontFamily: "var(--font-display), var(--font-sans), sans-serif",
          fontWeight: 700,
          fontSize: Math.round(effectiveSize * 0.46),
          lineHeight: 1,
          overflow: "hidden",
          animation: settled ? undefined : "brandLogoPulse 1.1s ease-in-out infinite",
        }}
        className={className}
        aria-label={settled && initial ? alt : undefined}
        aria-hidden={settled && initial ? undefined : true}
        role={settled && initial ? "img" : undefined}
      >
        {settled && initial ? initial : null}
        {!settled && (
          <style>{"@keyframes brandLogoPulse{0%,100%{opacity:.45}50%{opacity:.9}}"}</style>
        )}
      </span>
    );
  }

  if (wide && !failed) {
    return (
      <span style={wideStyle} className={className}>
        <img
          src={src}
          alt={alt}
          style={{ width: "100%", height: "auto", maxHeight: Math.round(size * 0.75), objectFit: "contain", objectPosition: "left center" }}
          onError={() => setFailedSrc(src)}
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
