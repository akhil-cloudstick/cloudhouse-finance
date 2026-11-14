"use client";

import { useEffect, useRef } from "react";

/* Ledger → ledger drill-down memory.
 *
 * A ledger table tags its rows and itself with data attributes:
 *   <table data-ledger-scope="cash-movements" data-ledger-page={page}>
 *     <tr data-ledger-key="m-42" data-ledger-date="2026-10-02" data-ledger-amount="5000">
 * When a link inside such a row is clicked (a ref chip, a bank/customer
 * chip, a mode link — anything), the capture-phase listener below records
 * where the user came from and which transaction they followed. Then:
 *   - on the ledger they land on, the row for the same transaction (same
 *     date and amount) is highlighted and scrolled into view;
 *   - coming back to the ledger they left, the row they clicked is
 *     highlighted and scrolled to again, on the page they were on
 *     (rememberedLedgerPage).
 * sessionStorage only: per-tab, and the page works the same without it. */

type Origin = { path: string; scope: string; rowKey: string; page: number; date: string; amount: string; ref?: string };
// ref (data-ledger-ref = "<kind>:<id>", e.g. "lp:42" loan payment, "m:12" cash movement, "e:7" expense, "g:3" gold sale) pins the exact entry followed.
type Arrival = { path: string; date: string; amount: string; fromPath: string; ref?: string };

const ORIGINS_KEY = "ledgerFocus:origins";
const ARRIVAL_KEY = "ledgerFocus:arrival";
const FOCUS_CLASS = "ledger-row-focus";

/* A browser refresh must land where the user is NOW, not replay the
 * drill-out memory from an earlier link click (which could be minutes old).
 * So on a reload the drill-out memory is dropped, and the live position
 * (tab + page, kept by saveLedgerPosition) is restored instead — until the
 * user leaves via a link or Back, after which normal navigation applies. */
let reloadActive = false;
const POSITION_KEY = "ledgerFocus:position";

function read<T>(key: string): T | null {
  try {
    const raw = sessionStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function write(key: string, value: unknown) {
  try {
    sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable — the drill-down still works, just unhighlighted */
  }
}

// One remembered row per ledger path, so Back through several ledgers
// lands on the right row at every step.
function origins(): Record<string, Origin> {
  return read<Record<string, Origin>>(ORIGINS_KEY) || {};
}

function onLedgerLinkClick(e: MouseEvent) {
  const target = e.target as Element | null;
  const link = target?.closest?.("a[href]") as HTMLAnchorElement | null;
  const row = link?.closest("tr[data-ledger-key]") as HTMLElement | null;
  if (!link || !row) return;
  const url = new URL(link.href, window.location.href);
  if (url.origin !== window.location.origin || url.pathname === window.location.pathname) return;
  const table = row.closest("[data-ledger-scope]") as HTMLElement | null;
  const path = window.location.pathname;
  const date = row.dataset.ledgerDate || "";
  const amount = row.dataset.ledgerAmount || "";
  const ref = row.dataset.ledgerRef || "";
  // Arriving fresh at a ledger starts it clean — drop whatever row was
  // remembered for it from an earlier visit.
  const rest = origins();
  delete rest[url.pathname];
  write(ORIGINS_KEY, {
    ...rest,
    [path]: {
      path,
      scope: table?.dataset.ledgerScope || "",
      rowKey: row.dataset.ledgerKey || "",
      page: Number(table?.dataset.ledgerPage) || 1,
      date,
      amount,
      ref,
    },
  });
  write(ARRIVAL_KEY, { path: url.pathname, date, amount, ref, fromPath: path } satisfies Arrival);
}

if (typeof window !== "undefined") {
  try {
    const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
    if (nav?.type === "reload") {
      reloadActive = true;
      sessionStorage.removeItem(ORIGINS_KEY);
      sessionStorage.removeItem(ARRIVAL_KEY);
    }
  } catch {
    /* no navigation timing / storage — a reload just starts the ledger clean */
  }
  const leave = (e?: Event) => {
    if (!e || e.type === "popstate" || (e.target as Element | null)?.closest?.("a[href]")) reloadActive = false;
  };
  // Visiting a page from the sidebar starts every ledger clean — the page/row a
  // ledger remembers only survives drilling in and out of ledger links.
  document.addEventListener("click", (e) => {
    if ((e.target as Element | null)?.closest?.("#side a[href]")) {
      sessionStorage.removeItem(ORIGINS_KEY);
      sessionStorage.removeItem(ARRIVAL_KEY);
    }
  }, true);
  document.addEventListener("click", leave, true);
  window.addEventListener("popstate", leave);
  // Capture phase: LedgerRefLink stops its click from bubbling, so a bubbling
  // listener would never see it.
  document.addEventListener("click", onLedgerLinkClick, true);
}

/* The page this ledger scope was on when the user drilled out of it, when
 * they're now back on that same ledger — the initial page state to use. */
export function rememberedLedgerPage(scope: string): number | undefined {
  if (typeof window === "undefined") return undefined;
  const o = origins()[window.location.pathname];
  if (o && o.scope === scope) return o.page;
  const p = reloadedLedgerPosition()?.[scope];
  return typeof p === "number" ? p : undefined;
}

type Position = Record<string, number | string>;

/* Keeps the ledger's current tab/page so a refresh can come back to it. */
export function saveLedgerPosition(patch: Position) {
  if (typeof window === "undefined") return;
  const all = read<Record<string, Position>>(POSITION_KEY) || {};
  const path = window.location.pathname;
  write(POSITION_KEY, { ...all, [path]: { ...(all[path] || {}), ...patch } });
}

/* The position saved before a refresh — only while this document load IS
 * that refresh; undefined for any normal visit. */
export function reloadedLedgerPosition(): Position | undefined {
  if (typeof window === "undefined" || !reloadActive) return undefined;
  return read<Record<string, Position>>(POSITION_KEY)?.[window.location.pathname];
}

function sameAmount(a: string | undefined, b: string) {
  return a !== undefined && a !== "" && b !== "" && Math.abs(Number(a) - Number(b)) < 0.005;
}

/* For a ledger paged client-side: the index in `rows` (all of them, not
 * just the visible page) of the row to focus — the remembered row when
 * back on this ledger, else the transaction just drilled in from — so the
 * caller can open the page that holds it. -1 when there is none. */
export function ledgerFocusIndex(scope: string, rows: { key: string; date: string; amount: number }[]): number {
  if (typeof window === "undefined") return -1;
  const path = window.location.pathname;
  const o = origins()[path];
  if (o && o.scope === scope) return rows.findIndex((r) => r.key === o.rowKey);
  const a = read<Arrival>(ARRIVAL_KEY);
  if (!a || a.path !== path) return -1;
  return rows.findIndex((r) => r.date === a.date && sameAmount(String(r.amount), a.amount));
}

/* For a ledger paged by the backend: what ledgerFocusIndex would look for,
 * as a request — the remembered row's key when back on this ledger, else
 * the date + amount of the transaction just drilled in from — so the server
 * can answer with the page that holds it. null when there is none. */
export function ledgerFocusTarget(scope: string): { key: string } | { date: string; amount: number; payment?: number; ref?: string } | null {
  if (typeof window === "undefined") return null;
  const path = window.location.pathname;
  const o = origins()[path];
  if (o && o.scope === scope) return o.rowKey ? { key: o.rowKey } : null;
  const a = read<Arrival>(ARRIVAL_KEY);
  if (!a || a.path !== path || a.amount === "" || !Number.isFinite(Number(a.amount))) return null;
  const payment = /^lp:(\d+)$/.exec(a.ref || "")?.[1];
  return { date: a.date, amount: Number(a.amount), ...(payment ? { payment: Number(payment) } : {}), ...(a.ref ? { ref: a.ref } : {}) };
}

/* Highlights and scrolls to the remembered row once the ledger's rows are
 * on screen. ready should flip true when the rows have rendered, and deps
 * re-run it when the visible rows change (page/filter). */
export function useLedgerFocus(scope: string, ready: boolean, deps: unknown[] = []) {
  // The row already scrolled to on this page. A background refresh of the
  // ledger re-renders the same row; scrolling again would drag the user back
  // every time they scroll away, so a given row is focused only once.
  const handled = useRef("");
  useEffect(() => {
    if (!ready || typeof window === "undefined") return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const frame = requestAnimationFrame(() => {
      const table = document.querySelector(`[data-ledger-scope="${scope}"]`);
      if (!table) return;
      table.querySelectorAll(`.${FOCUS_CLASS}`).forEach((el) => el.classList.remove(FOCUS_CLASS));
      const path = window.location.pathname;
      const rows = Array.from(table.querySelectorAll<HTMLElement>("tr[data-ledger-key]"));

      // Back on the ledger the user drilled out of: the row they clicked.
      const o = origins()[path];
      let row = o && o.scope === scope ? rows.find((r) => r.dataset.ledgerKey === o.rowKey) : undefined;

      // Arrived from another ledger: the same transaction here.
      if (!row) {
        const a = read<Arrival>(ARRIVAL_KEY);
        if (a && a.path === path) {
          const own = a.ref ? rows.filter((r) => r.dataset.ledgerRef === a.ref) : [];
          if (own.length) {
            // The exact payment followed: its own row only, never another loan's with the same date and amount.
            row = own.find((r) => sameAmount(r.dataset.ledgerAmount, a.amount)) ?? own[0];
          } else {
            // No exact payment id (e.g. a sanction/top-up row). Two loans can share the same date and
            // amount, so prefer the row that names the loan the user came from (/loan/LN-00069).
            const loanNo = /\/loan\/([^/?#]+)/i.exec(a.fromPath)?.[1];
            const byLoan = (list: HTMLElement[]) =>
              loanNo ? list.find((r) => (r.textContent || "").toUpperCase().includes(decodeURIComponent(loanNo).toUpperCase())) : undefined;
            // The clicked row was not a loan payment (auction, movement…), so a payment row
            // that merely shares its date and amount is a different entry — skip those, and
            // never fall back to an amount-only match.
            const sameDateAmt = rows.filter((r) => !r.dataset.ledgerRef?.startsWith("lp:") && r.dataset.ledgerDate === a.date && sameAmount(r.dataset.ledgerAmount, a.amount));
            row = byLoan(sameDateAmt) ?? sameDateAmt[0];
          }
        }
      }
      if (!row) return;
      const signature = `${path}|${row.dataset.ledgerKey ?? ""}`;
      if (handled.current === signature) return;
      handled.current = signature;
      row.classList.add(FOCUS_CLASS);
      row.scrollIntoView({ block: "center", behavior: "smooth" });
      // The highlight fades after 10 seconds.
      const target = row;
      timer = setTimeout(() => target.classList.remove(FOCUS_CLASS), 10000);
    });
    return () => { cancelAnimationFrame(frame); if (timer) clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, ready, ...deps]);
}
