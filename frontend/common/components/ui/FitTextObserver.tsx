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
/* Ledger amount cells and their footer totals: the columns have a fixed width,
 * so a very large figure shrinks to fit that width instead of widening the
 * column (which would push the footer totals out from under Debit / Credit). */
const LEDGER_SELECTOR = ".ledger-amt td.num, .ledger-total-fit";

function textWidth(el: HTMLElement): number {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  let left = Infinity;
  let right = -Infinity;
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (!n.textContent?.trim()) continue;
    range.selectNodeContents(n);
    const b = range.getBoundingClientRect();
    left = Math.min(left, b.left);
    right = Math.max(right, b.right);
  }
  return right > left ? right - left : 0;
}

function fitLedger(el: HTMLElement) {
  if (el.dataset.fitOrig === undefined) el.dataset.fitOrig = el.style.fontSize;
  el.style.fontSize = el.dataset.fitOrig;
  // Stacked cards show the value on its own line, full width — nothing to fit.
  if (el.closest(".tbl-stack") && window.innerWidth <= 1279) return;
  const box = el.classList.contains("ledger-total-fit") ? (el.parentElement as HTMLElement) : el;
  const cs = getComputedStyle(box);
  const fixed = parseFloat(cs.minWidth);
  const avail = (Number.isFinite(fixed) && fixed > 0 ? fixed : box.clientWidth) - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
  const w = textWidth(el);
  if (!avail || !w || w <= avail) return;
  const base = parseFloat(getComputedStyle(el).fontSize);
  if (!base) return;
  el.style.fontSize = `${(base * Math.max((avail / w) * 0.97, MIN_SCALE)).toFixed(2)}px`;
}

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
      document.querySelectorAll<HTMLElement>(LEDGER_SELECTOR).forEach(fitLedger);
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
