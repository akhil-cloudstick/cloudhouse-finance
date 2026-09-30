import React, { useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AccRow,
  AccBtn,
  AsyncSelect,
  Buffering,
  C,
  Card,
  CashRow,
  CheckItem,
  ConfirmSheet,
  ChipToggle,
  ClosingCard,
  DateField,
  Field,
  FieldRow,
  FlatHeader,
  Input,
  PillTabs,
  PrimaryButton,
  ResultBox,
  Screen,
  SearchInput,
  SectionTitle,
  ServerFlatList,
  Sheet,
  SheetListItem,
  Txt,
  toast,
} from "../../../src/components/ui";
import { useServerList } from "../../../src/hooks/useServerList";
import { useAuth } from "../../../src/auth/AuthContext";
import { ApiError } from "../../../src/api/client";
import {
  approveExpense,
  createCashMovement,
  createCashSource,
  createExpense,
  createExpenseCategory,
  createGoldSale,
  getCashSummary,
  listCashMovementsPage,
  listCashSourcesPage,
  listExpenseCategoriesPage,
  listExpensesPage,
  listGoldSalesPage,
  rejectExpense,
  setOpeningBalance,
  type CashSource,
  type ExpenseCategory,
} from "../../../src/api/cash";
import { createBank, listBanksPage } from "../../../src/api/banks";
import type { Bank } from "../../../src/types/bank";
import { listBranches } from "../../../src/api/branches";
import { listCustomersPage } from "../../../src/api/customers";
import { dmy, inr, todayISO } from "../../../src/lib/format";
import type { CashMovement, Expense, GoldSale } from "../../../src/types/cash";
import type { Branch } from "../../../src/types/branch";
import type { Customer } from "../../../src/types/customer";
import { userMessage } from "../../../src/api/errors";

// Cash & Expenses — prototype #header-cash + #page-cash and the
// cash-actions / add-cash / cash-out / gold-sale / record-expense /
// opening-balance sheets. Each tab (Movements / Expenses / Gold Sales) is its
// own server-paged list with its own server-side search (`q`).

const TABS = ["movements", "expenses", "goldSales"] as const;
type Tab = (typeof TABS)[number];
type CashAction = "addCash" | "goldSale" | "expense" | null;
const MOVE_MODES = ["Cash", "UPI", "Bank Transfer", "Cheque"] as const;
const EXPENSE_MODES = ["Cash", "UPI", "Bank Transfer"] as const;

// Mirrors backend/internal/cash/repository.go's Category* constants — same
// list web's Cash.tsx/LedgerExportView.tsx Type filter offers.
const MOVEMENT_TYPE_OPTIONS = [
  { value: "loan", label: "Loan" },
  { value: "auction", label: "Auction" },
  { value: "collection", label: "Collection" },
  { value: "personal loan", label: "Personal Loan" },
  { value: "investment", label: "Investment" },
  { value: "expenses", label: "Expenses" },
];

// The Movements tab's Branch/Customer/Type multi-select filter state,
// server-applied via listCashMovementsPage's branchIds/customerIds/types
// (mirrors web's FilterPanel on Cash.tsx). Kept as plain state in the
// screen (not inside useServerList) since it's also read by the Customer
// picker sheet to narrow its own options by the selected branches.
type MovementFilters = { branchIds: number[]; customerIds: number[]; types: string[] };
const EMPTY_MOVEMENT_FILTERS: MovementFilters = { branchIds: [], customerIds: [], types: [] };

const fs = StyleSheet.create({
  filterBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 11,
    borderWidth: 1,
    borderColor: C.line,
    backgroundColor: C.card,
  },
  filterBtnTxt: { fontSize: 13, fontWeight: "700", color: C.ink },
  filterBadge: {
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 4,
    backgroundColor: C.brandDeep,
    alignItems: "center",
    justifyContent: "center",
  },
  filterBadgeTxt: { fontSize: 10.5, fontWeight: "700", color: "#fff" },
  filterTabWrap: { paddingHorizontal: 16, paddingTop: 4 },
  filterList: { paddingHorizontal: 16, paddingTop: 8, gap: 2 },
});

const errMsg = (err: unknown, fallback: string) => userMessage(err, fallback);

// loanRefFor pulls the loan number back out of `purpose` — every
// loan-related movement's Purpose carries it as a "… — LN-00049" suffix
// (see cash.MovementService.RecordLoanDisbursementCashOut/
// RecordLoanPaymentCashIn/etc) — same regex web's Cash.tsx uses. Falls back
// to the transaction group id / movement id for a movement with no loan
// number (manual top-ups, expenses, gold sales, …).
const LOAN_NUMBER_RE = /—\s*(LN-\S+)\s*$/;
function loanRefFor(m: CashMovement): string {
  const match = m.purpose ? LOAN_NUMBER_RE.exec(m.purpose) : null;
  return match?.[1] || m.transactionGroupId || String(m.id);
}

// Running balance over the currently loaded (paginated) page only — same
// best-effort approach web's Cash.tsx/LedgerExportView.tsx use, not a true
// running balance across the whole filtered set. Items are newest-first
// (occurred_on desc from the backend), so this walks oldest→newest to
// accumulate, then re-reverses to line back up with `items`' own order.
function runningBalances(items: CashMovement[]): number[] {
  const chronological = [...items].reverse();
  let running = 0;
  const balances = chronological.map((m) => {
    running += m.type === "out" ? -m.amount : m.amount;
    return running;
  });
  return balances.reverse();
}

export default function CashScreen() {
  const qc = useQueryClient();
  const { employee } = useAuth();
  const isAdmin = employee?.role === "Administrator";
  const today = todayISO();

  const [tab, setTab] = useState<Tab>("movements");
  // Dashboard tiles deep-link here with ?tab=…; `t` re-applies it per tap.
  const params = useLocalSearchParams<{ tab?: string; t?: string }>();
  useEffect(() => {
    if (params.tab === "movements" || params.tab === "expenses" || params.tab === "goldSales") setTab(params.tab);
  }, [params.tab, params.t]);

  const [actionsOpen, setActionsOpen] = useState(false);
  const [action, setAction] = useState<CashAction>(null);
  const [openingOpen, setOpeningOpen] = useState(false);
  const [movementFilters, setMovementFilters] = useState<MovementFilters>(EMPTY_MOVEMENT_FILTERS);
  const [movementFilterSheetOpen, setMovementFilterSheetOpen] = useState(false);
  const movementFilterCount = movementFilters.branchIds.length + movementFilters.customerIds.length + movementFilters.types.length;

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
  const expenses = useServerList<Expense>({ key: ["expenses", "list"], fetchPage: (p) => listExpensesPage(p), enabled: tab === "expenses" });
  const goldSales = useServerList<GoldSale>({ key: ["gold-sales", "list"], fetchPage: (p) => listGoldSalesPage(p), enabled: tab === "goldSales" });

  const approve = useMutation({
    mutationFn: (id: number) => approveExpense(id, employee?.name),
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
    mutationFn: ({ id, reason }: { id: number; reason: string }) => rejectExpense(id, reason, employee?.name),
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
            <CashRow first k="Opening cash" v={inr(s.openingCash)} />
            <CashRow k="Cash in" v={`+${inr(s.collections)}`} color={C.green} />
            <CashRow k="Cash out" v={`−${inr(s.disbursements)}`} />
            <CashRow k="Expenses (cash)" v={`−${inr(s.cashExpenses)}`} />
          </>
        )}
        <AccBtn label="Set Opening Balance" onPress={() => setOpeningOpen(true)} style={{ marginTop: 10, flex: 0 }} />
      </Card>
      <ClosingCard k="Closing Balance (Expected Cash in Hand)" v={s ? inr(s.expectedCash) : "—"} formula="Opening + Cash in − Cash out − Expenses" />
      <View style={{ paddingHorizontal: 18, paddingBottom: 12 }}>
        <PrimaryButton label="Cash Actions" onPress={() => setActionsOpen(true)} />
      </View>
      <PillTabs tabs={TABS} value={tab} onChange={setTab} labels={{ movements: "Movements", expenses: "Expenses", goldSales: "Gold Sales" }} />
      <View style={{ paddingTop: 12 }}>
        {tab === "movements" ? (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 18, paddingBottom: 8 }}>
            <View style={{ flex: 1 }}>
              <SearchInput value={movements.search} onChangeText={movements.setSearch} placeholder="Search by purpose or source" style={{ paddingHorizontal: 0, paddingBottom: 0 }} />
            </View>
            <Pressable onPress={() => setMovementFilterSheetOpen(true)} style={fs.filterBtn}>
              <Txt style={fs.filterBtnTxt}>Filters</Txt>
              {movementFilterCount > 0 ? (
                <View style={fs.filterBadge}>
                  <Txt style={fs.filterBadgeTxt}>{movementFilterCount}</Txt>
                </View>
              ) : null}
            </Pressable>
          </View>
        ) : tab === "expenses" ? (
          <SearchInput value={expenses.search} onChangeText={expenses.setSearch} placeholder="Search by category or payee" style={{ paddingBottom: 8 }} />
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

  return (
    <Screen header={<FlatHeader title="Ledger" subtitle="Movements, expenses & gold sales" />}>
      {tab === "movements" ? (
        <ServerFlatList
          list={{ ...movements, refetch: refreshAll(movements.refetch) }}
          items={movements.items}
          header={header}
          keyOf={(m) => `m${m.id}`}
          emptyText={movements.search ? "No movements match your search." : "No movements yet."}
          renderItem={(m, i) => (
            <AccRow
              defaultOpen={i === 0}
              name={inr(m.amount)}
              sub={m.purpose || m.source}
              status={m.type === "in" ? "Cash in" : "Cash out"}
              statusTone={m.type === "in" ? "active" : "due"}
              details={[
                { k: "Date", v: dmy(m.occurredOn) },
                { k: "Ref No", v: loanRefFor(m) },
                { k: "Mode", v: m.mode || "—" },
                { k: "Debit", v: m.type === "out" ? inr(m.amount) : "—" },
                { k: "Credit", v: m.type === "in" ? inr(m.amount) : "—" },
                { k: "Balance", v: inr(movementBalances[i] ?? 0) },
                m.bank || m.bankRef?.name ? { k: "Bank", v: m.bank || m.bankRef?.name || "—" } : { k: "Branch", v: m.branch?.name || "—" },
                ...(m.partyCustomer?.name ? [{ k: "Customer", v: m.partyCustomer.name }] : []),
                ...(m.status ? [{ k: "Status", v: m.status }] : []),
              ]}
            />
          )}
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
                { k: "Payee", v: e.payee || "—" },
                { k: "Mode", v: e.mode || "—" },
                { k: "Branch", v: e.branch?.name || "—" },
                ...(e.remarks ? [{ k: "Remarks", v: e.remarks }] : []),
                ...(e.approvedBy ? [{ k: e.status === "Rejected" ? "Rejected by" : "Approved by", v: e.approvedBy }] : []),
              ]}
              actions={
                isAdmin && e.status === "Pending"
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
                  : undefined
              }
            />
          )}
        />
      ) : (
        <ServerFlatList
          list={{ ...goldSales, refetch: refreshAll(goldSales.refetch) }}
          items={goldSales.items}
          header={header}
          keyOf={(g) => `g${g.id}`}
          emptyText={goldSales.search ? "No gold sales match your search." : 'No gold sales recorded yet. Use "Cash Actions" → Gold Sale.'}
          renderItem={(g, i) => (
            <AccRow
              defaultOpen={i === 0}
              name={g.ornamentType}
              sub={`Sold ${inr(g.soldAmount)}`}
              status={`${g.profit >= 0 ? "+" : "−"}${inr(Math.abs(g.profit))}`}
              statusTone={g.profit >= 0 ? "active" : "overdue"}
              details={[
                { k: "Cost amount", v: inr(g.costAmount) },
                { k: "Remarks", v: g.remarks || "—" },
                { k: "Date", v: dmy(g.soldOn) },
                { k: "Branch", v: g.branch?.name || "—" },
              ]}
            />
          )}
        />
      )}

      <Sheet visible={actionsOpen} onClose={() => setActionsOpen(false)} title="Cash Actions" maxHeightPct={60}>
        {(
          [
            { key: "addCash", icon: "coin", title: "Add Cash", sub: "Record cash coming into the branch" },
            { key: "goldSale", icon: "coin", title: "Gold Sale", sub: "Record an auctioned/sold ornament" },
            { key: "expense", icon: "doc", title: "Record Expense", sub: "Log a branch expense" },
          ] as const
        ).map((a, i) => (
          <SheetListItem
            key={a.key}
            first={i === 0}
            icon={a.icon}
            title={a.title}
            sub={a.sub}
            onPress={() => {
              setActionsOpen(false);
              setAction(a.key);
            }}
          />
        ))}
      </Sheet>

      <MovementSheet visible={action === "addCash"} onClose={() => setAction(null)} branchId={employee?.branchId} />
      <GoldSaleSheet visible={action === "goldSale"} onClose={() => setAction(null)} branchId={employee?.branchId} />
      <ExpenseSheet visible={action === "expense"} onClose={() => setAction(null)} branchId={employee?.branchId} />
      <ConfirmSheet
        visible={!!rejecting}
        onClose={() => setRejecting(null)}
        title="Reject Expense"
        danger
        message={rejecting ? `Reject the ${inr(rejecting.amount)} ${rejecting.category} expense${rejecting.payee ? ` paid to ${rejecting.payee}` : ""}?` : ""}
        remarks={{ label: "Reason", placeholder: "Why is this expense being rejected?", required: true }}
        confirmLabel="Reject Expense"
        loading={reject.isPending}
        error={rejectError}
        onConfirm={(reason) => rejecting && reject.mutate({ id: rejecting.id, reason })}
      />
      <OpeningBalanceSheet visible={openingOpen} onClose={() => setOpeningOpen(false)} branchId={employee?.branchId} current={s?.openingCash} />
      <MovementFilterSheet
        visible={movementFilterSheetOpen}
        onClose={() => setMovementFilterSheetOpen(false)}
        value={movementFilters}
        onChange={setMovementFilters}
      />
    </Screen>
  );
}

type FormProps = { visible: boolean; onClose: () => void; branchId?: number };

// prototype #add-cash-modal
function MovementSheet({ visible, onClose, branchId }: FormProps) {
  const qc = useQueryClient();
  const [source, setSource] = useState<CashSource | null>(null);
  const [purpose, setPurpose] = useState("");
  const [amount, setAmount] = useState("");
  const [mode, setMode] = useState<(typeof MOVE_MODES)[number]>("Cash");
  const [error, setError] = useState<string | null>(null);

  const isLoan = source?.name === "Loan";
  const [loanBank, setLoanBank] = useState<Bank | null>(null);
  const [loanNumber, setLoanNumber] = useState("");
  const [principalAmount, setPrincipalAmount] = useState("");
  const [interestRate, setInterestRate] = useState("");
  const [durationMonths, setDurationMonths] = useState("");

  useEffect(() => {
    if (visible) {
      setSource(null);
      setPurpose("");
      setAmount("");
      setMode("Cash");
      setError(null);
      setLoanBank(null);
      setLoanNumber("");
      setPrincipalAmount("");
      setInterestRate("");
      setDurationMonths("");
    }
  }, [visible]);

  const m = useMutation({
    mutationFn: () =>
      createCashMovement({
        type: "in",
        source: source!.name,
        purpose: purpose.trim(),
        amount: Number(amount),
        mode,
        bank: undefined,
        branchId,
        loanSource: isLoan
          ? {
              bankId: loanBank!.id,
              loanNumber: loanNumber.trim(),
              principalAmount: Number(principalAmount),
              interestRate: interestRate.trim() ? Number(interestRate) : undefined,
              durationMonths: durationMonths.trim() ? Number(durationMonths) : undefined,
            }
          : undefined,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["cash-movements"] });
      qc.invalidateQueries({ queryKey: ["cash-summary"] });
      onClose();
    },
    onError: (err) => setError(errMsg(err, "Could not save.")),
  });

  const loanValid = !isLoan || (!!loanBank && !!loanNumber.trim() && Number(principalAmount) > 0);
  const canSubmit = !!source && !!purpose.trim() && Number(amount) > 0 && loanValid;

  return (
    <Sheet visible={visible} onClose={onClose} title="Add Cash" maxHeightPct={isLoan ? 90 : 65}>
      <AsyncSelect<CashSource>
        label="Source"
        placeholder="Search or add a source (e.g. Savings, Loan)"
        queryKey={["cash-sources", "picker"]}
        fetcher={async (q) => (await listCashSourcesPage(q, 0)).items ?? []}
        selectedLabel={source?.name}
        onSelect={setSource}
        onClear={() => setSource(null)}
        keyOf={(s) => s.id}
        renderItem={(s) => ({ title: s.name })}
        onCreateNew={createCashSource}
      />
      <Field label="Purpose">
        <Input placeholder="Short description" value={purpose} onChangeText={setPurpose} />
      </Field>
      <Field label="Amount">
        <Input keyboardType="decimal-pad" placeholder="₹" value={amount} onChangeText={setAmount} />
      </Field>
      <Field label="Mode">
        <ChipToggle options={MOVE_MODES} value={mode} onChange={setMode} wrap />
      </Field>

      {isLoan ? (
        <View style={{ borderWidth: 1, borderColor: C.line, borderStyle: "dashed", borderRadius: 10, padding: 12, marginBottom: 10 }}>
          <Txt style={{ fontSize: 12, fontWeight: "700", color: C.brandDeep, marginBottom: 8 }}>LOAN DETAILS</Txt>
          <AsyncSelect<Bank>
            label="Bank"
            placeholder="Search or add a bank"
            queryKey={["banks", "picker"]}
            fetcher={async (q) => (await listBanksPage({ q: q || undefined, limit: 20, offset: 0 })).items ?? []}
            selectedLabel={loanBank?.name}
            onSelect={setLoanBank}
            onClear={() => setLoanBank(null)}
            keyOf={(b) => b.id}
            renderItem={(b) => ({ title: b.name })}
            onCreateNew={(name) => createBank({ name })}
          />
          <Field label="Loan Number">
            <Input placeholder="e.g. LN-00049" value={loanNumber} onChangeText={setLoanNumber} />
          </Field>
          <FieldRow>
            <Field label="Principal Amount (₹)">
              <Input keyboardType="decimal-pad" value={principalAmount} onChangeText={setPrincipalAmount} />
            </Field>
            <Field label="Interest Rate (%)">
              <Input keyboardType="decimal-pad" placeholder="Optional" value={interestRate} onChangeText={setInterestRate} />
            </Field>
          </FieldRow>
          <Field label="Duration (months)">
            <Input keyboardType="number-pad" placeholder="Optional" value={durationMonths} onChangeText={setDurationMonths} />
          </Field>
        </View>
      ) : null}

      {error ? <Txt style={{ fontSize: 12, color: C.red, marginBottom: 10 }}>{error}</Txt> : null}
      <PrimaryButton label="Add Cash" onPress={() => m.mutate()} loading={m.isPending} disabled={!canSubmit} />
    </Sheet>
  );
}

// prototype #gold-sale-modal — live profit/loss preview.
const GOLD_SALE_MODES = ["Cash", "UPI", "Bank Transfer"] as const;

function GoldSaleSheet({ visible, onClose, branchId }: FormProps) {
  const qc = useQueryClient();
  const [type, setType] = useState("");
  const [sold, setSold] = useState("");
  const [cost, setCost] = useState("");
  const [mode, setMode] = useState<(typeof GOLD_SALE_MODES)[number]>("Cash");
  const [bank, setBank] = useState<Bank | null>(null);
  const [remarks, setRemarks] = useState("");
  const [error, setError] = useState<string | null>(null);
  const bankRequired = mode === "UPI" || mode === "Bank Transfer";
  useEffect(() => {
    if (visible) {
      setType("");
      setSold("");
      setCost("");
      setMode("Cash");
      setBank(null);
      setRemarks("");
      setError(null);
    }
  }, [visible]);
  const profit = (Number(sold) || 0) - (Number(cost) || 0);
  const m = useMutation({
    mutationFn: () =>
      createGoldSale({
        ornamentType: type.trim(), soldAmount: Number(sold), costAmount: Number(cost || 0), branchId: branchId!,
        mode, bankId: bankRequired ? bank?.id : undefined,
        remarks: remarks.trim() || undefined,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["gold-sales"] });
      qc.invalidateQueries({ queryKey: ["cash-movements"] });
      qc.invalidateQueries({ queryKey: ["cash-summary"] });
      onClose();
    },
    onError: (err) => setError(errMsg(err, "Could not save.")),
  });
  return (
    <Sheet visible={visible} onClose={onClose} title="Gold Sale" maxHeightPct={75}>
      <Field label="Ornament type">
        <Input placeholder="e.g. Gold Chain" value={type} onChangeText={setType} />
      </Field>
      <FieldRow>
        <Field label="Sold amount">
          <Input keyboardType="decimal-pad" placeholder="₹" value={sold} onChangeText={setSold} />
        </Field>
        <Field label="Cost amount">
          <Input keyboardType="decimal-pad" placeholder="₹" value={cost} onChangeText={setCost} />
        </Field>
      </FieldRow>
      <Field label="Payment Mode">
        <ChipToggle options={GOLD_SALE_MODES} value={mode} onChange={(v) => { setMode(v); if (v === "Cash") setBank(null); }} wrap />
      </Field>
      {bankRequired ? (
        <AsyncSelect<Bank>
          label="Bank"
          placeholder="Search or add a bank"
          queryKey={["banks", "picker"]}
          fetcher={async (q) => (await listBanksPage({ q: q || undefined, limit: 20, offset: 0 })).items ?? []}
          selectedLabel={bank?.name}
          onSelect={setBank}
          onClear={() => setBank(null)}
          keyOf={(b) => b.id}
          renderItem={(b) => ({ title: b.name })}
          onCreateNew={(name) => createBank({ name })}
        />
      ) : null}
      <ResultBox k="Profit / Loss" v={`${profit >= 0 ? "+" : "−"}${inr(Math.abs(profit))}`} tone={profit >= 0 ? "green" : "red"} />
      <Field label="Remarks">
        <Input placeholder="e.g. Auctioned — LN-2199" value={remarks} onChangeText={setRemarks} />
      </Field>
      {error ? <Txt style={{ fontSize: 12, color: C.red, marginBottom: 10 }}>{error}</Txt> : null}
      <PrimaryButton
        label="Record Gold Sale"
        onPress={() => m.mutate()}
        loading={m.isPending}
        disabled={!type.trim() || !(Number(sold) > 0) || !branchId || (bankRequired && !bank)}
      />
    </Sheet>
  );
}

// prototype #record-expense-modal
function ExpenseSheet({ visible, onClose, branchId }: FormProps) {
  const qc = useQueryClient();
  const [category, setCategory] = useState<ExpenseCategory | null>(null);
  const [amount, setAmount] = useState("");
  const [mode, setMode] = useState<(typeof EXPENSE_MODES)[number]>("Cash");
  const [payee, setPayee] = useState("");
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (visible) {
      setCategory(null);
      setAmount("");
      setMode("Cash");
      setPayee("");
      setError(null);
    }
  }, [visible]);
  const m = useMutation({
    mutationFn: () => createExpense({ category: category!.name, amount: Number(amount), mode, payee: payee.trim(), branchId: branchId! }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["expenses"] });
      qc.invalidateQueries({ queryKey: ["cash-summary"] });
      onClose();
    },
    onError: (err) => setError(errMsg(err, "Could not save.")),
  });
  return (
    <Sheet visible={visible} onClose={onClose} title="Record Expense" maxHeightPct={65}>
      <AsyncSelect<ExpenseCategory>
        label="Category"
        placeholder="Search or add a category"
        queryKey={["expense-categories", "picker"]}
        fetcher={async (q) => (await listExpenseCategoriesPage(q, 0)).items ?? []}
        selectedLabel={category?.name}
        onSelect={setCategory}
        onClear={() => setCategory(null)}
        keyOf={(c) => c.id}
        renderItem={(c) => ({ title: c.name })}
        onCreateNew={createExpenseCategory}
      />
      <Field label="Amount">
        <Input keyboardType="decimal-pad" placeholder="₹" value={amount} onChangeText={setAmount} />
      </Field>
      <Field label="Mode">
        <ChipToggle options={EXPENSE_MODES} value={mode} onChange={setMode} />
      </Field>
      <Field label="Payee">
        <Input placeholder="Who was paid" value={payee} onChangeText={setPayee} />
      </Field>
      {error ? <Txt style={{ fontSize: 12, color: C.red, marginBottom: 10 }}>{error}</Txt> : null}
      <PrimaryButton label="Record Expense" onPress={() => m.mutate()} loading={m.isPending} disabled={!category || !(Number(amount) > 0) || !payee.trim() || !branchId} />
    </Sheet>
  );
}

// prototype #opening-balance-modal
function OpeningBalanceSheet({ visible, onClose, branchId, current }: FormProps & { current?: number }) {
  const qc = useQueryClient();
  const [date, setDate] = useState(todayISO());
  const [amount, setAmount] = useState("");
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (visible) {
      setDate(todayISO());
      setAmount(current != null ? String(current) : "");
      setError(null);
    }
  }, [visible, current]);
  const m = useMutation({
    mutationFn: () => setOpeningBalance(branchId!, Number(amount), date),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["cash-summary"] });
      onClose();
    },
    onError: (err) => setError(errMsg(err, "Could not save the opening balance.")),
  });
  return (
    <Sheet visible={visible} onClose={onClose} title="Set Opening Balance" maxHeightPct={55}>
      <DateField label="Date" value={date} onChange={setDate} max={todayISO()} />
      <Field label="Opening balance amount">
        <Input keyboardType="decimal-pad" placeholder="₹" value={amount} onChangeText={setAmount} />
      </Field>
      {error ? <Txt style={{ fontSize: 12, color: C.red, marginBottom: 10 }}>{error}</Txt> : null}
      <PrimaryButton label="Save Opening Balance" onPress={() => m.mutate()} loading={m.isPending} disabled={amount.trim() === "" || isNaN(Number(amount)) || !branchId} />
    </Sheet>
  );
}

const FILTER_TABS = ["branch", "customer", "type"] as const;
type FilterTab = (typeof FILTER_TABS)[number];

/** Movements tab's Branch/Customer/Type multi-select filter — mirrors web's
 * FilterPanel (Cash.tsx) as 3 tabs of checkable rows inside one sheet
 * (mobile has no direct FilterPanel equivalent). Selecting a Branch narrows
 * the Customer tab's own list to customers whose home branch is one of
 * those (a customer belongs to exactly one branch), same cross-filter rule
 * as web. Applies immediately (no separate "Apply" step) since each toggle
 * already re-queries the (debounced) list underneath via useServerList's
 * `filters`. */
function MovementFilterSheet({
  visible,
  onClose,
  value,
  onChange,
}: {
  visible: boolean;
  onClose: () => void;
  value: MovementFilters;
  onChange: (next: MovementFilters) => void;
}) {
  const [filterTab, setFilterTab] = useState<FilterTab>("branch");
  useEffect(() => {
    if (visible) setFilterTab("branch");
  }, [visible]);

  const branches = useQuery({ queryKey: ["branches", "all"], queryFn: listBranches, enabled: visible });
  const customers = useServerList<Customer, { branchIds?: number[] }>({
    key: ["customers", "filter-picker"],
    fetchPage: (p) => listCustomersPage(p),
    filters: value.branchIds.length ? { branchIds: value.branchIds } : {},
    enabled: visible && filterTab === "customer",
  });

  function toggleBranch(id: number) {
    onChange({
      ...value,
      branchIds: value.branchIds.includes(id) ? value.branchIds.filter((b) => b !== id) : [...value.branchIds, id],
    });
  }
  function toggleCustomer(id: number) {
    onChange({
      ...value,
      customerIds: value.customerIds.includes(id) ? value.customerIds.filter((c) => c !== id) : [...value.customerIds, id],
    });
  }
  function toggleType(v: string) {
    onChange({ ...value, types: value.types.includes(v) ? value.types.filter((t) => t !== v) : [...value.types, v] });
  }

  const count = value.branchIds.length + value.customerIds.length + value.types.length;

  return (
    <Sheet visible={visible} onClose={onClose} title="Filter Movements" maxHeightPct={80} scroll={false}>
      <View style={fs.filterTabWrap}>
        <PillTabs
          tabs={FILTER_TABS}
          value={filterTab}
          onChange={setFilterTab}
          labels={{ branch: `Branch${value.branchIds.length ? ` (${value.branchIds.length})` : ""}`, customer: `Customer${value.customerIds.length ? ` (${value.customerIds.length})` : ""}`, type: `Type${value.types.length ? ` (${value.types.length})` : ""}` }}
          inSheet
        />
      </View>
      {filterTab === "branch" ? (
        <View style={fs.filterList}>
          {branches.isLoading ? (
            <Buffering style={{ paddingVertical: 20 }} />
          ) : (
            (branches.data ?? []).map((b: Branch) => (
              <CheckItem key={b.id} checked={value.branchIds.includes(b.id)} onPress={() => toggleBranch(b.id)} title={b.name} />
            ))
          )}
        </View>
      ) : filterTab === "type" ? (
        <View style={fs.filterList}>
          {MOVEMENT_TYPE_OPTIONS.map((o) => (
            <CheckItem key={o.value} checked={value.types.includes(o.value)} onPress={() => toggleType(o.value)} title={o.label} />
          ))}
        </View>
      ) : (
        <ServerFlatList
          list={customers}
          items={customers.items}
          inSheet
          keyOf={(c) => `c${c.id}`}
          emptyText={value.branchIds.length ? "No customers in the selected branch(es)." : "No customers found."}
          header={<SearchInput value={customers.search} onChangeText={customers.setSearch} placeholder="Search customer" style={{ paddingHorizontal: 16 }} />}
          renderItem={(c) => (
            <CheckItem checked={value.customerIds.includes(c.id)} onPress={() => toggleCustomer(c.id)} title={c.name} sub={c.code} />
          )}
        />
      )}
      {count > 0 ? (
        <View style={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: 4 }}>
          <AccBtn label="Clear all filters" onPress={() => onChange(EMPTY_MOVEMENT_FILTERS)} />
        </View>
      ) : null}
    </Sheet>
  );
}
