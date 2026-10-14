import React, { useMemo, useState } from "react";
import { View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { C, FabCorner, FlatHeader, GroupedFilter, Screen, ServerFlatList, Txt, emptyGroupedFilter, gfDate, gfValues, toast, type GFSection, type GroupedFilterValue } from "@/common/components/ui";
import { useServerList } from "@/common/hooks/use-server-list";
import { listCashMovementsPage } from "@/modules/cash/services/cashService";
import { listCustomersPage } from "@/modules/customers/services/customerService";
import { isUserCancel, userMessage } from "@/common/services/apiErrors";
import { shareMovementsPdf } from "@/common/utils/ledgerExport";
import { inr } from "@/common/utils/format";
import { useAuth } from "@/common/providers/AuthProvider";
import { useExpenseCategoryIds } from "@/common/components/LedgerList";
import { MOVEMENT_TYPE_OPTIONS, balancesFromPages, totalsFromPages } from "@/common/components/movementLedger";
import { MovementRow } from "@/common/components/MovementRow";
import type { CashMovement } from "@/modules/cash/types/cash-types";

// Branch ledger — the web's BranchLedger (/ledger-branch/:id) as its own
// screen, opened from the Ledger action on a Branches row (not a sheet).
// Like web it is the main Ledger's filtered query with this branch fixed:
// Transaction Type, Customer and Date are all narrowed server-side, so the
// rows, the Net / Credit / Debit totals and the running balance all follow
// the filter. Download exports exactly what the filters show.

type Filters = { types: string[]; customerIds: number[]; fromDate?: string; toDate?: string };

export default function BranchLedgerScreen() {
  const { id, label } = useLocalSearchParams<{ id: string; label?: string }>();
  const branchId = Number(id);
  const canExport = useAuth().can("Ledger_Export", "can_export_ledger");
  const [fv, setFv] = useState<GroupedFilterValue>(emptyGroupedFilter());
  const [exporting, setExporting] = useState(false);
  const categoryIds = useExpenseCategoryIds();

  const filters = useMemo<Filters>(
    () => ({
      types: gfValues(fv, "type"),
      customerIds: gfValues(fv, "customer").map(Number),
      fromDate: gfDate(fv, "date").from,
      toDate: gfDate(fv, "date").to,
    }),
    [fv]
  );
  const count = filters.types.length + filters.customerIds.length + (filters.fromDate || filters.toDate ? 1 : 0);

  // A customer belongs to one branch, so only this branch's customers are offered.
  const sections: GFSection[] = [
    { kind: "static", key: "type", label: "Transaction Type", options: MOVEMENT_TYPE_OPTIONS },
    {
      kind: "async",
      key: "customer",
      label: "Customer",
      fetchPage: (p) =>
        listCustomersPage({ q: p.q, limit: p.limit, offset: p.offset, branchIds: [branchId] }).then((r) => ({
          items: r.items.map((c) => ({ value: String(c.id), label: c.code ? `${c.name} (${c.code})` : c.name })),
          hasMore: r.hasMore,
        })),
    },
    { kind: "date", key: "date", label: "Date" },
  ];

  const list = useServerList<CashMovement, Filters>({
    key: ["branch-ledger", branchId],
    fetchPage: (p) =>
      listCashMovementsPage({
        limit: p.limit,
        offset: p.offset,
        fromDate: p.fromDate,
        toDate: p.toDate,
        branchIds: [branchId],
        customerIds: p.customerIds,
        types: p.types,
      }),
    filters,
    enabled: branchId > 0,
    fresh: true,
  });
  const balances = useMemo(() => balancesFromPages(list.pages), [list.pages]);
  const totals = totalsFromPages(list.pages);
  const net = totals ? totals.credit - totals.debit : 0;

  async function onDownload() {
    if (exporting) return;
    setExporting(true);
    toast.info("Preparing PDF", "The ledger will open in the share sheet.");
    try {
      await shareMovementsPdf({ fromDate: filters.fromDate, toDate: filters.toDate, branchIds: [branchId], customerIds: filters.customerIds, types: filters.types });
    } catch (e) {
      if (isUserCancel(e)) return;
      toast.error("Download failed", userMessage(e, "Could not download the ledger — try again."));
    } finally {
      setExporting(false);
    }
  }

  return (
    <Screen header={<FlatHeader title={label ? `${label} — Ledger` : "Branch Ledger"} subtitle="Every cash movement recorded against this branch" back />}>
      <ServerFlatList
        list={list}
        items={list.items}
        keyOf={(m) => `m${m.id}`}
        emptyText={count ? "No entries match your filters." : "No transactions found."}
        header={
          <View style={{ paddingTop: 12 }}>
            <View style={{ paddingHorizontal: 18, marginBottom: 10, alignItems: "flex-start" }}>
              <GroupedFilter title="Filter ledger" sections={sections} value={fv} onChange={setFv} />
            </View>
            {totals ? (
              <View style={{ flexDirection: "row", justifyContent: "space-between", marginHorizontal: 18, marginBottom: 14, paddingVertical: 10, paddingHorizontal: 12, borderRadius: 10, backgroundColor: C.card, borderWidth: 1, borderColor: C.line }}>
                <Txt style={{ fontSize: 12, color: C.muted }}>
                  Net <Txt style={{ fontWeight: "700", color: net < 0 ? C.red : C.green }}>{inr(net)}</Txt>
                </Txt>
                <Txt style={{ fontSize: 12, color: C.muted }}>
                  Credit <Txt style={{ fontWeight: "700", color: C.green }}>{inr(totals.credit)}</Txt>
                </Txt>
                <Txt style={{ fontSize: 12, color: C.muted }}>
                  Debit <Txt style={{ fontWeight: "700", color: C.red }}>{inr(totals.debit)}</Txt>
                </Txt>
              </View>
            ) : null}
          </View>
        }
        renderItem={(m, i) => <MovementRow m={m} balance={balances[i] ?? 0} categoryIds={categoryIds} defaultOpen={i === 0} />}
      />
      {list.items.length > 0 && canExport ? <FabCorner icon="download" label="Download ledger PDF" onPress={onDownload} /> : null}
    </Screen>
  );
}
