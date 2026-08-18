"use client";

import { useEffect, useRef, useState } from "react";

export type SearchPage<T> = { items: T[]; hasMore: boolean };

/**
 * A text-input + dropdown combobox backed by a server-side, paginated
 * search function, matching the app's existing `.inp` input styling (see
 * modals/* and GlobalSearch.tsx) rather than a plain native `<select>`.
 *
 * - `fetchFn(query, page)` is called with 0-based pages; each page is a
 *   fixed size (5 — see customersApi.ts/schemesApi.ts/bankApi.ts's page
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
  disabled,
}: {
  value: string;
  onChange: (id: string, item: T) => void;
  fetchFn: (query: string, page: number) => Promise<SearchPage<T>>;
  getLabel: (item: T) => string;
  getId: (item: T) => string;
  placeholder?: string;
  allowCreate?: boolean;
  onCreate?: (query: string) => Promise<T>;
  disabled?: boolean;
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

  function onResultsScroll() {
    const el = resultsRef.current;
    if (!el) return;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 48) loadNextPage();
  }

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("click", onDocClick);
    return () => document.removeEventListener("click", onDocClick);
  }, []);

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
      {open && (
        <div
          ref={resultsRef}
          className="gs-results open"
          style={{ position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0, zIndex: 50, maxHeight: 260, overflowY: "auto" }}
          onScroll={onResultsScroll}
        >
          {loading ? (
            <div className="gs-none">Searching…</div>
          ) : items.length === 0 && !showCreateRow ? (
            <div className="gs-none">No results</div>
          ) : (
            <>
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
          )}
        </div>
      )}
    </div>
  );
}
