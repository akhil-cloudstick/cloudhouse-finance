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
  // Keyboard highlight, -1 = nothing highlighted (matches SearchableSelect's
  // own convention) — this trigger used to be entirely mouse-only: no way
  // to open/move through/confirm an option from the keyboard at all beyond
  // a focused button's native Enter/Space just toggling `open`.
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const boxRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  // Captures `open` at mousedown time (before focus/click fire) — see the
  // trigger's onMouseDown/onClick below for why a plain click-to-toggle
  // doesn't work here.
  const openBeforeMouseDownRef = useRef(false);
  // Viewport-coords panel position, same technique as DatePicker.tsx's
  // panelPos: `position:fixed` (not the plain absolute .gs-results default)
  // so opening this dropdown inside a scrollable container — e.g.
  // SplitPaymentInput's own payment-line list, capped and scrolled once it
  // grows past a few rows — can't add to that ancestor's scrollable overflow
  // or get clipped by its overflow:hidden/auto.
  const [panelPos, setPanelPos] = useState<{ top: number; left: number; width: number } | null>(null);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("click", onDocClick);
    return () => document.removeEventListener("click", onDocClick);
  }, []);

  useEffect(() => {
    if (!open) return;
    function updatePos() {
      const el = boxRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      setPanelPos({ top: r.bottom + 6, left: r.left, width: r.width });
    }
    updatePos();
    window.addEventListener("scroll", updatePos, true);
    window.addEventListener("resize", updatePos);
    return () => {
      window.removeEventListener("scroll", updatePos, true);
      window.removeEventListener("resize", updatePos);
    };
  }, [open]);

  const selected = options.find((o) => o.value === value);

  function pick(index: number) {
    const o = options[index];
    if (!o || o.disabled) return;
    onChange(o.value);
    setOpen(false);
  }

  function onTriggerKeyDown(e: React.KeyboardEvent<HTMLButtonElement>) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      // Stops this from ALSO reaching an ancestor's own Enter/keydown
      // handler (Modal.tsx's onModalKeyDown, a page-level
      // makeEnterToSubmitHandler) — see SearchableSelect's identical fix.
      e.stopPropagation();
      if (!open) {
        setOpen(true);
        setHighlightedIndex(e.key === "ArrowDown" ? 0 : options.length - 1);
        return;
      }
      const dir = e.key === "ArrowDown" ? 1 : -1;
      const next = (highlightedIndex + dir + options.length) % options.length;
      setHighlightedIndex(next);
      listRef.current?.children[next]?.scrollIntoView({ block: "nearest" });
      return;
    }
    if (e.key === "Enter") {
      if (!open) {
        // Already closed (just picked something, or never opened) — a
        // native "Enter activates the focused button" would fire onClick
        // below and reopen it right back up via its own `!open` branch,
        // undoing the close and leaving the user stuck re-opening the
        // same dropdown forever instead of ever moving on. preventDefault
        // stops that native click; deliberately NOT stopPropagation,
        // though — the whole point is letting this same Enter keep
        // bubbling up to the outer Enter-to-next-field handler
        // (enterToSubmit.ts), the same way it already continues past a
        // plain input.
        e.preventDefault();
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      if (highlightedIndex >= 0) pick(highlightedIndex);
      else setOpen(false);
      return;
    }
    if (e.key === "Escape" && open) {
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
    }
  }

  return (
    <div className="dp" ref={boxRef}>
      <button
        type="button"
        className="inp dp-trigger"
        disabled={disabled}
        // Only an element with an explicit `tabindex` attribute (not just
        // natively focusable, which every button already is) matches
        // enterToSubmit.ts's own Enter-to-next-field selector — without
        // this, the Enter chain used to skip straight over this whole
        // field, jumping from the input before it to the one after,
        // without ever landing here at all.
        tabIndex={0}
        // Marks this as a pass-through "waypoint" for enterToSubmit.ts —
        // safe (unlike a plain action button) because picking an option
        // always closes the dropdown on its own (onTriggerKeyDown's Enter
        // case below), so there's no way to get stuck re-triggering it.
        data-enter-waypoint="true"
        // A plain click-to-toggle doesn't work once focus also opens this
        // (below): for a not-yet-focused trigger, the native event order is
        // mousedown -> focus -> mouseup -> click, so onFocus has ALREADY
        // opened it by the time onClick fires — toggling there again would
        // immediately close what focus just opened. Capturing `open` at
        // mousedown (before that focus-triggered open happens) is what
        // lets onClick tell "this click also just focused it" (do nothing,
        // it's already open) apart from "it was already open/focused and
        // this is a deliberate second click" (actually close it).
        onMouseDown={() => { openBeforeMouseDownRef.current = open; }}
        onClick={() => {
          if (openBeforeMouseDownRef.current) {
            setOpen(false);
            return;
          }
          if (!open) {
            const currentIdx = options.findIndex((o) => o.value === value);
            setHighlightedIndex(currentIdx >= 0 ? currentIdx : 0);
            setOpen(true);
          }
        }}
        // Opens on focus, same as SearchableSelect's own onFocus — without
        // this, merely tabbing into the field did nothing until the user
        // pressed an extra Arrow/Enter/click first just to open it.
        onFocus={() => {
          if (open) return;
          const currentIdx = options.findIndex((o) => o.value === value);
          setHighlightedIndex(currentIdx >= 0 ? currentIdx : 0);
          setOpen(true);
        }}
        onKeyDown={onTriggerKeyDown}
        // Closes the dropdown once focus actually leaves the trigger —
        // same reasoning/guard as SearchableSelect's own onBlur: previously
        // only a document-level click outside closed this, so tabbing (or
        // Enter-to-next-field moving focus programmatically) past it left
        // it open, floating over whatever field focus moved to next.
        onBlur={(e) => {
          if (listRef.current?.contains(e.relatedTarget as Node)) return;
          setOpen(false);
        }}
      >
        <span style={{ color: selected ? "var(--nav)" : "var(--muted)" }}>
          {selected ? selected.label : placeholder}
        </span>
        <svg
          className="sel-chevron"
          viewBox="0 0 10 6"
          fill="none"
          style={{ transform: open ? "rotate(180deg)" : "none", transition: "transform .15s ease" }}
        >
          <path d="M1 1l4 4 4-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && panelPos && (
        <div ref={listRef} className="gs-results open" style={{ position: "fixed", top: panelPos.top, left: panelPos.left, width: panelPos.width, zIndex: 60, maxHeight: 260, overflowY: "auto" }}>
          {options.length === 0 ? (
            <div className="gs-none">No options</div>
          ) : (
            options.map((o, i) => (
              <a
                key={o.value}
                href="#"
                // Not a real Tab stop — see SearchableSelect's identical
                // tabIndex={-1} fix for why (Tab must move straight to the
                // next field, not step through this open list first).
                tabIndex={-1}
                className={`${i === highlightedIndex ? "sel" : o.value === value ? "sel" : ""}${o.disabled ? " disabled" : ""}`}
                aria-disabled={o.disabled}
                onMouseEnter={() => setHighlightedIndex(i)}
                onClick={(e) => {
                  e.preventDefault();
                  pick(i);
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
