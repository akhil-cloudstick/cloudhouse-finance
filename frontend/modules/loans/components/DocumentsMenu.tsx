"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "@/common/components/Icon";

/* One row of the "Documents" dropdown below — either a click action
 * (onClick, e.g. printing something in-browser) or a plain link (href,
 * e.g. an already-signed bond opened in a new tab). */
type DocMenuItem = {
  icon: string;
  label: string;
  onClick?: () => void;
  href?: string;
  disabled?: boolean;
};
type DocumentsMenuProps = { items: DocMenuItem[] };

/* Groups the print/eSign actions that used to be five separate
 * same-width-but-still-crowded buttons in the page header (Print Label,
 * Print Slip, Statement, Print Bond, Signed Bond/eSign) into a single
 * "Documents ▾" trigger — same popover shell as SearchableSelect/
 * GlobalSearch (`.gs-results`), just with click actions instead of a
 * selectable value. */
function DocumentsMenu({ items }: DocumentsMenuProps) {
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("click", onDocClick);
    return () => document.removeEventListener("click", onDocClick);
  }, []);

  return (
    <div className="dp" ref={boxRef} style={{ position: "relative", width: 165, flex: "0 0 auto" }}>
      <button type="button" className="btn ghost sm" style={{ width: 165, overflow: "hidden" }} onClick={() => setOpen((o) => !o)}>
        <Icon name="doc" /> <span className="doc-action-tx">Documents</span>
        <svg className="sel-chevron" viewBox="0 0 10 6" fill="none" style={{ width: 12, height: 12, flexShrink: 0, marginLeft: 4 }}>
          <path d="M1 1l4 4 4-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && (
        <div className="gs-results open" style={{ position: "absolute", top: "calc(100% + 6px)", left: 0, right: 0, width: 165, zIndex: 60 }}>
          {items.map((item, i) =>
            item.href ? (
              <a key={i} href={item.href} target="_blank" rel="noopener noreferrer" onClick={() => setOpen(false)}>
                <span className="ic"><Icon name={item.icon} /></span>
                <span className="tx"><b className="doc-menu-tx">{item.label}</b></span>
              </a>
            ) : (
              <a
                key={i}
                href="#"
                className={item.disabled ? "disabled" : ""}
                onClick={(e) => {
                  e.preventDefault();
                  if (item.disabled) return;
                  item.onClick?.();
                  setOpen(false);
                }}
              >
                <span className="ic"><Icon name={item.icon} /></span>
                <span className="tx"><b className="doc-menu-tx">{item.label}</b></span>
              </a>
            )
          )}
        </div>
      )}
    </div>
  );
}
