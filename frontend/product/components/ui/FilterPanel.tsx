"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "@/product/components/Icon";
import { DatePicker } from "@/product/components/ui/DatePicker";
import { fmtDate } from "@/product/utils/format";

// This popover's own "narrow" breakpoint — deliberately its own hook rather
// than the app-wide useIsSmallScreen (<1560px, used for page density
// elsewhere): that threshold covers ordinary laptop windows, and switching
// this popover's rail to a horizontal row of tabs at that width (instead of
// its normal ~130-150px left column) made the popover wide enough to clip
// off the right edge of the viewport on exactly those laptop sizes (see the
// bug this replaced). The row layout is only actually needed at true
// phone widths, where a left-column rail wouldn't leave room for the
// option list beside it.
function useIsNarrowPopover(): boolean {
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    function check() { setNarrow(window.innerWidth < 640); }
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);
  return narrow;
}

// Every section's pane is at least as tall as the option-list sections (search
// box + 200px list + padding), so the popover keeps one height when switching
// between Branch, Customer, Type and Date.
const FILTER_BODY_MIN_HEIGHT = 262;

export type FilterOption = { value: string; label: string };

export type FilterCategory =
  | { key: string; label: string; kind: "static"; options: FilterOption[]; singleSelect?: boolean; searchHint?: string }
  | {
      key: string;
      label: string;
      kind: "async";
      singleSelect?: boolean;
      // Hover tooltip on the search box listing which fields fetchOptions matches.
      searchHint?: string;
      // Backend-driven — called with the current sub-category search text and
      // a page number; never resolves against a client-side full list.
      fetchOptions: (search: string, page: number) => Promise<{ items: FilterOption[]; hasMore: boolean }>;
    }
  | { key: string; label: string; kind: "date" };

export type FilterValue = { __dateFrom?: string; __dateTo?: string; [categoryKey: string]: string[] | string | undefined };

function categoryValues(value: FilterValue, key: string): string[] {
  const v = value[key];
  return Array.isArray(v) ? v : [];
}

/* One category's right-hand option list — search box (client-side filter for
 * "static" categories, server-side query for "async" ones) plus a scrolling,
 * paginated checkbox list for "async" categories so a Branch/Customer picker
 * never has to load its full backend table just to render a filter. */
function CategoryOptionList({
  category,
  selected,
  onToggle,
  onOptionsLoaded,
}: {
  category: FilterCategory;
  selected: string[];
  onToggle: (value: string) => void;
  // Reports every async option this list ever loads back up to FilterPanel,
  // so a selected chip can resolve its label from a page the user already
  // scrolled/searched past instead of just showing the raw id — an async
  // category (e.g. a Customer picker) has no static options list to look a
  // label up in otherwise.
  onOptionsLoaded?: (items: FilterOption[]) => void;
}) {
  const [search, setSearch] = useState("");
  const [asyncItems, setAsyncItems] = useState<FilterOption[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  const isAsync = category.kind === "async";

  const loadPage = useCallback((p: number, term: string, append: boolean) => {
    if (category.kind !== "async") return;
    setLoading(true);
    category
      .fetchOptions(term, p)
      .then(({ items, hasMore: more }) => {
        setAsyncItems((prev) => (append ? [...prev, ...items] : items));
        setHasMore(more);
        onOptionsLoaded?.(items);
      })
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [category]);

  useEffect(() => {
    if (!isAsync) return;
    setPage(1);
    loadPage(1, search, false);
    // loadPage (not just category.key/search) is a dependency on purpose —
    // its own identity changes whenever `category` does (see its useCallback
    // above), which is what makes this refire when a caller's fetchOptions
    // closure changes to reflect new outside state (e.g. Cash.tsx's Customer
    // picker re-querying once the Branch section's selection changes) even
    // though category.key stays "customer" the whole time. Without this, a
    // cross-filtering async category kept its first-loaded, now-stale page
    // until the user switched tabs away and back or typed in its search box.
  }, [isAsync, category.key, search, loadPage]);

  function onScroll() {
    const el = listRef.current;
    if (!el || category.kind !== "async" || loading || !hasMore) return;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 24) {
      const next = page + 1;
      setPage(next);
      loadPage(next, search, true);
    }
  }

  if (category.kind === "date") return null;

  const options: FilterOption[] =
    category.kind === "static"
      ? category.options.filter((o) => o.label.toLowerCase().includes(search.toLowerCase()))
      : asyncItems;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, minWidth: 0 }}>
      <input
        className="inp"
        style={{ fontSize: 13 }}
        placeholder={`Search ${category.label.toLowerCase()}…`}
        title={category.searchHint || `Searches: ${category.label.toLowerCase()}`}
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />
      <div
        ref={listRef}
        onScroll={onScroll}
        className="no-scrollbar"
        style={{ display: "flex", flexDirection: "column", gap: 2, maxHeight: 200, overflowY: "auto" }}
      >
        {options.length === 0 && !loading ? (
          <div style={{ fontSize: 12.5, color: "var(--muted)", padding: "8px 4px" }}>No options found.</div>
        ) : (
          options.map((o) => (
            <label key={o.value} className="ccheck" style={{ padding: "4px 4px", fontSize: 13 }}>
              <input type="checkbox" checked={selected.includes(o.value)} onChange={() => onToggle(o.value)} />
              <span className="mark" />
              <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontWeight: 400 }}>{o.label}</span>
            </label>
          ))
        )}
        {loading && <div style={{ fontSize: 12, color: "var(--muted)", padding: "6px 4px" }}>Loading…</div>}
      </div>
    </div>
  );
}

/**
 * Single icon button that opens a grouped multi-category filter panel — a
 * left column of categories and a right column of that category's
 * searchable, checkable options. Selected values persist across category
 * switches and render as removable chips once the panel is closed, so it's
 * always visible at a glance which filters are active.
 *
 * The panel is a small, capped-width card (never the app's full-width
 * `.gs-results` search-result panel, which read as a giant, unstyled
 * overflowing box once repurposed here) — on narrow screens it drops the
 * two-column layout for a single stacked column so nothing overflows the
 * viewport or gets clipped by an ancestor's overflow:hidden.
 */
export function FilterPanel({
  categories,
  value,
  onChange,
  size = "sm",
  hideClearAll,
}: {
  categories: FilterCategory[];
  value: FilterValue;
  onChange: (next: FilterValue) => void;
  // Selected filters are never listed outside the popover; their names show
  // beside each category inside it. Kept so existing callers still compile.
  hideChips?: boolean;
  // "sm" (default) suits a card header; "md" matches full-size page-header
  // buttons beside it (e.g. LedgerExportView's Export PDF / Export XL).
  size?: "sm" | "md";
  // Drops the standalone "Clear all ×" button beside the filter icon — the
  // popover's own "Reset all filters" button is then the only reset.
  hideClearAll?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [activeKey, setActiveKey] = useState(categories[0]?.key || "");
  const boxRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [panelPos, setPanelPos] = useState<{ top: number; left: number } | null>(null);
  const smallScreen = useIsNarrowPopover();
  // value -> label for async options seen so far, keyed "categoryKey:value" —
  // lets a selected chip show the picked name (e.g. "PRIYA K K (CUST-02)")
  // instead of the raw id an async category's value actually is.
  const [asyncLabels, setAsyncLabels] = useState<Record<string, string>>({});
  const rememberAsyncLabels = useCallback((categoryKey: string, items: FilterOption[]) => {
    setAsyncLabels((prev) => {
      const next = { ...prev };
      let changed = false;
      for (const o of items) {
        const k = `${categoryKey}:${o.value}`;
        if (next[k] !== o.label) { next[k] = o.label; changed = true; }
      }
      return changed ? next : prev;
    });
  }, []);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node) && panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("click", onDocClick);
    return () => document.removeEventListener("click", onDocClick);
  }, []);

  useEffect(() => {
    if (!open) return;
    function updatePos() {
      const el = boxRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const panelWidth = smallScreen ? Math.min(340, window.innerWidth - 32) : 400;
      // Opens toward the trigger's left (right edge of the panel lines up
      // with the trigger's right edge) — the button almost always sits at
      // the right end of a filter bar (Reports/Ledger/Cash all right-align
      // it), so anchoring from the left edge used to push most of the
      // panel off-screen; clamped to a 16px viewport margin on both sides.
      const left = Math.max(16, Math.min(r.right - panelWidth, window.innerWidth - panelWidth - 16));
      setPanelPos({ top: r.bottom + 6, left });
    }
    updatePos();
    // A `position: fixed` popover re-anchored to the trigger's new
    // coordinates on every scroll tick reads as "jumping" while a long
    // page/table scrolls behind it — closing on scroll instead (same as
    // most dropdown menus) avoids that rather than trying to track it
    // smoothly. Resize still repositions, since that isn't a scroll.
    // Scrolling the popover's own option list (CategoryOptionList's
    // internal scroller, needed for its infinite-scroll pagination) must
    // NOT count — the capture-phase listener sees that scroll too, so it's
    // excluded by checking the event target is outside the popover itself.
    function onScroll(e: Event) {
      if (panelRef.current && e.target instanceof Node && panelRef.current.contains(e.target)) return;
      setOpen(false);
    }
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", updatePos);
    return () => {
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", updatePos);
    };
  }, [open, smallScreen]);

  const activeCategory = categories.find((c) => c.key === activeKey) || categories[0];

  const activeCount =
    categories.filter((c) => c.kind !== "date").reduce((n, c) => n + categoryValues(value, c.key).length, 0) +
    (value.__dateFrom || value.__dateTo ? 1 : 0);

  function toggle(category: FilterCategory, optionValue: string) {
    const cur = categoryValues(value, category.key);
    const singleSelect = category.kind !== "date" && category.singleSelect;
    if (singleSelect) {
      onChange({ ...value, [category.key]: cur.includes(optionValue) ? [] : [optionValue] });
      return;
    }
    const next = cur.includes(optionValue) ? cur.filter((v) => v !== optionValue) : [...cur, optionValue];
    onChange({ ...value, [category.key]: next });
  }

  function resetAll() {
    onChange({});
  }

  // Resolves a chip's display label back from its category's static options,
  // or — for an async category — from asyncLabels, the running cache of
  // every option that category's picker has loaded so far. Falls back to
  // the raw value only if that option was never actually seen (shouldn't
  // happen for a value the user picked from this same picker).
  function chipLabel(cat: FilterCategory, v: string): string {
    if (cat.kind === "static") return cat.options.find((o) => o.value === v)?.label || v;
    return asyncLabels[`${cat.key}:${v}`] || v;
  }

  const panelWidth = smallScreen ? Math.min(340, typeof window !== "undefined" ? window.innerWidth - 32 : 340) : 400;

  return (
    <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, minWidth: 0 }}>
      <div className="dp" ref={boxRef}>
        <button type="button" className={size === "sm" ? "btn ghost sm" : "btn ghost"} onClick={() => setOpen((o) => !o)} title="Filters" aria-label="Filters">
          <Icon name="filter" />
          {activeCount > 0 && <span className="filter-badge">{activeCount}</span>}
        </button>
        {open && panelPos && (
          <div
            ref={panelRef}
            className="filter-popover"
            style={{ position: "fixed", top: panelPos.top, left: panelPos.left, width: panelWidth, zIndex: 60 }}
          >
            {/* Reset lives in a header row, not a footer — a footer was clipped off
             * the bottom of short screens. */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "6px 8px 6px 12px", borderBottom: "1px solid var(--line)" }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: "var(--muted)", letterSpacing: ".04em", textTransform: "uppercase" }}>Filters</span>
              {activeCount > 0 && <button type="button" className="btn plain sm" onClick={resetAll}>Reset</button>}
            </div>
            <div style={{ display: "flex", flexDirection: smallScreen ? "column" : "row" }}>
              <div
                className="filter-rail"
                style={{
                  display: "flex",
                  flexDirection: smallScreen ? "row" : "column",
                  overflowX: smallScreen ? "auto" : "visible",
                  overflowY: "visible",
                  flexShrink: 0,
                  flexWrap: smallScreen ? "nowrap" : undefined,
                  minWidth: smallScreen ? 0 : 130,
                  maxWidth: smallScreen ? "none" : 150,
                  gap: smallScreen ? 4 : 2,
                  padding: 6,
                  background: "var(--brand-faint, var(--line))",
                  borderRight: smallScreen ? "none" : "1px solid var(--line)",
                  borderBottom: smallScreen ? "1px solid var(--line)" : "none",
                }}
              >
                {/* Every category always renders here — none are ever
                 * dropped — so the rail never shows "only half" the
                 * sections; a category simply scrolls into view if the
                 * list is taller than the popover on a short screen. */}
                {categories.map((c) => {
                  // Per-section selected count — Date counts as 0/1 (whether
                  // either bound is set), every other kind counts its
                  // selected values array, so the rail always shows at a
                  // glance how many of each section's options are active
                  // without opening it.
                  const count = c.kind === "date" ? (value.__dateFrom || value.__dateTo ? 1 : 0) : categoryValues(value, c.key).length;
                  return (
                    <button
                      key={c.key}
                      type="button"
                      className="filter-rail-btn"
                      style={{
                        whiteSpace: "nowrap",
                        flexShrink: 0,
                        display: "flex",
                        alignItems: "center",
                        gap: 6,
                        background: c.key === activeKey ? "var(--brand-deep)" : "transparent",
                        color: c.key === activeKey ? "#fff" : "var(--fg)",
                        fontWeight: c.key === activeKey ? 700 : 500,
                      }}
                      onClick={() => setActiveKey(c.key)}
                    >
                      <span>{c.label}</span>
                      {count > 0 && (
                        <span
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            justifyContent: "center",
                            minWidth: 17,
                            height: 17,
                            padding: "0 4px",
                            borderRadius: 99,
                            fontSize: 10.5,
                            fontWeight: 700,
                            background: c.key === activeKey ? "rgba(255,255,255,.25)" : "var(--brand-deep)",
                            color: "#fff",
                          }}
                        >
                          {count}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
              <div style={{ padding: 10, minWidth: 0, flex: 1, boxSizing: "border-box", minHeight: smallScreen ? undefined : FILTER_BODY_MIN_HEIGHT }}>
                {activeCategory?.kind === "date" ? (
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    <DatePicker value={value.__dateFrom || ""} onChange={(v) => onChange({ ...value, __dateFrom: v })} placeholder="From…" max={value.__dateTo || undefined} />
                    <DatePicker value={value.__dateTo || ""} onChange={(v) => onChange({ ...value, __dateTo: v })} placeholder="To…" min={value.__dateFrom || undefined} />
                  </div>
                ) : activeCategory ? (
                  <CategoryOptionList
                    category={activeCategory}
                    selected={categoryValues(value, activeCategory.key)}
                    onToggle={(v) => toggle(activeCategory, v)}
                    onOptionsLoaded={(items) => rememberAsyncLabels(activeCategory.key, items)}
                  />
                ) : null}
              </div>
            </div>
          </div>
        )}
      </div>

      {activeCount > 0 && !hideClearAll && (
        <button type="button" className="btn plain sm" onClick={resetAll} style={{ color: "var(--muted)" }}>
          Clear all ×
        </button>
      )}
    </div>
  );
}
