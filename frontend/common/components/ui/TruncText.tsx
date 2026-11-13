"use client";

import type { CSSProperties, ReactNode } from "react";

/* Long free text (remarks / notes / additional information) in a table cell or card: one line with an
 * ellipsis at maxWidth; the full text shows on hover (native tooltip). */
export function TruncText({ text, maxWidth = 220, style, children }: { text?: string | null; maxWidth?: number | string; style?: CSSProperties; children?: ReactNode }) {
  const t = (text ?? "").toString();
  if (!t && !children) return <>—</>;
  return (
    <span
      title={t}
      style={{ display: "inline-block", maxWidth, verticalAlign: "bottom", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", ...style }}
    >
      {children ?? t}
    </span>
  );
}
