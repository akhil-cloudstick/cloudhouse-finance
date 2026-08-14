"use client";

import { useState } from "react";
import { SearchableSelect } from "@/components/SearchableSelect";
import { searchPurityStandardsPage, createPurityStandardByKarat, createPurityStandardByFineness, type BackendPurityStandard } from "@/lib/purityStandardApi";
import { formatPurity, parsePurity, isKaratInRange, isFinenessInRange, MIN_KARAT, MAX_KARAT, MAX_FINENESS_PERCENT, type PurityUnit } from "@/lib/purity";

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
export function PurityPicker({ value, onChange, disabled }: { value: string; onChange: (value: string) => void; disabled?: boolean }) {
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
    <div style={{ maxWidth: 210 }}>
      <div style={{ display: "flex", gap: 6, alignItems: "stretch" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 2, flex: 1, minWidth: 0 }}>
          <button
            type="button"
            className={`btn plain sm${unit === "karat" ? " active" : ""}`}
            style={{ padding: "2px 6px", fontWeight: unit === "karat" ? 700 : 400, whiteSpace: "nowrap", lineHeight: 1.3, width: "100%", flex: 1, minHeight: 0 }}
            disabled={disabled}
            onClick={() => setUnit("karat")}
          >
            Karat
          </button>
          <button
            type="button"
            className={`btn plain sm${unit === "fineness" ? " active" : ""}`}
            style={{ padding: "2px 6px", fontWeight: unit === "fineness" ? 700 : 400, whiteSpace: "nowrap", lineHeight: 1.3, width: "100%", flex: 1, minHeight: 0 }}
            disabled={disabled}
            onClick={() => setUnit("fineness")}
          >
            Fineness %
          </button>
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <SearchableSelect<BackendPurityStandard>
            value={label}
            onChange={pick}
            fetchFn={fetchFn}
            getLabel={getLabel}
            getId={(p) => String(p.id)}
            placeholder={unit === "karat" ? `e.g. 22 (${MIN_KARAT}-${MAX_KARAT})` : "e.g. 91.6"}
            allowCreate
            onCreate={onCreate}
            disabled={disabled}
          />
        </div>
      </div>
      {rangeError && <p style={{ color: "var(--red)", fontSize: 12, margin: "4px 0 0" }}>{rangeError}</p>}
    </div>
  );
}
