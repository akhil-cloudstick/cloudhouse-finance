"use client";

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

export type SearchPage<T> = { items: T[]; hasMore: boolean };

// Matches app.css's .gs-results row height (37px) and padding so the box shows exactly 5 items before scrolling.
const ROW_HEIGHT = 37;
const VISIBLE_ROWS = 5;
const ROWS_BOX_HEIGHT = ROW_HEIGHT * VISIBLE_ROWS + 12;

type SearchableSelectProps<T> = {
  value: string;
  onChange: (id: string, item: T) => void;
  fetchFn: (query: string, page: number) => Promise<SearchPage<T>>;
  getLabel: (item: T) => string;
  // Optional richer rendering for a result row only; getLabel still drives the input's text (plain input, no markup) and the exact-match check.
  renderLabel?: (item: T) => ReactNode;
  getId: (item: T) => string;
  placeholder?: string;
  // Hover tooltip (native title) listing which fields the search matches.
  searchHint?: string;
  allowCreate?: boolean;
  onCreate?: (query: string) => Promise<T>;
  // Separate from allowCreate/onCreate: renders one persistent row at the bottom for opening a full create form instead of creating from typed text.
  onCreateNew?: () => void;
  createNewLabel?: string;
  disabled?: boolean;
  /** Custom row content in place of plain bold getLabel text; getLabel still drives the input's displayed text and the exact-match check. */
  renderOption?: (item: T) => ReactNode;
  compact?: boolean;
  /** Per-caller dropdown width floor for compact mode; ignored unless compact is true. */
  compactMinWidth?: number;
  // Floats the list in a document.body portal (position:fixed) for pickers inside a scrolling modal body that would otherwise clip it.
  portal?: boolean;
};

/**
 * Text-input + dropdown combobox backed by a server-side, paginated search function.
 *
 * - Pages are 0-based and fixed size (5); the backend reports hasMore so this never guesses from a short page.
 * - Empty query loads page 0 immediately (a listing, not a search); a typed query debounces ~300ms.
 * - Scrolling near the bottom of the open list fetches and appends the next page (infinite scroll).
 * - A monotonically increasing request id discards stale responses.
 * - In allowCreate mode, a non-exact-match query shows a "+ Create '<query>'" row that calls onCreate.
 * - `compact` (PurityPicker's search half, as narrow as ~34px): portals the list to document.body,
 *   position:fixed, width clamped 60-160px, opens only downward, capped to 5 rows, scrollbar hidden.
 */
export function SearchableSelect<T>({
  value,
  onChange,
  fetchFn,
  getLabel,
  renderLabel,
  getId,
  placeholder,
  searchHint,
  allowCreate = false,
  onCreate,
  onCreateNew,
  createNewLabel = "+ Add new",
  disabled,
  renderOption,
  compact = false,
  compactMinWidth = 60,
  portal = false,
}: SearchableSelectProps<T>) {
  const floating = compact || portal;
  const [query, setQuery] = useState(value);
  // Separate from `query`: fetching off query directly meant a box opened with an existing selection flashed "No results" filtered by that leftover text.
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
  const [coords, setCoords] = useState<{ top: number; left: number; width: number; maxHeight: number } | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestIdRef = useRef(0);
  // Tracks the query the open dropdown last fetched for, so re-focusing without typing doesn't re-fire.
  const loadedForRef = useRef<string | null>(null);
  // -1 = nothing highlighted. Index space covers items, then the "+ Create" row as one extra slot.
  const [highlightedIndex, setHighlightedIndex] = useState(-1);

  // Keeps the visible text in sync if the parent changes `value` externally (e.g. form reset).
  useEffect(() => {
    setQuery(value);
  }, [value]);

  function loadPage(q: string, p: number, reqId: number, append: boolean) {
    const setBusy = append ? setLoadingMore : setLoading;
    setBusy(true);
    // A fresh page invalidates the highlight; an appended page (infinite scroll/prefetch) must not reset it mid-navigation.
    if (!append) setHighlightedIndex(-1);
    fetchFn(q, p)
      .then((result) => {
        if (reqId !== requestIdRef.current) return; // stale response — discard
        setItems((prev) => (append ? [...prev, ...result.items] : result.items));
        setHasMore(result.hasMore);
        setPage(p);
        // Pre-highlight the first result so Enter works immediately after typing, without requiring an arrow key first.
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

  // An empty search term fetches immediately (a listing, not a search); a non-empty one debounces.
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

  // Scrolling near the bottom of the loaded list fetches and appends the next page (both modes).
  function onResultsScroll() {
    const el = resultsRef.current;
    if (!el) return;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 48) loadNextPage();
  }

  // A 5-row box and a 5-item page exactly fill to the cap without overflowing, so scroll-triggered paging never fires — prefetch one extra page right after render to break that deadlock; stops itself once the box overflows or pages run out.
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
      // resultsRef lives in a document.body portal, so it's not a descendant of boxRef — check it separately or a result click reads as "outside".
      if (boxRef.current?.contains(target)) return;
      if (resultsRef.current?.contains(target)) return;
      setOpen(false);
    }
    document.addEventListener("click", onDocClick);
    return () => document.removeEventListener("click", onDocClick);
  }, []);

  // Belt-and-braces alongside onBlur: relatedTarget isn't reliably populated on blur in every browser, so a document-level focusin listener catches Tab-away cases blur alone misses.
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

  // Recomputes the portal's fixed position while open; listens with capture:true since the scrolling ancestor is unknown from here.
  // Always opens downward (never flips above the input) with maxHeight capped to remaining space, so it never grows past the viewport or looks detached from its field.
  useLayoutEffect(() => {
    if (!floating || !open) return;
    function reposition() {
      const el = boxRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const spaceBelow = window.innerHeight - rect.bottom;
      // Caps at ROWS_BOX_HEIGHT (~5 rows); shrinks only when the field is too close to the viewport bottom, with 120 as the usable floor.
      const maxHeight = Math.min(ROWS_BOX_HEIGHT, Math.max(120, spaceBelow - 8));
      // Clamps left so the dropdown never runs past the right edge of the viewport (e.g. a field near a modal's right edge).
      const width = compact ? Math.min(Math.max(rect.width, compactMinWidth), 160) : rect.width;
      const left = Math.min(rect.left, window.innerWidth - width - 16);
      setCoords({ top: rect.bottom, left, width: rect.width, maxHeight });
    }
    reposition();
    // Closes on scroll outside the results list instead of repositioning (see Select.tsx's identical fix) — a re-anchored portal mid-scroll looks detached.
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
  }, [floating, compact, open]);

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
        // Stops this from also reaching an ancestor's Enter/keydown handler (e.g. Modal.tsx's onModalKeyDown) — preventDefault alone doesn't stop other listeners.
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
      // Forget the loaded list so the next open refetches instead of reusing one missing the created item.
      loadedForRef.current = null;
      onChange(getId(created), created);
      setQuery(getLabel(created));
      setOpen(false);
    } finally {
      setCreating(false);
    }
  }

  const exactMatch = items.some((it) => getLabel(it).toLowerCase() === query.trim().toLowerCase());
  const showCreateRow = allowCreate && query.trim().length > 0 && !exactMatch && !loading;

  // Pinned to the top of the results list — a standing action, not one more search result.
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
          // Not a real Tab stop — picked via click or onInputKeyDown only, so Tab moves straight to the next field.
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
        title={searchHint}
        value={query}
        disabled={disabled}
        autoComplete="off"
        onChange={(e) => { setQuery(e.target.value); setSearchTerm(e.target.value); setOpen(true); }}
        onFocus={() => { setSearchTerm(""); setOpen(true); }}
        onKeyDown={onInputKeyDown}
        // Closes on any focus-leave (not just outside clicks), guarded by relatedTarget so clicking a result doesn't close before its onClick fires pick().
        onBlur={(e) => {
          if (resultsRef.current?.contains(e.relatedTarget as Node)) return;
          setOpen(false);
        }}
      />
      {/* Visual dropdown cue matching Select.tsx's chevron; skipped in compact mode where there's no room for it. */}
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
      {/* Inline dropdown, capped to ROWS_BOX_HEIGHT (~5 rows, matching the page size) instead of app.css's generic 420px, so it overflows (and pages) once a 6th result exists. */}
      {!floating && open && (
        <div
          ref={resultsRef}
          className="gs-results open"
          style={{ maxHeight: ROWS_BOX_HEIGHT }}
          onScroll={onResultsScroll}
        >
          {resultsBody}
        </div>
      )}
      {/* compact/portal mode: fixed-position, capped-size dropdown. */}
      {floating && open && coords && createPortal(
        <div
          ref={resultsRef}
          className={compact ? "gs-results open no-scrollbar" : "gs-results open"}
          onScroll={onResultsScroll}
          // Every property gets an explicit value (incl. "off" ones) since an undefined one drops out of the style attribute and lets the .gs-results class win, which under position:fixed resolves `top` wrong.
          style={{
            position: "fixed",
            top: coords.top,
            left: coords.left,
            right: "auto",
            // Clamped (not floored) between compactMinWidth and 160px so labels don't clip and the box doesn't outgrow its field.
            width: compact ? Math.min(Math.max(coords.width, compactMinWidth), 160) : coords.width,
            marginTop: 4,
            maxHeight: coords.maxHeight,
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
