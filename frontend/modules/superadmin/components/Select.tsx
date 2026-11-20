"use client";

import { useEffect, useId, useRef, useState } from "react";

/* A themed dropdown, replacing the native <select> everywhere in this console.
 *
 * WHY this exists at all, given a <select> is smaller, accessible for free and
 * already carried the console's border, radius and custom caret: none of that
 * reaches the part people actually look at. A native select's POPUP LIST is
 * drawn by the operating system, outside the page, and CSS cannot touch it —
 * no background, no radius, no brand colour, no font. So every dropdown in the
 * wizard looked correct until it was opened, and then showed a raw Windows
 * list in the middle of a themed modal. Styling `option` does not fix it
 * either; support is partial and platform-dependent.
 *
 * The trade is real and worth stating: this component owns keyboard support,
 * focus and outside-click behaviour that the browser used to provide. Those
 * are implemented below rather than assumed — if a dropdown here is ever less
 * usable by keyboard than a native one, that is a bug in this file, not an
 * acceptable cost of the styling. */

export type SelectOption = {
  value: string;
  label: string;
};

type Props = {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  /* Rendered when the value matches no option — a business on a policy that
     has since been retired, say. Shown rather than falling back silently to
     the first option, which would misreport what is stored. */
  placeholder?: string;
  disabled?: boolean;
  /* Labels the button for screen readers where the visible <label> is not
     already associated with it. */
  ariaLabel?: string;
};

export function Select({ value, onChange, options, placeholder = "Select…", disabled, ariaLabel }: Props) {
  const [open, setOpen] = useState(false);
  /* The row the keyboard is on, which is NOT the selection: arrowing through
     the list must not commit a value until Enter. -1 means "nothing yet". */
  const [activeIdx, setActiveIdx] = useState(-1);
  /* Whether the list opens upward. These dropdowns live inside a modal body
     that scrolls, so one opened near the bottom of the wizard would otherwise
     be cut off at the modal's edge with no indication there was more. */
  const [dropUp, setDropUp] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const listId = useId();

  const selectedIdx = options.findIndex((o) => o.value === value);
  const selected = selectedIdx >= 0 ? options[selectedIdx] : null;

  /* Close on any click that is not inside this dropdown. Listening on the
     document (not a backdrop element) so it also closes when the click lands
     on another control in the same modal. */
  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [open]);

  /* Keep the active row in view when arrowing past the edge of a list that
     scrolls — without this the highlight moves invisibly. */
  useEffect(() => {
    if (!open || activeIdx < 0) return;
    const node = listRef.current?.children[activeIdx] as HTMLElement | undefined;
    node?.scrollIntoView({ block: "nearest" });
  }, [open, activeIdx]);

  function openList() {
    if (disabled) return;
    /* Decide the direction BEFORE painting, from the space actually left
       below the control. LIST_MAX must stay in step with .sa-select-list's
       max-height in superadmin.css. */
    const LIST_MAX = 240;
    const rect = rootRef.current?.getBoundingClientRect();
    if (rect) {
      const below = window.innerHeight - rect.bottom;
      /* Only flip when there is genuinely more room above — otherwise a
         cramped viewport would move the list somewhere equally clipped. */
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
      /* Enter is deliberately NOT in this list. The dropdown lives inside a
         <form>, and opening on Enter would swallow the keystroke that submits
         it — or, worse, submit the form on the way past. */
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
        /* Let focus leave, but do not leave a popup hanging over the field
           the user just moved to. */
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
              /* mouseDown, not click: the document listener above closes the
                 list on mousedown, so a click handler would never fire. */
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
