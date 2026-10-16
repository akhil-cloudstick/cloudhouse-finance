"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";

/**
 * Checks whether the current viewport is a "small" screen.
 * Big screen corresponds to 1920x1080 and larger monitors (innerWidth >= 1560 AND innerHeight > 850).
 * Small screen corresponds to laptops (e.g. 1280x832, 1366x768, 1440x900) or browser height <= 850px.
 */
export function isSmallScreen(): boolean {
  if (typeof window === "undefined") return false;
  return window.innerWidth < 1560 || window.innerHeight <= 850;
}

function subscribeResize(onChange: () => void): () => void {
  window.addEventListener("resize", onChange);
  return () => window.removeEventListener("resize", onChange);
}

/* Read through useSyncExternalStore rather than useState(false) + an effect.
 * The effect version rendered every page's first frame in the big-screen
 * layout and only switched to the small one after paint, so on a laptop
 * each navigation flashed: the page drew at full size, then its header and
 * tables snapped down a beat later. Here a page mounted by navigation gets
 * the real value on its first render. The server snapshot (false) is used
 * only while hydrating the static HTML, which keeps hydration consistent. */
export function useIsSmallScreen(): boolean {
  return useSyncExternalStore(subscribeResize, isSmallScreen, () => false);
}

export function useResponsivePageSize(bigSize: number, smallSize: number): number {
  const small = useIsSmallScreen();
  return small ? smallSize : bigSize;
}

/* Helper functions for API calls and default service fallbacks */
export function getLoansPageSize(): number {
  return isSmallScreen() ? 7 : 10;
}

export function getCustomersPageSize(): number {
  return isSmallScreen() ? 7 : 9;
}

export function getCustomerSubtablePageSize(): number {
  return isSmallScreen() ? 7 : 10;
}

export function getRequestsPageSize(): number {
  return isSmallScreen() ? 7 : 10;
}

export function getBankPledgePageSize(): number {
  return isSmallScreen() ? 7 : 10;
}

export function getGoldRatesPageSize(): number {
  return isSmallScreen() ? 6 : 10;
}

export function getEmployeesPageSize(): number {
  return isSmallScreen() ? 8 : 12;
}

export function getCashPageSize(): number {
  return 7;
}

export function getPacketsPageSize(): number {
  return isSmallScreen() ? 8 : 12;
}

export function getReportsPageSize(): number {
  return isSmallScreen() ? 7 : 12;
}

/* Tables that turn into cards (`.tbl-cards`, app.css) at this width swap
 * Prev/Next paging for scroll-to-load-more. Keep in sync with the
 * `max-width: 1100px` card breakpoint in app.css. */
const CARD_MODE_MAX_WIDTH = 1100;

/* Stacked ledger tables (.tbl-stack) turn into cards at this wider width. */
export const STACK_MODE_MAX_WIDTH = 1279;

export function useIsCardMode(maxWidth: number = CARD_MODE_MAX_WIDTH): boolean {
  const snapshot = useCallback(() => typeof window !== "undefined" && window.innerWidth <= maxWidth, [maxWidth]);
  return useSyncExternalStore(subscribeResize, snapshot, () => false);
}

/* Page size that grows by `base` each time `more()` is called while the
 * table is in card mode (the page is always 1 there). The backend caps a page
 * at 500 rows. Outside card mode it is just `base`. */
export function useScrollPageSize(base: number, maxWidth: number = CARD_MODE_MAX_WIDTH): { cards: boolean; size: number; more: () => void } {
  const cards = useIsCardMode(maxWidth);
  const [mult, setMult] = useState(1);
  useEffect(() => { if (!cards) setMult(1); }, [cards]);
  const maxMult = Math.max(1, Math.floor(500 / base));
  const size = cards ? base * Math.min(mult, maxMult) : base;
  const more = useCallback(() => setMult((m) => Math.min(m + 1, maxMult)), [maxMult]);
  return { cards, size, more };
}
