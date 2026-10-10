import React, { useMemo, useState } from "react";
import { View } from "react-native";
import { FlatHeader, GroupedFilter, PillButton, Screen, SearchInput, ServerFlatList, emptyGroupedFilter, gfDate, gfValues, toast, type GFSection, type GroupedFilterValue } from "@/common/components/ui";
import { useServerList } from "@/common/hooks/use-server-list";
import { listCashMovementsPage } from "@/modules/cash/services/cashService";
import { isUserCancel, userMessage } from "@/common/services/apiErrors";
import { listBranchesPage } from "@/modules/branches/services/branchService";
import { listCustomersPage } from "@/modules/customers/services/customerService";
import { shareMovementsPdf } from "@/common/utils/ledgerExport";
import { useExpenseCategoryIds } from "@/common/components/LedgerList";
import { MOVEMENT_TYPE_OPTIONS, movementFilterCount, runningBalances, type MovementFilters } from "@/common/components/movementLedger";
import { MovementRow } from "@/common/components/MovementRow";
import type { CashMovement } from "@/modules/cash/types/cash-types";
import { useAuth } from "@/common/providers/AuthProvider";

// Reports → "Ledger / Statement Export" — the web's LedgerExportView as its
// own page, opened from the Reports list (it used to jump to the Ledger
// module's Movements tab, which left Reports). Back returns to Reports. Same
// rows, running balance and Branch / Customer / Type / Date filters as the
// Ledger page (shared via MovementLedger), grouped behind one Filters bar;
// Export downloads exactly what the filters show, as a PDF or Excel sheet.

const SECTIONS: GFSection[] = [
  {
    kind: "async",
    key: "branch",
    label: "Branch",
    fetchPage: (p) => listBranchesPage({ q: p.q, limit: p.limit, offset: p.offset }).then((r) => ({ items: r.items.map((b) => ({ value: String(b.id), label: b.name })), hasMore: r.hasMore })),
  },
  { kind: "static", key: "type", label: "Type", options: MOVEMENT_TYPE_OPTIONS },
  { kind: "date", key: "date", label: "Date" },
];

export default function LedgerStatementScreen() {
  const [fv, setFv] = useState<GroupedFilterValue>(emptyGroupedFilter());
  // Customer narrows to the selected branches (a customer has one home branch).
  const branchIds = gfValues(fv, "branch").map(Number);
  const sections = useMemo<GFSection[]>(
    () => [
      SECTIONS[0],
      {
        kind: "async",
        key: "customer",
        label: "Customer",
        deps: [branchIds.join(",")],
        fetchPage: (p) =>
          listCustomersPage({ q: p.q, limit: p.limit, offset: p.offset, ...(branchIds.length ? { branchIds } : {}) }).then((r) => ({ items: r.items.map((c) => ({ value: String(c.id), label: c.code ? `${c.name} (${c.code})` : c.name })), hasMore: r.hasMore })),
      },
      SECTIONS[1],
      SECTIONS[2],
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [branchIds.join(",")]
  );
  const filters = useMemo<MovementFilters>(
    () => ({
      branchIds,
      customerIds: gfValues(fv, "customer").map(Number),
      types: gfValues(fv, "type"),
      fromDate: gfDate(fv, "date").from,
      toDate: gfDate(fv, "date").to,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [fv]
  );
  const filterCount = movementFilterCount(filters);

  const list = useServerList<CashMovement, MovementFilters>({
    key: ["cash-movements", "statement"],
    fetchPage: (p) => listCashMovementsPage(p),
    filters,
  });
  const balances = useMemo(() => runningBalances(list.items), [list.items]);
  const categoryIds = useExpenseCategoryIds();

  const [exporting, setExporting] = useState(false);
  const canExport = useAuth().can("Ledger_Export", "can_export_ledger");
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
    >
      <ServerFlatList
        list={list}
        items={list.items}
        keyOf={(m) => `m${m.id}`}
        emptyText={list.search || filterCount ? "No entries match your filters." : "No ledger entries yet."}
        header={
          <View style={{ paddingTop: 12 }}>
            <SearchInput value={list.search} onChangeText={list.setSearch} placeholder="Search by purpose or source" style={{ paddingBottom: 8 }} />
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
              <GroupedFilter title="Filter Statement" sections={sections} value={fv} onChange={setFv} />
              <View style={{ flex: 1 }} />
              {canExport ? (
                <>
                  <PillButton label="Export Excel" onPress={() => onExport("xlsx")} />
                  <PillButton label="Export PDF" onPress={() => onExport("pdf")} />
                </>
              ) : null}
            </View>
          </View>
        }
        renderItem={(m, i) => <MovementRow m={m} balance={balances[i] ?? 0} categoryIds={categoryIds} defaultOpen={i === 0} />}
      />

    </Screen>
  );
}
