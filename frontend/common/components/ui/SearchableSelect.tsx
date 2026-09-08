"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
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
  getId,
  placeholder,
  allowCreate = false,
  onCreate,
  onCreateNew,
  createNewLabel = "+ Add new",
  disabled,
  compact = false,
  compactMinWidth = 60,
}: {
  value: string;
  onChange: (id: string, item: T) => void;
  fetchFn: (query: string, page: number) => Promise<SearchPage<T>>;
  getLabel: (item: T) => string;
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

  // Keep the visible text in sync if the parent changes `value` externally
  // (e.g. resetting the form) without the user typing.
  useEffect(() => {
    setQuery(value);
  }, [value]);

  function loadPage(q: string, p: number, reqId: number, append: boolean) {
    const setBusy = append ? setLoadingMore : setLoading;
    setBusy(true);
    fetchFn(q, p)
      .then((result) => {
        if (reqId !== requestIdRef.current) return; // stale response — discard
        setItems((prev) => (append ? [...prev, ...result.items] : result.items));
        setHasMore(result.hasMore);
        setPage(p);
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
      setCoords({ top: rect.bottom, left: rect.left, width: rect.width, maxHeight });
    }
    reposition();
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    return () => {
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
    };
  }, [compact, open]);

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
      {items.map((item) => (
        <a
          key={getId(item)}
          href="#"
          onClick={(e) => { e.preventDefault(); pick(item); }}
        >
          <span className="tx"><b>{getLabel(item)}</b></span>
        </a>
      ))}
      {loadingMore && <div className="gs-none">Loading more…</div>}
      {showCreateRow && (
        <a
          href="#"
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
        className="inp"
        placeholder={placeholder}
        value={query}
        disabled={disabled}
        autoComplete="off"
        onChange={(e) => { setQuery(e.target.value); setSearchTerm(e.target.value); setOpen(true); }}
        onFocus={() => { setSearchTerm(""); setOpen(true); }}
      />
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
