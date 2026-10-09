"use client";

import { Fragment, useState, type CSSProperties, type ReactNode } from "react";

import "@/product/styles/brand-header.css";
import {
  autoSubSize,
  autoTitleSize,
  normalizeSubtitle,
  type HeaderChild,
  type HeaderItem,
  type HeaderLayout,
} from "@/product/config/headerLayout";

/* The arranged sidebar header: the logo, title and subtitle placed in the rows
 * and columns a vendor set up in the superadmin console (see
 * product/config/headerLayout.ts for the model).
 *
 * Rendered by the app's Sidebar and, through `renderItem`, by the console's
 * Branding step, which wraps each item in its drag and resize handles. One
 * component, so the preview the vendor edits is the header the business gets.
 */

type Props = {
  layout: HeaderLayout;
  logoUrl: string;
  logoDisplay: string;
  title: string;
  subtitle: string;
  /** Alt text for the logo, and the source of the fallback initial. */
  logoAlt?: string;
  /** Draw items even when empty (the console shows placeholders to edit). */
  showEmpty?: boolean;
  /** Replaces how one item is drawn; receives the default element. */
  renderItem?: (item: HeaderItem, content: ReactNode) => ReactNode;
  className?: string;
  style?: CSSProperties;
};

/** Inline sizes for the logo box — custom properties, so CSS can still scale them. */
export function logoBoxStyle(layout: HeaderLayout): CSSProperties {
  return { "--bh-logo-w": `${layout.logoWidth}px` } as CSSProperties;
}

export function titleSizePx(layout: HeaderLayout, title: string): number {
  return layout.titleSize || autoTitleSize(title);
}

export function subSizePx(layout: HeaderLayout, subtitle: string): number {
  return layout.subSize || autoSubSize(subtitle);
}

export function titleStyle(layout: HeaderLayout, title: string): CSSProperties {
  return { "--bh-title": `${titleSizePx(layout, title)}px` } as CSSProperties;
}

export function subStyle(layout: HeaderLayout, subtitle: string): CSSProperties {
  return { "--bh-sub": `${subSizePx(layout, subtitle)}px` } as CSSProperties;
}

export function HeaderLogo({
  layout,
  logoUrl,
  logoDisplay,
  alt,
}: {
  layout: HeaderLayout;
  logoUrl: string;
  logoDisplay: string;
  alt: string;
}) {
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

export default function BrandHeader({
  layout,
  logoUrl,
  logoDisplay,
  title,
  subtitle,
  logoAlt = "",
  showEmpty = false,
  renderItem,
  className,
  style,
}: Props) {
  const sub = normalizeSubtitle(subtitle);

  function item(id: HeaderItem): ReactNode {
    let content: ReactNode = null;
    if (id === "logo") {
      if (!logoUrl && !showEmpty) return null;
      content = <HeaderLogo layout={layout} logoUrl={logoUrl} logoDisplay={logoDisplay} alt={logoAlt || title} />;
    } else if (id === "title") {
      if (!title.trim() && !showEmpty) return null;
      content = (
        <span className="bh-title" style={titleStyle(layout, title)}>
          {title}
        </span>
      );
    } else {
      if (!sub && !showEmpty) return null;
      content = (
        <span className="bh-sub" style={subStyle(layout, sub)}>
          {sub}
        </span>
      );
    }
    return renderItem ? renderItem(id, content) : content;
  }

  function node(c: HeaderChild, key: string): ReactNode {
    if (typeof c === "string") {
      const el = item(c);
      return el === null ? null : <Fragment key={c}>{el}</Fragment>;
    }
    const kids = c.children.map((k, i) => node(k, `${key}.${i}`)).filter((k) => k !== null);
    if (kids.length === 0) return null;
    return (
      <div key={key} className={`bh-n bh-${c.dir}`}>
        {kids}
      </div>
    );
  }

  return (
    <div
      className={`bh${className ? ` ${className}` : ""}`}
      data-align={layout.align}
      data-pad={layout.pad}
      style={style}
    >
      {node(layout.tree, "r")}
    </div>
  );
}

