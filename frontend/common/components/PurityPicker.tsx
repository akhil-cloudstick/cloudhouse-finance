"use client";

import { useState } from "react";
import { useToast } from "@/common/components/ToastProvider";
import { SearchableSelect } from "@/common/components/ui/SearchableSelect";
import { searchPurityStandardsPage, createPurityStandardByKarat, createPurityStandardByFineness } from "@/modules/purity-standards/services/purityStandardService";
import { type BackendPurityStandard } from "@/modules/purity-standards/types/purity-standard-types";
import { formatPurity, parsePurity, isKaratInRange, isFinenessInRange, MIN_KARAT, MAX_KARAT, MAX_FINENESS_PERCENT, type PurityUnit } from "@/common/utils/purity";

type PurityPickerProps = {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  // Forwarded to SearchableSelect's compactMinWidth.
  dropdownMinWidth?: number;
};

// Switching the unit toggle does NOT recompute `value` — it just changes which list is searched/created against.
export function PurityPicker({
  value,
  onChange,
  disabled,
  dropdownMinWidth = 60,
}: PurityPickerProps) {
  const toast = useToast();
  const parsed = parsePurity(value);
  const [unit, setUnit] = useState<PurityUnit>(parsed?.unit ?? "karat");

  const label = parsed && parsed.unit === unit ? String(parsed.value) : "";

  async function fetchFn(q: string, page: number) {
    const result = await searchPurityStandardsPage(q, page);
    const term = q.trim();
    const items = result.items
      .filter((p) => (unit === "karat" ? p.karat != null : p.finenessPercent != null))
      // The server matches the whole purity label (e.g. "24K (99.9%)"), so a typed "10"
      // also brings back 24. Keep only entries whose number starts with what was typed.
      .filter((p) => !term || getLabel(p).startsWith(term));
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

  // A purity typed but never confirmed (no Enter / click) is still taken when the field loses focus,
  // so the loan is not saved with the previous purity. Out-of-range or non-numeric text is ignored.
  function commitTyped(text: string) {
    const num = Number(text);
    if (!Number.isFinite(num)) return;
    if (unit === "karat" ? !isKaratInRange(num) : !isFinenessInRange(num)) return;
    onChange(formatPurity(unit, num));
  }

  async function onCreate(query: string): Promise<BackendPurityStandard> {
    const num = Number(query.trim());
    // Shown as a toast rather than inside the dropdown, where the text got truncated.
    const problem = !Number.isFinite(num)
      ? `Enter a valid gold ${unit === "karat" ? "karat" : "fineness %"}.`
      : unit === "karat" && !isKaratInRange(num)
        ? `Enter a valid gold karat. Minimum is ${MIN_KARAT} and maximum is ${MAX_KARAT}.`
        : unit === "fineness" && !isFinenessInRange(num)
          ? `Enter a valid fineness %. It must be above 0 and at most ${MAX_FINENESS_PERCENT}.`
          : null;
    if (problem) {
      toast(problem);
      throw new Error(problem);
    }
    if (unit === "karat") return createPurityStandardByKarat(num);
    return createPurityStandardByFineness(num);
  }

  // Mirrors backend puritystandard.ValidateKarat/ValidateFineness to avoid a round trip for a 400.
  const typed = Number(label || "0");
  const rangeError =
    label && unit === "karat" && !isKaratInRange(typed)
      ? `Karat must be between ${MIN_KARAT} and ${MAX_KARAT}`
      : label && unit === "fineness" && !isFinenessInRange(typed)
        ? `Fineness% must be greater than 0 and at most ${MAX_FINENESS_PERCENT}`
        : "";

  return (
    <div className="pur-wrap">
      {/* `.pur-row`/`.pur-toggle` (app.css) let narrow layouts stack to two lines; side-by-side clipped "Fineness". */}
      <div className="pur-row">
        <div
          role="tablist"
          aria-label="Purity unit"
          className="pur-toggle"
        >
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
        <div className="purity-select pur-search">
          <SearchableSelect<BackendPurityStandard>
            value={label}
            onChange={pick}
            fetchFn={fetchFn}
            searchHint="Searches: purity label, e.g. 22K (91.6%)"
            getLabel={getLabel}
            getId={(p) => String(p.id)}
            placeholder={unit === "karat" ? `22 (${MIN_KARAT}-${MAX_KARAT})` : "91.6"}
            allowCreate
            onCreate={onCreate}
            onBlurText={commitTyped}
            createLabel="+ XX number"
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
