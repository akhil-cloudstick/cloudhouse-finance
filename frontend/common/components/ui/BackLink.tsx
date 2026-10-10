"use client";

import type { MouseEvent } from "react";

type BackLinkProps = { href?: string; onClick: () => void; label?: string };

/* Minimal "‹ Back" control for the top of a detail/ledger page — a small
 * chevron and muted label that darkens on hover. Renders a real link when
 * `href` is given (so it copies and middle-clicks like any other link) and a
 * button otherwise. */
export function BackLink({ href, onClick, label = "Back" }: BackLinkProps) {
  const content = (
    <>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="m15 18-6-6 6-6" />
      </svg>
      <span>{label}</span>
    </>
  );
  if (href) {
    return (
      <a
        className="back-link"
        href={href}
        onClick={(e: MouseEvent) => {
          if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
          e.preventDefault();
          onClick();
        }}
      >
        {content}
      </a>
    );
  }
  return <button type="button" className="back-link" onClick={onClick}>{content}</button>;
}
