import { usePersistedState } from "@/common/hooks/use-persisted-state";
import React, { useEffect, useMemo, useState } from "react";
import { Pressable, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  AccRow,
  C,
  ConfirmSheet,
  FabMenu,
  type FabMenuAction,
  FlatHeader,
  PillTabs,
  Screen,
  SearchInput,
  ServerFlatList,
  Txt,
  toast,
} from "@/common/components/ui";
import { useServerList } from "@/common/hooks/use-server-list";
import { canActAtStage, stageByPending, useApprovalWorkflow } from "@/common/services/approvalWorkflowService";
import { useAuth } from "@/common/providers/AuthProvider";
import { approveExpense, listCashMovementsPage, listExpensesPage, listGoldSalesPage, rejectExpense } from "@/modules/cash/services/cashService";
import { type CashMovement, type Expense, type GoldSale } from "@/modules/cash/types/cash-types";
import { AddEntrySheet, EditEntrySheet } from "@/modules/cash/components/EntryForms";
import { dmy, inr } from "@/common/utils/format";
import { isUserCancel, userMessage } from "@/common/services/apiErrors";
import { shareExpensesPdf, shareMovementsPdf } from "@/common/utils/ledgerExport";
import { billDetail, modeLink, openLedger, useExpenseCategoryIds } from "@/common/components/LedgerList";
import { LedgerLink } from "@/common/components/LedgerLink";
import { EMPTY_MOVEMENT_FILTERS, movementFilterCount, movementFilterStyles as fs, balancesFromPages, totalsFromPages, type MovementFilters } from "@/common/components/movementLedger";
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
  const { can, employee } = useAuth();
  const wf = useApprovalWorkflow();
  // Approve / reject hit PATCH /expenses/:id/approve|reject, gated "can update cash". Each pending
  // expense waits at one approver role (the expense approval chain) — only that role (or the system
  // account) is offered the buttons, everyone else sees "Awaiting <role>"; the server enforces it too.
  const canUpdateCash = can("Cash_Management", "can_update_cash");
  const expenseStage = (e: Expense) => stageByPending(wf, "expense", e.approvalStage || "Pending");
  const canApproveExpense = (e: Expense) => canUpdateCash && (canActAtStage(employee, expenseStage(e)) || (employee?.isSystem === true && !expenseStage(e)));

  const [tab, setTab] = useState<Tab>("movements");
  // Dashboard tiles deep-link here with ?tab=…; `t` re-applies it per tap.
  const params = useLocalSearchParams<{ tab?: string; t?: string }>();
  useEffect(() => {
    if (params.tab === "movements" || params.tab === "expenses" || params.tab === "goldSales") setTab(params.tab);
  }, [params.tab, params.t]);

  const [action, setAction] = useState<CashAction>(null);
  // The expense whose Edit sheet is open (a pending or approved one a person keyed in).
  const [editingExpenseId, setEditingExpenseId] = useState<number | null>(null);
  // Kept while moving around the Ledger (a party ledger and back), like web.
  const [movementFilters, setMovementFilters] = usePersistedState<MovementFilters>("cash:filters", EMPTY_MOVEMENT_FILTERS);
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

  // Expense Register Download — a PDF of every expense row.
  async function onDownloadExpenses() {
    if (exporting) return;
    setExporting(true);
    toast.info("Preparing PDF", "The register will open in the share sheet.");
    try {
      await shareExpensesPdf();
    } catch (e) {
      if (isUserCancel(e)) return;
      toast.error("Download failed", errMsg(e, "Could not download the expense register — try again."));
    } finally {
      setExporting(false);
    }
  }

  const movements = useServerList<CashMovement, MovementFilters>({
    key: ["cash-movements", "list"],
    fetchPage: (p) => listCashMovementsPage(p),
    filters: movementFilters,
    enabled: tab === "movements",
  });
  const movementBalances = useMemo(() => balancesFromPages(movements.pages), [movements.pages]);
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

  const movementTotals = totalsFromPages(movements.pages);
  const header = (
    <View style={{ paddingTop: 14 }}>
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
      {tab === "expenses" && expenses.pages?.[0]?.totalAmount != null ? (
        <View style={{ flexDirection: "row", justifyContent: "space-between", marginHorizontal: 18, marginBottom: 12, paddingVertical: 10, paddingHorizontal: 12, borderRadius: 10, backgroundColor: C.card, borderWidth: 1, borderColor: C.line }}>
          <Txt style={{ fontSize: 12.5, color: C.muted }}>Total expenses</Txt>
          <Txt style={{ fontSize: 12.5, fontWeight: "700", color: C.red }}>{inr(expenses.pages[0].totalAmount ?? 0)}</Txt>
        </View>
      ) : null}
      {tab === "goldSales" && goldSales.pages?.[0]?.totalSold != null ? (
        <View style={{ flexDirection: "row", justifyContent: "space-between", marginHorizontal: 18, marginBottom: 12, paddingVertical: 10, paddingHorizontal: 12, borderRadius: 10, backgroundColor: C.card, borderWidth: 1, borderColor: C.line }}>
          <Txt style={{ fontSize: 12, color: C.muted }}>
            Sold <Txt style={{ fontWeight: "700", color: C.ink }}>{inr(goldSales.pages[0].totalSold ?? 0)}</Txt>
          </Txt>
          <Txt style={{ fontSize: 12, color: C.muted }}>
            Cost <Txt style={{ fontWeight: "700", color: C.ink }}>{inr(goldSales.pages[0].totalCost ?? 0)}</Txt>
          </Txt>
          <Txt style={{ fontSize: 12, color: C.muted }}>
            Profit <Txt style={{ fontWeight: "700", color: (goldSales.pages[0].totalProfit ?? 0) >= 0 ? C.green : C.red }}>{inr(goldSales.pages[0].totalProfit ?? 0)}</Txt>
          </Txt>
        </View>
      ) : null}
      {tab === "movements" && movementTotals ? (
        <View style={{ flexDirection: "row", justifyContent: "space-between", marginHorizontal: 18, marginBottom: 12, paddingVertical: 10, paddingHorizontal: 12, borderRadius: 10, backgroundColor: C.card, borderWidth: 1, borderColor: C.line }}>
          <Txt style={{ fontSize: 12.5, color: C.muted }}>
            Total Debit <Txt style={{ fontWeight: "700", color: C.red }}>{inr(movementTotals.debit)}</Txt>
          </Txt>
          <Txt style={{ fontSize: 12.5, color: C.muted }}>
            Total Credit <Txt style={{ fontWeight: "700", color: C.green }}>{inr(movementTotals.credit)}</Txt>
          </Txt>
        </View>
      ) : null}
    </View>
  );

  const refreshAll = (refetch: () => void) => () => {
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
    ...(tab === "expenses" && expenses.items.length > 0 && can("Ledger_Export", "can_export_ledger")
      ? [{ label: "Download Expense PDF", icon: "download", onPress: onDownloadExpenses }]
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
                ...(e.status === "Pending" && expenseStage(e) && !canApproveExpense(e) ? [{ k: "Awaiting", v: expenseStage(e)!.label }] : []),
                ...billDetail(e.receiptImage),
              ]}
              actions={[
                ...(canApproveExpense(e) && e.status === "Pending"
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
