"use client";

import { useEffect } from "react";

/* Shrinks the font of any KPI figure (`.kpi .v`) or breakdown row
 * (`.kpi-fit`) whose text is wider than its card, so a large amount like
 * "₹1,80,751.00" stays fully visible instead of being clipped by the card's
 * overflow:hidden. Text that already fits is left at its normal size, and the
 * size is recomputed from scratch each pass, so it grows back when the number
 * gets shorter or the card gets wider.
 *
 * One observer mounted once in the app shell rather than a wrapper component on
 * every card: KPI tiles are rendered by seven different pages. */
const SELECTOR = ".kpi .v, .kpi-fit";
const MIN_SCALE = 0.55;

function fit(el: HTMLElement) {
  // Remember what the element had inline (usually nothing) so resetting does
  // not wipe a size a page set on purpose.
  if (el.dataset.fitOrig === undefined) el.dataset.fitOrig = el.style.fontSize;
  el.style.fontSize = el.dataset.fitOrig;
  const avail = el.clientWidth;
  if (!avail || el.scrollWidth <= avail + 0.5) return;
  const base = parseFloat(getComputedStyle(el).fontSize);
  if (!base) return;
  const scale = Math.max((avail / el.scrollWidth) * 0.97, MIN_SCALE);
  el.style.fontSize = `${(base * scale).toFixed(2)}px`;
}

export function FitTextObserver() {
  useEffect(() => {
    let frame = 0;
    const run = () => {
      frame = 0;
      document.querySelectorAll<HTMLElement>(SELECTOR).forEach(fit);
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(run);
    };
    // Only content and structure changes are observed — fit() itself writes the
    // style attribute, which must not retrigger it.
    const mo = new MutationObserver(schedule);
    mo.observe(document.body, { childList: true, subtree: true, characterData: true });
    window.addEventListener("resize", schedule);
    void document.fonts?.ready.then(schedule);
    schedule();
    return () => {
      mo.disconnect();
      window.removeEventListener("resize", schedule);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);
  return null;
}
