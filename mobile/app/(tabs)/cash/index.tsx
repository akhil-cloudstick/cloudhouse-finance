import React, { useEffect, useState } from "react";
import { View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AccRow,
  AccBtn,
  Buffering,
  C,
  Card,
  CashRow,
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
  ThemeDropdown,
  Txt,
  toast,
} from "../../../src/components/ui";
import { useServerList } from "../../../src/hooks/useServerList";
import { useAuth } from "../../../src/auth/AuthContext";
import { ApiError } from "../../../src/api/client";
import {
  approveExpense,
  createCashMovement,
  createExpense,
  createGoldSale,
  getCashSummary,
  listCashMovementsPage,
  listExpensesPage,
  listGoldSalesPage,
  rejectExpense,
  setOpeningBalance,
} from "../../../src/api/cash";
import { dmy, inr, todayISO } from "../../../src/lib/format";
import type { CashMovement, Expense, GoldSale } from "../../../src/types/cash";
import { userMessage } from "../../../src/api/errors";

// Cash & Expenses — prototype #header-cash + #page-cash and the
// cash-actions / add-cash / cash-out / gold-sale / record-expense /
// opening-balance sheets. Each tab (Movements / Expenses / Gold Sales) is its
// own server-paged list with its own server-side search (`q`).

const TABS = ["movements", "expenses", "goldSales"] as const;
type Tab = (typeof TABS)[number];
type CashAction = "addCash" | "takeCashOut" | "goldSale" | "expense" | null;
const MOVE_MODES = ["Cash", "UPI", "Bank Transfer", "Cheque"] as const;
const EXPENSE_MODES = ["Cash", "UPI", "Bank Transfer"] as const;

const errMsg = (err: unknown, fallback: string) => userMessage(err, fallback);

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

  const summary = useQuery({
    queryKey: ["cash-summary", employee?.branchId, today],
    queryFn: () => getCashSummary(employee!.branchId, today),
    enabled: !!employee,
  });

  const movements = useServerList<CashMovement>({ key: ["cash-movements", "list"], fetchPage: (p) => listCashMovementsPage(p), enabled: tab === "movements" });
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
          <SearchInput value={movements.search} onChangeText={movements.setSearch} placeholder="Search by purpose or source" style={{ paddingBottom: 8 }} />
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
    <Screen header={<FlatHeader title="Cash & Expenses" subtitle="Movements, expenses & gold sales" />}>
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
                { k: "Source", v: m.source || "—" },
                { k: "Mode", v: m.mode || "—" },
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
            { key: "takeCashOut", icon: "card", title: "Take Cash Out", sub: "Record cash leaving the branch" },
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

      <MovementSheet type="in" visible={action === "addCash"} onClose={() => setAction(null)} branchId={employee?.branchId} />
      <MovementSheet type="out" visible={action === "takeCashOut"} onClose={() => setAction(null)} branchId={employee?.branchId} />
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
    </Screen>
  );
}

type FormProps = { visible: boolean; onClose: () => void; branchId?: number };

// prototype #add-cash-modal / #cash-out-modal
function MovementSheet({ type, visible, onClose, branchId }: FormProps & { type: "in" | "out" }) {
  const qc = useQueryClient();
  const [source, setSource] = useState("");
  const [purpose, setPurpose] = useState("");
  const [amount, setAmount] = useState("");
  const [mode, setMode] = useState<(typeof MOVE_MODES)[number]>("Cash");
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (visible) {
      setSource("");
      setPurpose("");
      setAmount("");
      setMode("Cash");
      setError(null);
    }
  }, [visible]);
  const m = useMutation({
    mutationFn: () => createCashMovement({ type, source: source.trim(), purpose: purpose.trim(), amount: Number(amount), mode, bank: undefined, branchId }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["cash-movements"] });
      qc.invalidateQueries({ queryKey: ["cash-summary"] });
      onClose();
    },
    onError: (err) => setError(errMsg(err, "Could not save.")),
  });
  const title = type === "in" ? "Add Cash" : "Take Cash Out";
  return (
    <Sheet visible={visible} onClose={onClose} title={title} maxHeightPct={65}>
      <Field label={type === "in" ? "Source" : "Source / Destination"}>
        <Input placeholder={type === "in" ? "e.g. Loan repayment, Bank withdrawal" : "e.g. Bank deposit, Vendor payment"} value={source} onChangeText={setSource} />
      </Field>
      <Field label="Purpose">
        <Input placeholder="Short description" value={purpose} onChangeText={setPurpose} />
      </Field>
      <Field label="Amount">
        <Input keyboardType="decimal-pad" placeholder="₹" value={amount} onChangeText={setAmount} />
      </Field>
      <Field label="Mode">
        <ChipToggle options={MOVE_MODES} value={mode} onChange={setMode} wrap />
      </Field>
      {error ? <Txt style={{ fontSize: 12, color: C.red, marginBottom: 10 }}>{error}</Txt> : null}
      <PrimaryButton label={title} onPress={() => m.mutate()} loading={m.isPending} disabled={!source.trim() || !purpose.trim() || !(Number(amount) > 0)} />
    </Sheet>
  );
}

// prototype #gold-sale-modal — live profit/loss preview.
function GoldSaleSheet({ visible, onClose, branchId }: FormProps) {
  const qc = useQueryClient();
  const [type, setType] = useState("");
  const [sold, setSold] = useState("");
  const [cost, setCost] = useState("");
  const [remarks, setRemarks] = useState("");
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (visible) {
      setType("");
      setSold("");
      setCost("");
      setRemarks("");
      setError(null);
    }
  }, [visible]);
  const profit = (Number(sold) || 0) - (Number(cost) || 0);
  const m = useMutation({
    mutationFn: () =>
      createGoldSale({ ornamentType: type.trim(), soldAmount: Number(sold), costAmount: Number(cost || 0), branchId: branchId!, remarks: remarks.trim() || undefined }),
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
      <ResultBox k="Profit / Loss" v={`${profit >= 0 ? "+" : "−"}${inr(Math.abs(profit))}`} tone={profit >= 0 ? "green" : "red"} />
      <Field label="Remarks">
        <Input placeholder="e.g. Auctioned — LN-2199" value={remarks} onChangeText={setRemarks} />
      </Field>
      {error ? <Txt style={{ fontSize: 12, color: C.red, marginBottom: 10 }}>{error}</Txt> : null}
      <PrimaryButton label="Record Gold Sale" onPress={() => m.mutate()} loading={m.isPending} disabled={!type.trim() || !(Number(sold) > 0) || !branchId} />
    </Sheet>
  );
}

// Same list as the web's ExpenseModal (frontend/common/components/modals/ExpenseModal.tsx).
const EXPENSE_CATEGORIES = ["Rent & Utilities", "Salaries", "Transportation", "Marketing", "Bank Charges", "Maintenance", "Stationery & Office", "Legal & Miscellaneous", "Other"];

// prototype #record-expense-modal
function ExpenseSheet({ visible, onClose, branchId }: FormProps) {
  const qc = useQueryClient();
  const [category, setCategory] = useState("");
  const [amount, setAmount] = useState("");
  const [mode, setMode] = useState<(typeof EXPENSE_MODES)[number]>("Cash");
  const [payee, setPayee] = useState("");
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (visible) {
      setCategory("");
      setAmount("");
      setMode("Cash");
      setPayee("");
      setError(null);
    }
  }, [visible]);
  const m = useMutation({
    mutationFn: () => createExpense({ category: category.trim(), amount: Number(amount), mode, payee: payee.trim(), branchId: branchId! }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["expenses"] });
      qc.invalidateQueries({ queryKey: ["cash-summary"] });
      onClose();
    },
    onError: (err) => setError(errMsg(err, "Could not save.")),
  });
  return (
    <Sheet visible={visible} onClose={onClose} title="Record Expense" maxHeightPct={65}>
      <Field label="Category">
        <ThemeDropdown<string> value={category || null} options={EXPENSE_CATEGORIES} onChange={setCategory} labelOf={(c) => c} placeholder="Select a category" />
      </Field>
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
      <PrimaryButton label="Record Expense" onPress={() => m.mutate()} loading={m.isPending} disabled={!category.trim() || !(Number(amount) > 0) || !payee.trim() || !branchId} />
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
