"use client";

import { useEffect, useId, useRef, useState } from "react";

// Replaces native <select> because its OS-drawn popup list can't be themed (no bg/radius/brand colour/font).
export type SuperAdminSelectOption = {
  value: string;
  label: string;
};

type Props = {
  value: string;
  onChange: (value: string) => void;
  options: SuperAdminSelectOption[];
  // Rendered when the value matches no option, rather than silently falling back to the first (misreporting state).
  placeholder?: string;
  disabled?: boolean;
  ariaLabel?: string;
};

export function SuperAdminSelect({ value, onChange, options, placeholder = "Select…", disabled, ariaLabel }: Props) {
  const [open, setOpen] = useState(false);
  // Keyboard-highlighted row, not the selection — arrowing must not commit a value until Enter. -1 = none yet.
  const [activeIdx, setActiveIdx] = useState(-1);
  // Opens upward when there isn't room below, since these live inside a scrolling modal body.
  const [dropUp, setDropUp] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const listId = useId();

  const selectedIdx = options.findIndex((o) => o.value === value);
  const selected = selectedIdx >= 0 ? options[selectedIdx] : null;

  // Listens on the document (not a backdrop) so it also closes on a click on another control in the same modal.
  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [open]);

  useEffect(() => {
    if (!open || activeIdx < 0) return;
    const node = listRef.current?.children[activeIdx] as HTMLElement | undefined;
    node?.scrollIntoView({ block: "nearest" });
  }, [open, activeIdx]);

  function openList() {
    if (disabled) return;
    // LIST_MAX must stay in step with .sa-select-list's max-height in superadmin.css.
    const LIST_MAX = 240;
    const rect = rootRef.current?.getBoundingClientRect();
    if (rect) {
      const below = window.innerHeight - rect.bottom;
      // Only flip when there is genuinely more room above, else a cramped viewport moves it somewhere equally clipped.
      setDropUp(below < LIST_MAX && rect.top > below);
    }
    setActiveIdx(selectedIdx >= 0 ? selectedIdx : 0);
    setOpen(true);
  }

  function commit(idx: number) {
    const option = options[idx];
    if (!option) return;
    onChange(option.value);
    setOpen(false);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (disabled) return;

    if (!open) {
      // Enter deliberately excluded: this lives inside a <form>, and opening on Enter could submit it instead.
      if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === " ") {
        e.preventDefault();
        openList();
      }
      return;
    }

    switch (e.key) {
      case "Escape":
        e.preventDefault();
        setOpen(false);
        break;
      case "Enter":
      case " ":
        e.preventDefault();
        commit(activeIdx);
        break;
      case "ArrowDown":
        e.preventDefault();
        setActiveIdx((i) => Math.min(i + 1, options.length - 1));
        break;
      case "ArrowUp":
        e.preventDefault();
        setActiveIdx((i) => Math.max(i - 1, 0));
        break;
      case "Home":
        e.preventDefault();
        setActiveIdx(0);
        break;
      case "End":
        e.preventDefault();
        setActiveIdx(options.length - 1);
        break;
      case "Tab":
        setOpen(false);
        break;
    }
  }

  return (
    <div className={`sa-select${open ? " open" : ""}`} ref={rootRef}>
      <button
        type="button"
        className="sa-select-btn"
        disabled={disabled}
        onClick={() => (open ? setOpen(false) : openList())}
        onKeyDown={onKeyDown}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-label={ariaLabel}
      >
        <span className={selected ? "" : "sa-select-placeholder"}>{selected ? selected.label : placeholder}</span>
        <svg
          className="sa-select-caret"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>

      {open && (
        <ul className={`sa-select-list${dropUp ? " up" : ""}`} role="listbox" id={listId} ref={listRef} tabIndex={-1}>
          {options.map((o, i) => (
            <li
              key={o.value}
              role="option"
              aria-selected={o.value === value}
              className={`sa-select-option${i === activeIdx ? " active" : ""}${
                o.value === value ? " selected" : ""
              }`}
              // mouseDown, not click: the document listener above closes the list on mousedown first.
              onMouseDown={(e) => {
                e.preventDefault();
                commit(i);
              }}
              onMouseEnter={() => setActiveIdx(i)}
            >
              {o.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
