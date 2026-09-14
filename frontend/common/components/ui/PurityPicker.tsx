"use client";

import { useState } from "react";
import { SearchableSelect } from "@/common/components/ui/SearchableSelect";
import { searchPurityStandardsPage, createPurityStandardByKarat, createPurityStandardByFineness, type BackendPurityStandard } from "@/modules/purity-standards/services/purityStandardService";
import { formatPurity, parsePurity, isKaratInRange, isFinenessInRange, MIN_KARAT, MAX_KARAT, MAX_FINENESS_PERCENT, type PurityUnit } from "@/common/utils/purity";

/* Shared purity-entry control: a Karat/Fineness% toggle plus a
 * SearchableSelect suggest-or-create field against the purity_standards
 * reference table (see backend/internal/puritystandard). Used everywhere
 * purity is entered — NewLoan.tsx's ornament rows, the purity re-test
 * flow, and Dashboard.tsx's gold-value calculator — so all three stay
 * consistent instead of each having its own ad-hoc purity input.
 *
 * `value` is the canonical unit-suffixed string ("22K" / "91.6%", or "").
 * The toggle's initial unit is inferred from `value` if it already parses;
 * otherwise defaults to karat mode. Switching the toggle does NOT
 * recompute `value` into the other unit — it just changes which list
 * staff are searching/creating against, per the user's explicit choice
 * that whichever unit they pick is the one used in the formula. */
export function PurityPicker({
  value,
  onChange,
  disabled,
  dropdownMinWidth = 60,
}: {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  // Forwarded to SearchableSelect's compactMinWidth — Dashboard's Gold Loan
  // Calculator and NewLoan's ornament rows pass 70; every other caller (the
  // purity re-test flow's RateModal) keeps the default 60.
  dropdownMinWidth?: number;
}) {
  const parsed = parsePurity(value);
  const [unit, setUnit] = useState<PurityUnit>(parsed?.unit ?? "karat");

  const label = parsed && parsed.unit === unit ? String(parsed.value) : "";

  async function fetchFn(q: string, page: number) {
    const result = await searchPurityStandardsPage(q, page);
    const items = result.items.filter((p) => (unit === "karat" ? p.karat != null : p.finenessPercent != null));
    return { items, hasMore: false };
  }

  function getLabel(p: BackendPurityStandard) {
    return unit === "karat" ? String(p.karat) : String(p.finenessPercent);
  }

  function pick(_id: string, item: BackendPurityStandard) {
    const num = unit === "karat" ? item.karat : item.finenessPercent;
    if (num == null) return;
    onChange(formatPurity(unit, num));
  }

  async function onCreate(query: string): Promise<BackendPurityStandard> {
    const num = Number(query.trim());
    if (unit === "karat") return createPurityStandardByKarat(num);
    return createPurityStandardByFineness(num);
  }

  // Client-side range validation ahead of the create call — gives
  // immediate feedback instead of round-tripping to the backend for an
  // out-of-range value it will reject with a 400 anyway (see
  // puritystandard.ValidateKarat/ValidateFineness).
  const typed = Number(label || "0");
  const rangeError =
    label && unit === "karat" && !isKaratInRange(typed)
      ? `Karat must be between ${MIN_KARAT} and ${MAX_KARAT}`
      : label && unit === "fineness" && !isFinenessInRange(typed)
        ? `Fineness% must be greater than 0 and at most ${MAX_FINENESS_PERCENT}`
        : "";

  return (
    <div className="pur-wrap">
      {/* Both this Karat/Fineness% slide toggle and the search field beside
       * it are pinned to a Net Wt (g) input's rendered height (padding:6px
       * 8px, font-size:14px, 1px border — see NewLoan.tsx's ornament row)
       * so the table row doesn't grow taller than it needs to for this cell.
       * `.pur-row`/`.pur-toggle` (app.css) carry that shared row layout as
       * real classes rather than inline styles specifically so the two
       * responsive overrides there can stack them onto two lines (toggle
       * above, search field below): a plain max-width:480px window-width
       * rule for a genuinely narrow browser window, and a container query
       * scoped to Dashboard.tsx's `.calc-card` for a caller whose own
       * rendered width is narrow independent of the window (that card sits
       * in the dashboard's sidebar column) — see app.css for both. Side by
       * side (the default here) left "Fineness" clipped to "Finenes" and
       * the search box squeezed to a sliver whenever either condition hit. */}
      <div className="pur-row">
        <div
          role="tablist"
          aria-label="Purity unit"
          className="pur-toggle"
        >
          {/* Sliding thumb — animates between the two halves on unit change. */}
          <div
            aria-hidden
            style={{
              position: "absolute",
              top: 2,
              bottom: 2,
              left: 2,
              width: "calc(50% - 3px)",
              borderRadius: 4,
              background: "var(--brand)",
              transform: unit === "fineness" ? "translateX(calc(100% + 2px))" : "translateX(0)",
              transition: "transform .18s ease",
            }}
          />
          <button
            type="button"
            role="tab"
            aria-selected={unit === "karat"}
            style={{
              position: "relative",
              flex: 1,
              minWidth: 0,
              border: 0,
              background: "transparent",
              cursor: "pointer",
              padding: "0 4px",
              fontSize: 12,
              fontWeight: unit === "karat" ? 700 : 400,
              color: unit === "karat" ? "#fff" : "var(--muted)",
              whiteSpace: "nowrap",
            }}
            disabled={disabled}
            onClick={() => setUnit("karat")}
          >
            Karat
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={unit === "fineness"}
            style={{
              position: "relative",
              flex: 1,
              minWidth: 0,
              border: 0,
              background: "transparent",
              cursor: "pointer",
              padding: "0 4px",
              fontSize: 12,
              fontWeight: unit === "fineness" ? 700 : 400,
              color: unit === "fineness" ? "#fff" : "var(--muted)",
              whiteSpace: "nowrap",
            }}
            disabled={disabled}
            onClick={() => setUnit("fineness")}
          >
            Fineness
          </button>
        </div>
        {/* minWidth:34 is the floor this box should never shrink below
         * (matches the Net Wt/Qty inputs beside it in NewLoan.tsx, which
         * share the same 34×31 minimum). */}
        <div className="purity-select pur-search">
          <SearchableSelect<BackendPurityStandard>
            value={label}
            onChange={pick}
            fetchFn={fetchFn}
            getLabel={getLabel}
            getId={(p) => String(p.id)}
            placeholder={unit === "karat" ? `22 (${MIN_KARAT}-${MAX_KARAT})` : "91.6"}
            allowCreate
            onCreate={onCreate}
            disabled={disabled}
            compact
            compactMinWidth={dropdownMinWidth}
          />
        </div>
      </div>
      {rangeError && <p style={{ color: "var(--red)", fontSize: 12, margin: "4px 0 0" }}>{rangeError}</p>}
    </div>
  );
}
