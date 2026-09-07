"use client";

import { useEffect, useRef, useState } from "react";

export type SelectOption = { value: string; label: string; disabled?: boolean };

/**
 * Themed replacement for a plain `<select className="inp">`. A native
 * select's dropdown *list* is drawn by the OS/browser (Chrome's system
 * dark/light list style, unstyleable Windows combobox, …) no matter how the
 * closed control itself is skinned, so it never matches the app's gold/
 * ivory theme once opened. This renders the same `.inp`-sized trigger but
 * opens the option list in the app's own popover panel (the same
 * `.gs-results` styling as SearchableSelect/GlobalSearch) instead.
 */
export function Select({
  options,
  value,
  onChange,
  placeholder = "Select…",
  disabled,
}: {
  options: SelectOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("click", onDocClick);
    return () => document.removeEventListener("click", onDocClick);
  }, []);

  const selected = options.find((o) => o.value === value);

  return (
    <div className="dp" ref={boxRef}>
      <button
        type="button"
        className="inp dp-trigger"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
      >
        <span style={{ color: selected ? "var(--nav)" : "var(--muted)" }}>
          {selected ? selected.label : placeholder}
        </span>
        <svg className="sel-chevron" viewBox="0 0 10 6" fill="none">
          <path d="M1 1l4 4 4-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && (
        <div className="gs-results open" style={{ position: "absolute", top: "calc(100% + 6px)", left: 0, right: 0, zIndex: 60, maxHeight: 260, overflowY: "auto" }}>
          {options.length === 0 ? (
            <div className="gs-none">No options</div>
          ) : (
            options.map((o) => (
              <a
                key={o.value}
                href="#"
                className={`${o.value === value ? "sel" : ""}${o.disabled ? " disabled" : ""}`}
                aria-disabled={o.disabled}
                onClick={(e) => {
                  e.preventDefault();
                  if (o.disabled) return;
                  onChange(o.value);
                  setOpen(false);
                }}
              >
                <span className="tx"><b>{o.label}</b></span>
              </a>
            ))
          )}
        </div>
      )}
    </div>
  );
}
