import React, { useEffect, useMemo, useState } from "react";
import { Pressable, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AccRow,
  Buffering,
  C,
  Card,
  CashRow,
  ConfirmSheet,
  ClosingCard,
  FabMenu,
  type FabMenuAction,
  FlatHeader,
  PillTabs,
  Screen,
  SearchInput,
  SectionTitle,
  ServerFlatList,
  Txt,
  toast,
} from "@/common/components/ui";
import { useServerList } from "@/common/hooks/use-server-list";
import { useAuth } from "@/common/providers/AuthProvider";
import { approveExpense, getCashSummary, listCashMovementsPage, listExpensesPage, listGoldSalesPage, rejectExpense } from "@/modules/cash/services/cashService";
import { type CashMovement, type Expense, type GoldSale } from "@/modules/cash/types/cash-types";
import { AddEntrySheet, EditEntrySheet } from "@/modules/cash/components/EntryForms";
import { dmy, inr, todayISO } from "@/common/utils/format";
import { isUserCancel, userMessage } from "@/common/services/apiErrors";
import { shareMovementsPdf } from "@/common/utils/ledgerExport";
import { modeLink, openLedger, useExpenseCategoryIds } from "@/common/components/LedgerList";
import { LedgerLink } from "@/common/components/LedgerLink";
import { EMPTY_MOVEMENT_FILTERS, movementFilterCount, movementFilterStyles as fs, runningBalances, type MovementFilters } from "@/common/components/movementLedger";
import { MovementFilterSheet } from "@/common/components/MovementFilterSheet";
import { MovementRow } from "@/common/components/MovementRow";

// Cash & Expenses — prototype #header-cash + #page-cash and the
// cash-actions / add-entry (credit incl. the Gold Sale category / debit /
// self transfer) sheet. Opening cash is carried forward server-side, so there's no
// opening-balance sheet. Each tab (Movements / Expenses / Gold Sales) is its
// own server-paged list with its own server-side search (`q`).

const TABS = ["movements", "expenses", "goldSales"] as const;
type Tab = (typeof TABS)[number];
type CashAction = "addEntry" | null;

const errMsg = (err: unknown, fallback: string) => userMessage(err, fallback);

export default function CashScreen() {
  const qc = useQueryClient();
  const { employee, can } = useAuth();
  // Approve / reject hit PATCH /expenses/:id/approve|reject, gated "can update
  // cash"; the workflow stage itself is role-checked server-side.
  const canApproveExpense = can("Cash_Management", "can_update_cash");
  const today = todayISO();

  const [tab, setTab] = useState<Tab>("movements");
  // Dashboard tiles deep-link here with ?tab=…; `t` re-applies it per tap.
  const params = useLocalSearchParams<{ tab?: string; t?: string }>();
  useEffect(() => {
    if (params.tab === "movements" || params.tab === "expenses" || params.tab === "goldSales") setTab(params.tab);
  }, [params.tab, params.t]);

  const [action, setAction] = useState<CashAction>(null);
  // The expense whose Edit sheet is open (a pending or approved one a person keyed in).
  const [editingExpenseId, setEditingExpenseId] = useState<number | null>(null);
  const [movementFilters, setMovementFilters] = useState<MovementFilters>(EMPTY_MOVEMENT_FILTERS);
  const [movementFilterSheetOpen, setMovementFilterSheetOpen] = useState(false);
  const filterCount = movementFilterCount(movementFilters);
  // Ledger page Download — PDF of every movement matching the filters.
  const [exporting, setExporting] = useState(false);
  async function onDownload() {
    if (exporting) return;
    setExporting(true);
    toast.info("Preparing PDF", "The ledger will open in the share sheet.");
    try {
      await shareMovementsPdf({ ...movementFilters, q: movements.search || undefined });
    } catch (e) {
      if (isUserCancel(e)) return;
      toast.error("Download failed", errMsg(e, "Could not download the ledger — try again."));
    } finally {
      setExporting(false);
    }
  }

  const summary = useQuery({
    queryKey: ["cash-summary", employee?.branchId, today],
    queryFn: () => getCashSummary(employee!.branchId, today),
    enabled: !!employee,
  });

  const movements = useServerList<CashMovement, MovementFilters>({
    key: ["cash-movements", "list"],
    fetchPage: (p) => listCashMovementsPage(p),
    filters: movementFilters,
    enabled: tab === "movements",
  });
  const movementBalances = useMemo(() => runningBalances(movements.items), [movements.items]);
  const categoryIds = useExpenseCategoryIds();
  const expenses = useServerList<Expense>({ key: ["expenses", "list"], fetchPage: (p) => listExpensesPage(p), enabled: tab === "expenses" });
  const goldSales = useServerList<GoldSale>({ key: ["gold-sales", "list"], fetchPage: (p) => listGoldSalesPage(p), enabled: tab === "goldSales" });

  const approve = useMutation({
    mutationFn: (id: number) => approveExpense(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["expenses"] });
      qc.invalidateQueries({ queryKey: ["cash-summary"] });
      toast.success("Expense approved");
    },
    onError: (err) => toast.error("Couldn't approve expense", errMsg(err, "Try again.")),
  });
  // Reject asks for a reason first (as the web does), in a themed confirm.
  const [rejecting, setRejecting] = useState<Expense | null>(null);
  const [rejectError, setRejectError] = useState<string | null>(null);
  const reject = useMutation({
    mutationFn: ({ id, reason }: { id: number; reason: string }) => rejectExpense(id, reason),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["expenses"] });
      qc.invalidateQueries({ queryKey: ["cash-summary"] });
      setRejecting(null);
      toast.success("Expense rejected");
    },
    onError: (err) => setRejectError(errMsg(err, "Could not reject the expense — try again.")),
  });

  const s = summary.data;
  const header = (
    <View style={{ paddingTop: 14 }}>
      <Card style={{ marginBottom: 12 }}>
        <SectionTitle flush style={{ marginBottom: 6 }}>
          Today&apos;s cash summary
        </SectionTitle>
        {summary.isLoading ? (
          <Buffering block />
        ) : summary.isError || !s ? (
          <Txt style={{ color: C.red, fontSize: 12.5, paddingVertical: 8 }}>Could not load today&apos;s summary.</Txt>
        ) : (
          <>
            <CashRow first k="Opening cash (carried forward)" v={inr(s.openingCash)} />
            <CashRow k="Cash in" v={`+${inr(s.collections)}`} color={C.green} />
            <CashRow k="Cash out" v={inr(s.disbursements)} />
            <CashRow k="Expenses (cash)" v={inr(s.cashExpenses)} />
          </>
        )}
      </Card>
      <ClosingCard k="Closing Balance (Expected Cash in Hand)" v={s ? inr(s.expectedCash) : "—"} formula="Opening + Cash in − Cash out − Expenses" />
      <PillTabs tabs={TABS} value={tab} onChange={setTab} labels={{ movements: "Movements", expenses: "Expenses", goldSales: "Gold Sales" }} />
      <View style={{ paddingTop: 12 }}>
        {tab === "movements" ? (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 18, paddingBottom: 8 }}>
            <View style={{ flex: 1 }}>
              <SearchInput value={movements.search} onChangeText={movements.setSearch} placeholder="Search by purpose or source" style={{ paddingHorizontal: 0, paddingBottom: 0 }} />
            </View>
            <Pressable onPress={() => setMovementFilterSheetOpen(true)} style={fs.filterBtn}>
              <Txt style={fs.filterBtnTxt}>Filters</Txt>
              {filterCount > 0 ? (
                <View style={fs.filterBadge}>
                  <Txt style={fs.filterBadgeTxt}>{filterCount}</Txt>
                </View>
              ) : null}
            </Pressable>
          </View>
        ) : tab === "expenses" ? (
          <SearchInput value={expenses.search} onChangeText={expenses.setSearch} placeholder="Search by category" style={{ paddingBottom: 8 }} />
        ) : (
          <SearchInput value={goldSales.search} onChangeText={goldSales.setSearch} placeholder="Search by ornament type or remarks" style={{ paddingBottom: 8 }} />
        )}
      </View>
    </View>
  );

  const refreshAll = (refetch: () => void) => () => {
    summary.refetch();
    refetch();
  };

  const canCreateCash = can("Cash_Management", "can_create_cash");
  const fabActions: FabMenuAction[] = [
    ...(canCreateCash
      ? [
          { label: "Add Entry", icon: "plus", onPress: () => setAction("addEntry") },
        ]
      : []),
    ...(tab === "movements" && movements.items.length > 0 && can("Ledger_Export", "can_export_ledger")
      ? [{ label: "Download PDF", icon: "download", onPress: onDownload }]
      : []),
  ];

  return (
    <Screen
      header={<FlatHeader title="Ledger" subtitle="Movements, expenses & gold sales" />}
      floating={
        // One corner button that opens upward into every action — same as
        // Bank Pledges.
        fabActions.length > 0 ? <FabMenu label="Cash actions" actions={fabActions} /> : undefined
      }
    >
      {tab === "movements" ? (
        <ServerFlatList
          list={{ ...movements, refetch: refreshAll(movements.refetch) }}
          items={movements.items}
          header={header}
          keyOf={(m) => `m${m.id}`}
          emptyText={movements.search ? "No movements match your search." : "No movements yet."}
          renderItem={(m, i) => <MovementRow m={m} balance={movementBalances[i] ?? 0} categoryIds={categoryIds} defaultOpen={i === 0} />}
        />
      ) : tab === "expenses" ? (
        <ServerFlatList
          list={{ ...expenses, refetch: refreshAll(expenses.refetch) }}
          items={expenses.items}
          header={header}
          keyOf={(e) => `e${e.id}`}
          emptyText={expenses.search ? "No expenses match your search." : "No expenses yet."}
          renderItem={(e, i) => (
            <AccRow
              defaultOpen={i === 0}
              name={inr(e.amount)}
              sub={e.category}
              status={e.status}
              details={[
                { k: "Date", v: dmy(e.occurredOn) },
                {
                  k: "Category",
                  v: categoryIds[e.category.toLowerCase()] ? (
                    <LedgerLink label={e.category} to="/cash" onPress={() => openLedger("category", categoryIds[e.category.toLowerCase()], e.category)} />
                  ) : (
                    e.category
                  ),
                },
                { k: "Mode", v: modeLink(e.mode) },
                { k: "Branch", v: e.branch?.name || "—" },
                ...(e.remarks ? [{ k: "Remarks", v: e.remarks }] : []),
                ...(e.approvedBy ? [{ k: e.status === "Rejected" ? "Rejected by" : "Approved by", v: e.approvedBy }] : []),
              ]}
              actions={[
                ...(canApproveExpense && e.status === "Pending"
                  ? [
                      { label: "Approve", onPress: () => approve.mutate(e.id), disabled: approve.isPending },
                      {
                        label: "Reject",
                        danger: true,
                        onPress: () => {
                          setRejectError(null);
                          setRejecting(e);
                        },
                        disabled: reject.isPending,
                      },
                    ]
                  : []),
                ...(e.editable ? [{ label: "Edit", onPress: () => setEditingExpenseId(e.id) }] : []),
              ]}
            />
          )}
        />
      ) : (
        <ServerFlatList
          list={{ ...goldSales, refetch: refreshAll(goldSales.refetch) }}
          items={goldSales.items}
          header={header}
          keyOf={(g) => `g${g.id}`}
          emptyText={goldSales.search ? "No gold sales match your search." : 'No gold sales recorded yet. Use the corner Cash actions button → Add Entry with the Gold Sale category.'}
          renderItem={(g, i) => (
            <AccRow
              defaultOpen={i === 0}
              name={g.ornamentType}
              sub={`Sold ${inr(g.soldAmount)}`}
              status={`${g.profit >= 0 ? "+" : "−"}${inr(Math.abs(g.profit))}`}
              statusTone={g.profit >= 0 ? "active" : "overdue"}
              details={[
                { k: "Cost amount", v: inr(g.costAmount) },
                { k: "Mode", v: modeLink(g.mode || "Cash") },
                ...(g.bankId
                  ? [{ k: "Bank", v: <LedgerLink label={g.bankRef?.name || "Bank"} to="/cash" onPress={() => openLedger("bank", g.bankId!, g.bankRef?.name || "Bank")} /> }]
                  : []),
                { k: "Remarks", v: g.remarks || "—" },
                { k: "Date", v: dmy(g.soldOn) },
                { k: "Branch", v: g.branch?.name || "—" },
              ]}
            />
          )}
        />
      )}



      <AddEntrySheet visible={action === "addEntry"} onClose={() => setAction(null)} />
      <EditEntrySheet entryId={editingExpenseId} viaExpense onClose={() => setEditingExpenseId(null)} />
      <ConfirmSheet
        visible={!!rejecting}
        onClose={() => setRejecting(null)}
        title="Reject Expense"
        danger
        message={rejecting ? `Reject the ${inr(rejecting.amount)} ${rejecting.category} expense?` : ""}
        remarks={{ label: "Reason", placeholder: "Why is this expense being rejected?", required: true }}
        confirmLabel="Reject Expense"
        loading={reject.isPending}
        error={rejectError}
        onConfirm={(reason) => rejecting && reject.mutate({ id: rejecting.id, reason })}
      />
      <MovementFilterSheet
        visible={movementFilterSheetOpen}
        onClose={() => setMovementFilterSheetOpen(false)}
        value={movementFilters}
        onChange={setMovementFilters}
      />
    </Screen>
  );
}
