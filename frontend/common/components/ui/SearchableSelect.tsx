"use client";

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

export type SearchPage<T> = { items: T[]; hasMore: boolean };

// One `.gs-results a` row (app.css): 8px+8px padding plus a ~14px line for
// the label ≈ 37px. 5 rows plus the list's own 6px+6px padding (app.css's
// `.gs-results{padding:6px}`) is the box height that shows exactly 5 items
// before the list has to scroll for the rest.
const ROW_HEIGHT = 37;
const VISIBLE_ROWS = 5;
const ROWS_BOX_HEIGHT = ROW_HEIGHT * VISIBLE_ROWS + 12;

/**
 * A text-input + dropdown combobox backed by a server-side, paginated
 * search function, matching the app's existing `.inp` input styling (see
 * modals/* and GlobalSearch.tsx) rather than a plain native `<select>`.
 *
 * - `fetchFn(query, page)` is called with 0-based pages; each page is a
 *   fixed size (5 — see customersApi.ts/schemesApi.ts/modules/banks/services/bankService.ts's page
 *   wrappers) and the backend reports whether more pages exist, so this
 *   component never has to guess from a short last page.
 * - Opening the box with an empty query loads page 0 immediately — that's
 *   a plain listing, not a "search", so it isn't debounced. Typing a query
 *   debounces by ~300ms and restarts pagination from page 0; an empty
 *   query never fires a fresh fetch mid-type (only once, on open).
 * - Scrolling the open results list near its bottom loads the next page
 *   and appends it (infinite scroll) rather than replacing the list.
 * - Guards against stale responses with a monotonically increasing
 *   request id — a fetch that resolves after a newer one was kicked off is
 *   discarded.
 * - In `allowCreate` mode, if the query doesn't exactly match (case
 *   insensitive) any loaded item, a "+ Create '<query>'" row is shown;
 *   picking it calls `onCreate` and then selects the result.
 * - `compact`: PurityPicker's own search half only, which can render as
 *   narrow as ~34px wide inside NewLoan.tsx's ornament table — every other
 *   caller (ornament type, customer/scheme/bank search, …) keeps this
 *   component's original inline dropdown (absolute-positioned under the
 *   input, natural width, a themed scrollbar past exactly VISIBLE_ROWS (5)
 *   items — matching the page size so the box overflows, and scrolling
 *   starts fetching page 2, right as a 6th result exists) unchanged.
 *   Compact instead portals the list to `document.body` and positions it
 *   with `position:fixed` off the input's own viewport rect — this is what
 *   stops an `overflow` ancestor (like that same table's wrapping div) from
 *   clipping it — pins its width between 60 and 160px regardless of how
 *   squeezed the trigger itself is, opens only downward (never flips above
 *   the input) with height capped to at most 5 rows, and hides its own
 *   scrollbar while staying fully scrollable for the rest.
 */
export function SearchableSelect<T>({
  value,
  onChange,
  fetchFn,
  getLabel,
  renderLabel,
  getId,
  placeholder,
  allowCreate = false,
  onCreate,
  onCreateNew,
  createNewLabel = "+ Add new",
  disabled,
  renderOption,
  compact = false,
  compactMinWidth = 60,
}: {
  value: string;
  onChange: (id: string, item: T) => void;
  fetchFn: (query: string, page: number) => Promise<SearchPage<T>>;
  getLabel: (item: T) => string;
  // Optional richer rendering for a *result row* only. getLabel stays the
  // single source of truth for the input's own displayed text (it's a plain
  // text input — it cannot hold markup) and for allowCreate's exact-match
  // check; renderLabel just lets a row show more than that flat string —
  // e.g. the customer pickers' name plus a "Verified" badge
  // (VerifiedBadge.tsx, used by NewLoan.tsx and NewPersonalLoanModal.tsx).
  // Every other caller omits it and keeps rendering plain bold getLabel
  // text, unchanged.
  renderLabel?: (item: T) => ReactNode;
  getId: (item: T) => string;
  placeholder?: string;
  allowCreate?: boolean;
  onCreate?: (query: string) => Promise<T>;
  // Opt-in, separate mechanism from allowCreate/onCreate above (which
  // create from the typed text alone — see PurityPicker/ornament-type
  // usage in NewLoan.tsx). onCreateNew instead renders one persistent row
  // pinned to the bottom of the results list — used by the Personal Loan
  // picker's "+ Add new customer" (NewPersonalLoanModal.tsx), which needs
  // a full modal form, not just the typed query string. Gold Loan's own
  // customer picker (NewLoan.tsx) simply never passes this, so it is
  // visually and functionally unchanged.
  onCreateNew?: () => void;
  createNewLabel?: string;
  disabled?: boolean;
  /** Custom content for a dropdown row, in place of the plain bold
   * `getLabel(item)` text — e.g. a name plus a StatusChip instead of a
   * parenthetical status baked into the label string. `getLabel` still
   * drives the input's own displayed text once picked (a plain `<input>`
   * can't render a chip) and the exact-match/allowCreate check, so it
   * should stay a full plain-text description even when this is set. */
  renderOption?: (item: T) => ReactNode;
  compact?: boolean;
  // `compact` mode's dropdown width floor — per-caller, since some callers
  // (Dashboard/NewLoan's Gold Loan Calculator) want it wider than the
  // default 60px, while others (RateModal's own PurityPicker) keep the
  // original 60px. Ignored unless `compact` is true.
  compactMinWidth?: number;
}) {
  const [query, setQuery] = useState(value);
  // Separate from `query` (the input's displayed text, which starts out as
  // the already-selected item's label): fetching off `query` directly meant
  // opening a box that already had a selection filtered the very first
  // fetch by that leftover label text, so the list flashed "No results"
  // before the user had typed anything. `searchTerm` resets to "" whenever
  // the box opens (or the user clears it) and only tracks what's actually
  // been typed since, so opening always shows the full list first.
  const [searchTerm, setSearchTerm] = useState("");
  const [items, setItems] = useState<T[]>([]);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [creating, setCreating] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);
  // Only used in `compact` mode — see that prop's doc comment above.
  const [coords, setCoords] = useState<{ top: number; left: number; width: number; maxHeight: number } | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestIdRef = useRef(0);
  // Tracks the query the currently-open dropdown was first opened/typed
  // with, so re-focusing without typing doesn't re-fire a fetch.
  const loadedForRef = useRef<string | null>(null);
  // Arrow-key navigation over the open results list: -1 means nothing
  // highlighted (the plain "typing, nothing picked yet" state). Index space
  // covers `items` first, then the "+ Create …" row (if shown) as one extra
  // slot past the end.
  const [highlightedIndex, setHighlightedIndex] = useState(-1);

  // Keep the visible text in sync if the parent changes `value` externally
  // (e.g. resetting the form) without the user typing.
  useEffect(() => {
    setQuery(value);
  }, [value]);

  function loadPage(q: string, p: number, reqId: number, append: boolean) {
    const setBusy = append ? setLoadingMore : setLoading;
    setBusy(true);
    // A fresh (non-appended) page — a new search term, or the box just
    // opened — invalidates whatever was highlighted before. An appended
    // page (infinite scroll / keyboard-nav prefetch) must NOT reset it:
    // this used to live in a `useEffect` keyed on `items`, which also fired
    // on every append and threw the user back to "nothing highlighted"
    // mid-arrow-key-navigation the moment the next page loaded.
    if (!append) setHighlightedIndex(-1);
    fetchFn(q, p)
      .then((result) => {
        if (reqId !== requestIdRef.current) return; // stale response — discard
        setItems((prev) => (append ? [...prev, ...result.items] : result.items));
        setHasMore(result.hasMore);
        setPage(p);
        // Pre-highlights the first result as soon as a fresh (non-append)
        // page actually arrives, rather than leaving highlightedIndex at
        // -1 until the user presses an arrow key first — without this,
        // Enter alone right after typing/opening (the far more common
        // combobox habit than arrowing down to row 0 first) did nothing at
        // all, reading as "Enter doesn't work" even though arrow-key nav
        // was fine once something was actually highlighted.
        if (!append) setHighlightedIndex(result.items.length > 0 ? 0 : -1);
      })
      .catch(() => {
        if (reqId !== requestIdRef.current) return;
        if (!append) { setItems([]); setHasMore(false); }
      })
      .finally(() => {
        if (reqId === requestIdRef.current) setBusy(false);
      });
  }

  // Fires the initial/typed-query fetch. An empty search term fetches
  // immediately (it's a listing, not a search); a non-empty one debounces.
  useEffect(() => {
    if (!open) return;
    if (loadedForRef.current === searchTerm) return; // already loaded this term
    loadedForRef.current = searchTerm;

    if (debounceRef.current) clearTimeout(debounceRef.current);
    const reqId = ++requestIdRef.current;
    if (!searchTerm.trim()) {
      loadPage(searchTerm, 0, reqId, false);
      return;
    }
    setLoading(true); // show "Searching…" for the debounce window too, not a "No results" flash
    debounceRef.current = setTimeout(() => loadPage(searchTerm, 0, reqId, false), 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchTerm, open]);

  function loadNextPage() {
    if (!hasMore || loadingMore || loading) return;
    const reqId = ++requestIdRef.current;
    loadPage(searchTerm, page + 1, reqId, true);
  }

  // Scrolling the open list near the bottom of what's currently loaded
  // fetches and appends the next page (both modes: the plain inline
  // dropdown is capped to exactly VISIBLE_ROWS (5) via ROWS_BOX_HEIGHT
  // below so it overflows — and becomes scrollable — once a 6th item
  // loads; `compact` caps at the same 5 rows with its scrollbar hidden —
  // see that prop's doc comment).
  function onResultsScroll() {
    const el = resultsRef.current;
    if (!el) return;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 48) loadNextPage();
  }

  // A box capped to exactly 5 rows (ROWS_BOX_HEIGHT) and a page size of
  // exactly 5 items (fetchFn — see this component's doc comment) meant page
  // 1 alone fills the box exactly to its cap without ever overflowing it:
  // scrollHeight == clientHeight, so there is nothing to scroll, so
  // onResultsScroll above never fires, so page 2 never loads, so the box
  // never overflows — a standing deadlock, not just a slow start. Prefetch
  // one extra page right after the box renders without yet overflowing, so
  // there are 10 rows sitting in a 5-row box (a real scrollbar) the moment
  // it opens; from there, scrolling drives every further page exactly as
  // before. Naturally stops itself the moment the box actually overflows or
  // the server runs out of pages, so it never loops.
  useEffect(() => {
    if (!open || !hasMore || loading || loadingMore) return;
    const el = resultsRef.current;
    if (!el) return;
    if (el.scrollHeight <= el.clientHeight + 1) loadNextPage();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, items, hasMore, loading, loadingMore, compact, coords]);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      const target = e.target as Node;
      // resultsRef now lives in a document.body portal (see the `open &&`
      // render below), so it's no longer a DOM descendant of boxRef — a
      // click on a result would otherwise register as "outside" and close
      // the dropdown before its own onClick handler ever ran.
      if (boxRef.current?.contains(target)) return;
      if (resultsRef.current?.contains(target)) return;
      setOpen(false);
    }
    document.addEventListener("click", onDocClick);
    return () => document.removeEventListener("click", onDocClick);
  }, []);

  // Belt-and-braces alongside the input's own onBlur (below): closes this
  // dropdown the moment focus lands ANYWHERE outside this component,
  // including via Tab — relatedTarget on a blur event isn't reliably
  // populated by every browser/timing combination, so blur alone
  // occasionally left a dropdown open after tabbing past it while a
  // later field's own dropdown opened on top of it. `focusin` bubbles
  // (unlike plain `focus`), so one document-level listener catches every
  // focus change app-wide; only this component's own open state reacts,
  // scoped by `boxRef`/`resultsRef` same as the click listener above.
  useEffect(() => {
    if (!open) return;
    function onFocusIn(e: FocusEvent) {
      const target = e.target as Node;
      if (boxRef.current?.contains(target)) return;
      if (resultsRef.current?.contains(target)) return;
      setOpen(false);
    }
    document.addEventListener("focusin", onFocusIn);
    return () => document.removeEventListener("focusin", onFocusIn);
  }, [open]);

  // compact-only: recompute the portal's fixed position whenever it opens,
  // and keep it pinned to the input while the box stays open — the
  // ancestor doing the scrolling is unknown from here (could be the whole
  // page or some inner `overflow` container like NewLoan.tsx's table
  // wrapper), so this listens on window scroll with `capture:true`, which
  // also catches scroll events bubbling up from any nested scrollable
  // ancestor.
  //
  // Always opens downward, never flips above the input: an "open upward"
  // heuristic sounds nice in principle, but for a trigger sitting near the
  // bottom of a scrollable panel (a common case in this app's cards) it put
  // the box's growth direction entirely at the mercy of how much space
  // happened to be above — for a long, unpaginated-looking list that meant
  // the dropdown shooting up past the top of the viewport, looking
  // disconnected from the field it belongs to ("the dropdown is rising
  // up"). Opening downward with a hard maxHeight capped to the real
  // remaining space below is predictable in every case instead: it never
  // grows past what's actually still on screen, so it's obviously still
  // "the dropdown for that field" no matter where the field sits.
  useLayoutEffect(() => {
    // Stale `coords` left over from the last time this was open is
    // harmless: the render below gates on `open && coords`, and `open` is
    // already false here, so there's nothing to clear.
    if (!compact || !open) return;
    function reposition() {
      const el = boxRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const spaceBelow = window.innerHeight - rect.bottom;
      // Caps at exactly ROWS_BOX_HEIGHT (~5 rows) even when there's plenty
      // of room below — the list scrolls internally for anything past that
      // (onResultsScroll above), it doesn't keep growing taller. Only
      // shrinks below that when the field itself is close enough to the
      // bottom of the viewport that 5 full rows wouldn't fit; 120 is the
      // floor for that squeeze so it's never so short it's useless.
      const maxHeight = Math.min(ROWS_BOX_HEIGHT, Math.max(120, spaceBelow - 8));
      // Clamps left so the (up to 160px-wide) dropdown never runs past the
      // right edge of the viewport — a bank/purity picker sitting near the
      // right edge of a modal (e.g. SplitPaymentInput's Bank column) would
      // otherwise open a box that's partly clipped by the modal's own
      // overflow:hidden, rather than just the box being narrow.
      const width = Math.min(Math.max(rect.width, compactMinWidth), 160);
      const left = Math.min(rect.left, window.innerWidth - width - 16);
      setCoords({ top: rect.bottom, left, width: rect.width, maxHeight });
    }
    reposition();
    // Closes on scroll OUTSIDE this dropdown's own results list instead of
    // repositioning — see Select.tsx's identical fix for why a
    // `position:fixed`/portaled panel re-anchored mid-scroll reads as a
    // floating, detached dropdown. Scrolling the results list itself
    // (onResultsScroll's own infinite-scroll paging) must not close it.
    function closeOnScroll(e: Event) {
      if (resultsRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    }
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", closeOnScroll, true);
    return () => {
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", closeOnScroll, true);
    };
  }, [compact, open]);

  const showCreateRowForNav = allowCreate && query.trim().length > 0 &&
    !items.some((it) => getLabel(it).toLowerCase() === query.trim().toLowerCase()) && !loading;
  const navRowCount = items.length + (showCreateRowForNav ? 1 : 0);

  function scrollHighlightedIntoView(index: number) {
    const list = resultsRef.current;
    if (!list) return;
    const row = list.children[index] as HTMLElement | undefined;
    row?.scrollIntoView({ block: "nearest" });
  }

  function onInputKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        setSearchTerm("");
        setOpen(true);
      }
      return;
    }
    if (!navRowCount) return;

    switch (e.key) {
      case "ArrowDown": {
        e.preventDefault();
        // Stops this from ALSO reaching an ancestor's own Enter/keydown
        // handler (Modal.tsx's onModalKeyDown, or a page-level
        // makeEnterToSubmitHandler) — preventDefault alone only cancels
        // the key's default browser action, not other JS listeners still
        // watching the same bubbling event. Without this, list navigation
        // "worked" internally but every arrow/Enter press also fired
        // whatever the container's own handler does, reading as broken.
        e.stopPropagation();
        const next = highlightedIndex < navRowCount - 1 ? highlightedIndex + 1 : 0;
        setHighlightedIndex(next);
        scrollHighlightedIntoView(next);
        if (next >= navRowCount - 3) loadNextPage(); // nearing the loaded end — fetch ahead, same as scroll
        break;
      }
      case "ArrowUp": {
        e.preventDefault();
        e.stopPropagation();
        const next = highlightedIndex > 0 ? highlightedIndex - 1 : navRowCount - 1;
        setHighlightedIndex(next);
        scrollHighlightedIntoView(next);
        break;
      }
      case "Enter": {
        if (highlightedIndex < 0) return;
        e.preventDefault();
        e.stopPropagation();
        if (highlightedIndex < items.length) pick(items[highlightedIndex]);
        else pickCreate();
        break;
      }
      case "Escape": {
        e.preventDefault();
        e.stopPropagation();
        setOpen(false);
        break;
      }
    }
  }

  function pick(item: T) {
    onChange(getId(item), item);
    setQuery(getLabel(item));
    setOpen(false);
  }

  async function pickCreate() {
    if (!onCreate || !query.trim() || creating) return;
    setCreating(true);
    try {
      const created = await onCreate(query.trim());
      onChange(getId(created), created);
      setQuery(getLabel(created));
      setOpen(false);
    } finally {
      setCreating(false);
    }
  }

  const exactMatch = items.some((it) => getLabel(it).toLowerCase() === query.trim().toLowerCase());
  const showCreateRow = allowCreate && query.trim().length > 0 && !exactMatch && !loading;

  // Pinned to the TOP of the results list, ahead of every loaded item —
  // it's a standing action ("add one that doesn't exist yet"), not one more
  // search result, so it reads better as the first thing offered than
  // buried below a list (or a "No results" message) the user has to scroll
  // past first.
  const createNewRow = onCreateNew && (
    <a
      href="#"
      className="gs-create-new"
      onClick={(e) => { e.preventDefault(); setOpen(false); onCreateNew(); }}
    >
      <span className="tx"><b>{createNewLabel}</b></span>
    </a>
  );

  const resultsBody = loading ? (
    <>
      {createNewRow}
      <div className="gs-none">Searching…</div>
    </>
  ) : items.length === 0 && !showCreateRow ? (
    <>
      {createNewRow}
      <div className="gs-none">No results</div>
    </>
  ) : (
    <>
      {createNewRow}
      {items.map((item, i) => (
        <a
          key={getId(item)}
          href="#"
          // Not a real Tab stop — these are picked via click or the
          // input's own ArrowUp/Down+Enter handling (onInputKeyDown)
          // only. Without this, Tab walked into the open list's anchors
          // one at a time instead of moving straight to the next field,
          // which — combined with the input's own onBlur guard that
          // deliberately keeps the dropdown open while focus is still
          // somewhere inside it (so a click-to-select isn't closed out
          // from under itself) — left the dropdown open the whole time
          // Tab was stepping through its rows.
          tabIndex={-1}
          className={i === highlightedIndex ? "sel" : undefined}
          onMouseEnter={() => setHighlightedIndex(i)}
          onClick={(e) => { e.preventDefault(); pick(item); }}
        >
          {renderOption ? renderOption(item) : <span className="tx">{renderLabel ? renderLabel(item) : <b>{getLabel(item)}</b>}</span>}
        </a>
      ))}
      {loadingMore && <div className="gs-none">Loading more…</div>}
      {showCreateRow && (
        <a
          href="#"
          tabIndex={-1}
          className={highlightedIndex === items.length ? "sel" : undefined}
          onMouseEnter={() => setHighlightedIndex(items.length)}
          onClick={(e) => { e.preventDefault(); pickCreate(); }}
        >
          <span className="tx"><b>{creating ? "Creating…" : `+ Create "${query.trim()}"`}</b></span>
        </a>
      )}
    </>
  );

  return (
    <div className="ss" ref={boxRef} style={{ position: "relative" }}>
      <input
        className={compact ? "inp" : "inp ss-input"}
        placeholder={placeholder}
        value={query}
        disabled={disabled}
        autoComplete="off"
        onChange={(e) => { setQuery(e.target.value); setSearchTerm(e.target.value); setOpen(true); }}
        onFocus={() => { setSearchTerm(""); setOpen(true); }}
        onKeyDown={onInputKeyDown}
        // Closes the dropdown whenever focus actually leaves this field —
        // previously it only closed on a document-level click outside, so
        // moving focus away programmatically (e.g. Enter-to-next-field's
        // next.focus() in enterToSubmit.ts) left it open, floating over
        // whatever field focus had just moved to. Guarded by relatedTarget
        // so clicking a result (which moves focus to that <a> a beat
        // before its onClick fires pick()) doesn't close the dropdown out
        // from under the click.
        onBlur={(e) => {
          if (resultsRef.current?.contains(e.relatedTarget as Node)) return;
          setOpen(false);
        }}
      />
      {/* Purely a visual "this is a dropdown" cue, matching Select.tsx's own
       * chevron — `pointerEvents:none` so it never steals clicks/focus from
       * the input underneath. Skipped in `compact` mode (PurityPicker's
       * search half, as narrow as ~34px) where there's no room for it
       * without crowding the typed value itself. */}
      {!compact && (
        <svg
          className="sel-chevron ss-chevron"
          viewBox="0 0 10 6"
          fill="none"
          style={{ transform: open ? "translateY(-50%) rotate(180deg)" : "translateY(-50%)", transition: "transform .15s ease" }}
        >
          <path d="M1 1l4 4 4-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
      {/* Every other caller: the original inline dropdown — absolute inside
       * `.ss`, natural width, themed scrollbar. Capped to exactly
       * ROWS_BOX_HEIGHT (~5 rows) rather than app.css's own generic
       * max-height:420px (~11 rows): each `fetchFn` page here is a fixed 5
       * items (customersApi/schemesApi/banksApi/lockersApi's page
       * wrappers), and a box tall enough to fit ~11 rows without a
       * scrollbar meant one page's worth of results never overflowed it —
       * onResultsScroll only fires once there's something to scroll past,
       * so the list was stuck on page 1 forever no matter how many more
       * results existed server-side. Matching the window to the page size
       * makes it overflow (and start loading page 2 on scroll) the moment
       * a 6th result exists. */}
      {!compact && open && (
        <div
          ref={resultsRef}
          className="gs-results open"
          style={{ maxHeight: ROWS_BOX_HEIGHT }}
          onScroll={onResultsScroll}
        >
          {resultsBody}
        </div>
      )}
      {/* PurityPicker's search half only — see the `compact` prop's doc
       * comment for why this needs the portal/fixed-position/capped-size
       * treatment that every other dropdown deliberately does NOT get. */}
      {compact && open && coords && createPortal(
        <div
          ref={resultsRef}
          className="gs-results open no-scrollbar"
          onScroll={onResultsScroll}
          // Every property below is given an explicit value, including the
          // "off" ones ("auto") — the shared .gs-results class (app.css)
          // sets position:absolute, top:calc(100% + 8px), right:0 and
          // max-height:420px, and a React inline style only overrides a
          // class rule for properties it actually sets: leaving one at
          // `undefined` drops it from the style attribute entirely and lets
          // the class value win — which for `top` under position:fixed
          // resolves against the viewport, not this box's own offset, and
          // would fling the dropdown to the wrong place.
          style={{
            position: "fixed",
            top: coords.top,
            left: coords.left,
            right: "auto",
            // Clamped, not just floored: below compactMinWidth an item's own
            // label ("24", "Gold Chain", …) starts wrapping or clipping, and
            // above ~160px (roughly PurityPicker's search half at its own
            // un-squeezed width — see PurityPicker.tsx's `flex:1` split)
            // the dropdown would visibly outgrow the field it belongs to
            // for a plain 2-3-digit purity value.
            width: Math.min(Math.max(coords.width, compactMinWidth), 160),
            marginTop: 4,
            // Always exactly ROWS_BOX_HEIGHT (~5 rows) unless the field
            // sits too close to the bottom of the viewport for that to fit
            // (see the useLayoutEffect above) — scrolling within this box
            // reveals the rest (onResultsScroll fetches + appends the next
            // page near the bottom, same infinite-scroll pattern as the
            // plain dropdown above), rather than the box growing to fit
            // every item.
            maxHeight: coords.maxHeight,
            // The scroll itself stays fully functional (mouse wheel,
            // trackpad, touch, arrow keys) — only its own visible bar is
            // hidden (.no-scrollbar, app.css) per "the scroll bar is not
            // required in this dropdown". overflowY must still be
            // scroll-capable, just not auto (which can omit the scrollbar
            // in Firefox's `thin` mode when content only just fits, but
            // that's incidental — the visual hiding is the CSS class).
            overflowY: "auto",
            zIndex: 1000,
          }}
        >
          {resultsBody}
        </div>,
        document.body
      )}
    </div>
  );
}
