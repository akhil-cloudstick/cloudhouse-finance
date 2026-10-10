"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";

type Tip = { text: string; x: number; y: number; below: boolean };

const SHOW_DELAY = 250;
const EDGE = 8;

/**
 * Replaces the browser's native `title` tooltip app-wide with the app's own
 * minimal dark tooltip, so every existing `title="…"` picks up the new look
 * without touching its call site. While an element is hovered its `title`
 * is lifted off (which stops the native one) and put back on leave.
 */
export function TooltipLayer() {
  const [tip, setTip] = useState<Tip | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let target: HTMLElement | null = null;
    let saved = "";
    let timer: ReturnType<typeof setTimeout> | undefined;

    function release() {
      clearTimeout(timer);
      if (target && !target.hasAttribute("title")) target.setAttribute("title", saved);
      target = null;
      setTip(null);
    }

    function show(el: HTMLElement) {
      if (!el.isConnected) return release();
      const r = el.getBoundingClientRect();
      const below = r.top < 44;
      setTip({ text: saved, x: r.left + r.width / 2, y: below ? r.bottom : r.top, below });
    }

    function onOver(e: MouseEvent) {
      const node = e.target as Element;
      const el = node.closest?.<HTMLElement>("[title]") ?? null;
      // Still inside the hovered element (whose title is lifted off), and
      // not onto a nested element with a tooltip of its own.
      if (target && target.contains(node) && (!el || !target.contains(el))) return;
      release();
      const text = el?.getAttribute("title")?.trim();
      if (!el || !text) return;
      target = el;
      saved = el.getAttribute("title") ?? "";
      el.removeAttribute("title");
      timer = setTimeout(() => show(el), SHOW_DELAY);
    }

    function onOut(e: MouseEvent) {
      if (!target) return;
      const to = e.relatedTarget as Node | null;
      if (!to || !target.contains(to)) release();
    }

    document.addEventListener("mouseover", onOver);
    document.addEventListener("mouseout", onOut);
    window.addEventListener("scroll", release, true);
    window.addEventListener("keydown", release);
    return () => {
      release();
      document.removeEventListener("mouseover", onOver);
      document.removeEventListener("mouseout", onOut);
      window.removeEventListener("scroll", release, true);
      window.removeEventListener("keydown", release);
    };
  }, []);

  // Keep the tooltip inside the viewport horizontally.
  useLayoutEffect(() => {
    const box = boxRef.current;
    if (!box || !tip) return;
    const w = box.offsetWidth;
    const left = Math.min(Math.max(tip.x - w / 2, EDGE), window.innerWidth - w - EDGE);
    box.style.left = `${left}px`;
  }, [tip]);

  if (!tip) return null;
  return (
    <div
      ref={boxRef}
      role="tooltip"
      className={`tip-layer${tip.below ? " below" : ""}`}
      style={{ top: tip.below ? tip.y + 6 : tip.y - 6 }}
    >
      {tip.text}
    </div>
  );
}
