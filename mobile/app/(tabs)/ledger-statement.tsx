import React, { useMemo, useState } from "react";
import { View } from "react-native";
import { FabMenu, FiltersBar, FlatHeader, Screen, SearchInput, ServerFlatList, toast } from "../../src/components/ui";
import { useServerList } from "../../src/hooks/useServerList";
import { listCashMovementsPage } from "../../src/api/cash";
import { isUserCancel, userMessage } from "../../src/api/errors";
import { dmy } from "../../src/lib/format";
import { shareMovementsPdf } from "../../src/utils/ledgerExport";
import { useExpenseCategoryIds } from "../../src/components/staff/LedgerList";
import {
  EMPTY_MOVEMENT_FILTERS,
  MovementFilterSheet,
  MovementRow,
  movementFilterCount,
  runningBalances,
  type MovementFilters,
} from "../../src/components/staff/MovementLedger";
import type { CashMovement } from "../../src/types/cash";

// Reports → "Ledger / Statement Export" — the web's LedgerExportView as its
// own page, opened from the Reports list (it used to jump to the Ledger
// module's Movements tab, which left Reports). Back returns to Reports. Same
// rows, running balance and Branch / Customer / Type / Date filters as the
// Ledger page (shared via MovementLedger), grouped behind one Filters bar;
// Export downloads exactly what the filters show, as a PDF or Excel sheet.

function filterSummary(f: MovementFilters): string {
  const dates =
    f.fromDate && f.toDate ? `${dmy(f.fromDate)} – ${dmy(f.toDate)}` : f.fromDate ? `From ${dmy(f.fromDate)}` : f.toDate ? `Until ${dmy(f.toDate)}` : "All dates";
  const parts = [
    dates,
    f.branchIds.length ? `${f.branchIds.length} branch${f.branchIds.length === 1 ? "" : "es"}` : null,
    f.customerIds.length ? `${f.customerIds.length} customer${f.customerIds.length === 1 ? "" : "s"}` : null,
    f.types.length ? `${f.types.length} type${f.types.length === 1 ? "" : "s"}` : null,
  ];
  return parts.filter(Boolean).join(" · ");
}

export default function LedgerStatementScreen() {
  const [filters, setFilters] = useState<MovementFilters>(EMPTY_MOVEMENT_FILTERS);
  const [filterOpen, setFilterOpen] = useState(false);
  const filterCount = movementFilterCount(filters);

  const list = useServerList<CashMovement, MovementFilters>({
    key: ["cash-movements", "statement"],
    fetchPage: (p) => listCashMovementsPage(p),
    filters,
  });
  const balances = useMemo(() => runningBalances(list.items), [list.items]);
  const categoryIds = useExpenseCategoryIds();

  const [exporting, setExporting] = useState(false);
  async function onExport(format: "pdf" | "xlsx") {
    if (exporting) return;
    setExporting(true);
    toast.info(format === "pdf" ? "Preparing PDF" : "Preparing Excel", "The statement will open in the share sheet.");
    try {
      await shareMovementsPdf({ ...filters, q: list.search || undefined }, format);
    } catch (e) {
      if (isUserCancel(e)) return;
      toast.error("Export failed", userMessage(e, "Could not export the statement — try again."));
    } finally {
      setExporting(false);
    }
  }

  return (
    <Screen
      header={<FlatHeader title="Ledger / Statement" subtitle="Reports · Financial Statements" back />}
      floating={
        list.items.length > 0 ? (
          <FabMenu
            label="Export statement"
            actions={[
              { label: "Export PDF", icon: "download", onPress: () => onExport("pdf") },
              { label: "Export Excel", icon: "download", onPress: () => onExport("xlsx") },
            ]}
          />
        ) : undefined
      }
    >
      <ServerFlatList
        list={list}
        items={list.items}
        keyOf={(m) => `m${m.id}`}
        emptyText={list.search || filterCount ? "No entries match your filters." : "No ledger entries yet."}
        header={
          <View style={{ paddingTop: 12 }}>
            <SearchInput value={list.search} onChangeText={list.setSearch} placeholder="Search by purpose or source" style={{ paddingBottom: 8 }} />
            <FiltersBar count={filterCount} summary={filterSummary(filters)} onPress={() => setFilterOpen(true)} style={{ marginTop: 0, marginBottom: 10 }} />
          </View>
        }
        renderItem={(m, i) => <MovementRow m={m} balance={balances[i] ?? 0} categoryIds={categoryIds} defaultOpen={i === 0} />}
      />

      <MovementFilterSheet visible={filterOpen} onClose={() => setFilterOpen(false)} value={filters} onChange={setFilters} title="Filter Statement" />
    </Screen>
  );
}
