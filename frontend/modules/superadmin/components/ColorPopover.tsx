"use client";

import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";

/* One picker window: shade square, hue bar, hex field and swatches — no
 * second system colour dialog. */
type Hsv = { h: number; s: number; v: number };
function hexToHsv(hex: string): Hsv {
  const n = parseInt(hex.slice(1), 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const mx = Math.max(r, g, b);
  const d = mx - Math.min(r, g, b);
  let h = 0;
  if (d) h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { h: (h * 60 + 360) % 360, s: mx ? d / mx : 0, v: mx };
}
function hsvToHex({ h, s, v }: Hsv): string {
  const f = (k: number) => {
    const x = (k + h / 60) % 6;
    return v - v * s * Math.max(0, Math.min(x, 4 - x, 1));
  };
  return (
    "#" +
    [f(5), f(3), f(1)]
      .map((c) => Math.round(Math.min(1, Math.max(0, c)) * 255).toString(16).padStart(2, "0"))
      .join("")
  );
}
type ColorPopoverProps = {
  title: string;
  autoLabel: string | null;
  isAuto: boolean;
  value: string;
  swatches: string[];
  style: CSSProperties;
  onPick: (hex: string) => void;
  onAuto: () => void;
  onClose: () => void;
};

export function ColorPopover({
  title,
  autoLabel,
  isAuto,
  value,
  swatches,
  style,
  onPick,
  onAuto,
  onClose,
}: ColorPopoverProps) {
  const ref = useRef<HTMLDivElement>(null);
  // HSV is kept as its own state while dragging, so the hue does not jump
  // when the shade reaches grey (where hex alone has no hue).
  const [hsv, setHsv] = useState<Hsv>(() => hexToHsv(value));
  const [hexText, setHexText] = useState(value.slice(1).toUpperCase());
  const [hexError, setHexError] = useState(false);
  const hexFocused = useRef(false);
  const current = hsvToHex(hsv);

  // Follow outside changes (Auto, a swatch, undo) without fighting a drag.
  const lastSent = useRef(value);
  useEffect(() => {
    if (value.toLowerCase() === lastSent.current.toLowerCase()) return;
    lastSent.current = value;
    setHsv(hexToHsv(value));
    if (!hexFocused.current) setHexText(value.slice(1).toUpperCase());
  }, [value]);

  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      const t = e.target as HTMLElement;
      if (ref.current && !ref.current.contains(t) && !t.closest?.(".bs-tile, .bs-c-vals")) onClose();
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  function send(next: Hsv) {
    setHsv(next);
    const hex = hsvToHex(next);
    lastSent.current = hex;
    if (!hexFocused.current) setHexText(hex.slice(1).toUpperCase());
    onPick(hex);
  }

  /* Called from a pointerdown: follows the pointer until it is released. */
  function track(e: ReactPointerEvent<HTMLDivElement>, fn: (x: number, y: number) => Hsv) {
    e.preventDefault();
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    const go = (ev: { clientX: number; clientY: number }) => {
      const r = el.getBoundingClientRect();
      const x = Math.min(1, Math.max(0, (ev.clientX - r.left) / r.width));
      const y = Math.min(1, Math.max(0, (ev.clientY - r.top) / r.height));
      send(fn(x, y));
    };
    go(e);
    const up = () => {
      el.removeEventListener("pointermove", go);
      el.removeEventListener("pointerup", up);
    };
    el.addEventListener("pointermove", go);
    el.addEventListener("pointerup", up);
  }

  return (
    <div className="bs-cp" ref={ref} style={style} role="dialog" aria-label={title}>
      <div className="bs-cp-h">
        <span>{title}</span>
        <button type="button" className="bs-x" aria-label="Close" onClick={onClose}>
          ×
        </button>
      </div>
      <div
        className="bs-sv"
        aria-label="Shade"
        style={{
          background: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, transparent), hsl(${hsv.h} 100% 50%)`,
        }}
        onPointerDown={(e) => track(e, (x, y) => ({ ...hsv, s: x, v: 1 - y }))}
      >
        <span className="bs-cp-thumb" style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%`, background: current }} />
      </div>
      <div className="bs-hue" aria-label="Hue" onPointerDown={(e) => track(e, (x) => ({ ...hsv, h: x * 359.9 }))}>
        <span className="bs-cp-thumb" style={{ left: `${(hsv.h / 360) * 100}%`, background: `hsl(${hsv.h} 100% 50%)` }} />
      </div>
      <label className={`bs-hexrow${hexError ? " err" : ""}`}>
        <i className="bs-chip" style={{ background: current }} />
        <span>#</span>
        <input
          value={hexText}
          maxLength={7}
          spellCheck={false}
          aria-label="Hex code"
          onFocus={() => (hexFocused.current = true)}
          onBlur={() => {
            hexFocused.current = false;
            setHexText(current.slice(1).toUpperCase());
            setHexError(false);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              onClose();
            }
          }}
          onChange={(e) => {
            setHexText(e.target.value);
            let v = e.target.value.trim().replace(/^#/, "");
            if (/^[0-9a-f]{3}$/i.test(v)) v = [...v].map((c) => c + c).join("");
            const ok = /^[0-9a-f]{6}$/i.test(v);
            setHexError(!ok && v.length >= 6);
            if (ok) send(hexToHsv("#" + v.toLowerCase()));
          }}
        />
      </label>
      <div className="bs-sw">
        {swatches.map((c) => (
          <button key={c} type="button" style={{ background: c }} title={c.toUpperCase()} onClick={() => send(hexToHsv(c))} />
        ))}
      </div>
      {autoLabel && (
        <button type="button" className="bs-auto" aria-pressed={isAuto} onClick={onAuto}>
          {autoLabel}
        </button>
      )}
    </div>
  );
}
