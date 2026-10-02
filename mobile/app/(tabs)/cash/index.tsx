import React, { useEffect, useMemo, useState } from "react";
import { Pressable, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AccRow,
  AsyncSelect,
  Buffering,
  C,
  Card,
  CashRow,
  ConfirmSheet,
  ChipToggle,
  ClosingCard,
  DateField,
  FabCorner,
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
import { UploadField } from "../../../src/components/staff/UploadField";
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
  PICKER_PAGE_SIZE,
  type CashSource,
  type ExpenseCategory,
} from "../../../src/api/cash";
import { createBank, listBanksPage } from "../../../src/api/banks";
import type { Bank } from "../../../src/types/bank";
import { dmy, inr, todayISO } from "../../../src/lib/format";
import type { CashMovement, Expense, GoldSale } from "../../../src/types/cash";
import { isUserCancel, userMessage } from "../../../src/api/errors";
import { shareMovementsPdf } from "../../../src/utils/ledgerExport";
import { EXPENSE_CATEGORY_IDS_KEY, LedgerLink, modeLink, openLedger, useExpenseCategoryIds } from "../../../src/components/staff/LedgerList";
import {
  EMPTY_MOVEMENT_FILTERS,
  MovementFilterSheet,
  MovementRow,
  movementFilterCount,
  movementFilterStyles as fs,
  runningBalances,
  type MovementFilters,
} from "../../../src/components/staff/MovementLedger";

// Cash & Expenses — prototype #header-cash + #page-cash and the
// cash-actions / add-cash (incl. the Gold Sale source) / record-expense
// sheets. Opening cash is carried forward server-side, so there's no
// opening-balance sheet. Each tab (Movements / Expenses / Gold Sales) is its
// own server-paged list with its own server-side search (`q`).

const TABS = ["movements", "expenses", "goldSales"] as const;
type Tab = (typeof TABS)[number];
type CashAction = "addCash" | "expense" | null;
const MOVE_MODES = ["Cash", "UPI", "Bank Transfer", "Cheque"] as const;
const EXPENSE_MODES = ["Cash", "UPI", "Bank Transfer"] as const;

const errMsg = (err: unknown, fallback: string) => userMessage(err, fallback);

export default function CashScreen() {
  const qc = useQueryClient();
  const { employee, can } = useAuth();
  // Approving / rejecting a Pending expense is the "expense" workflow stage's
  // own permission (checked server-side too), not a role-name match.
  const canApproveExpense = can("Expense_Approval", "can_approve_expense");
  const today = todayISO();

  const [tab, setTab] = useState<Tab>("movements");
  // Dashboard tiles deep-link here with ?tab=…; `t` re-applies it per tap.
  const params = useLocalSearchParams<{ tab?: string; t?: string }>();
  useEffect(() => {
    if (params.tab === "movements" || params.tab === "expenses" || params.tab === "goldSales") setTab(params.tab);
  }, [params.tab, params.t]);

  const [actionsOpen, setActionsOpen] = useState(false);
  const [action, setAction] = useState<CashAction>(null);
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
              {filterCount > 0 ? (
                <View style={fs.filterBadge}>
                  <Txt style={fs.filterBadgeTxt}>{filterCount}</Txt>
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
                    <LedgerLink label={e.category} onPress={() => openLedger("category", categoryIds[e.category.toLowerCase()], e.category)} />
                  ) : (
                    e.category
                  ),
                },
                { k: "Description", v: e.payee || "—" },
                { k: "Mode", v: modeLink(e.mode) },
                { k: "Branch", v: e.branch?.name || "—" },
                ...(e.remarks ? [{ k: "Remarks", v: e.remarks }] : []),
                ...(e.approvedBy ? [{ k: e.status === "Rejected" ? "Rejected by" : "Approved by", v: e.approvedBy }] : []),
              ]}
              actions={
                canApproveExpense && e.status === "Pending"
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
          emptyText={goldSales.search ? "No gold sales match your search." : 'No gold sales recorded yet. Use "Cash Actions" → Add Cash with the Gold Sale source.'}
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
                  ? [{ k: "Bank", v: <LedgerLink label={g.bankRef?.name || "Bank"} onPress={() => openLedger("bank", g.bankId!, g.bankRef?.name || "Bank")} /> }]
                  : []),
                { k: "Remarks", v: g.remarks || "—" },
                { k: "Date", v: dmy(g.soldOn) },
                { k: "Branch", v: g.branch?.name || "—" },
              ]}
            />
          )}
        />
      )}

      {/* Same floating Download corner button as the drill-down ledgers (LedgerList). */}
      {tab === "movements" && movements.items.length > 0 ? <FabCorner icon="download" label="Download ledger PDF" onPress={onDownload} /> : null}

      <Sheet visible={actionsOpen} onClose={() => setActionsOpen(false)} title="Cash Actions" maxHeightPct={60}>
        {(
          [
            { key: "addCash", icon: "coin", title: "Add Cash", sub: "Record cash coming in, or a gold sale" },
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

// "Gold Sale" is a built-in source, not a cash.CashSource row — picking it
// turns the Add Cash sheet into the gold-sale form and posts to /gold-sales
// (same as web's AddCashModal; the backend refuses a real source by this name).
const GOLD_SALE = "Gold Sale";
const GOLD_SALE_SOURCE: CashSource = { id: -1, name: GOLD_SALE, createdAt: "" };
const GOLD_SALE_MODES = ["Cash", "UPI", "Bank Transfer"] as const;

async function fetchSourcesWithGoldSale(q: string): Promise<CashSource[]> {
  const items = (await listCashSourcesPage(q, 0, PICKER_PAGE_SIZE)).items ?? [];
  const matches = !q || GOLD_SALE.toLowerCase().includes(q.trim().toLowerCase());
  return matches ? [GOLD_SALE_SOURCE, ...items] : items;
}

// prototype #add-cash-modal (+ #gold-sale-modal, now a source of Add Cash)
function MovementSheet({ visible, onClose, branchId }: FormProps) {
  const qc = useQueryClient();
  const [source, setSource] = useState<CashSource | null>(null);
  const [purpose, setPurpose] = useState("");
  const [amount, setAmount] = useState("");
  const [mode, setMode] = useState<(typeof MOVE_MODES)[number]>("Cash");
  // The branch's own account a UPI/Bank Transfer landed in.
  const [bank, setBank] = useState<Bank | null>(null);
  const [error, setError] = useState<string | null>(null);
  const bankRequired = mode === "UPI" || mode === "Bank Transfer";

  const isLoan = source?.name === "Loan";
  const isGoldSale = source?.name === GOLD_SALE;
  const [ornamentType, setOrnamentType] = useState("");
  const [cost, setCost] = useState("");
  const [remarks, setRemarks] = useState("");
  const profit = (Number(amount) || 0) - (Number(cost) || 0);
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
      setBank(null);
      setError(null);
      setOrnamentType("");
      setCost("");
      setRemarks("");
      setLoanBank(null);
      setLoanNumber("");
      setPrincipalAmount("");
      setInterestRate("");
      setDurationMonths("");
    }
  }, [visible]);

  const m = useMutation({
    mutationFn: async () => {
      if (isGoldSale) {
        await createGoldSale({
          ornamentType: ornamentType.trim(), soldAmount: Number(amount), costAmount: Number(cost || 0), branchId: branchId!,
          mode, bankId: bankRequired ? bank?.id : undefined,
          remarks: remarks.trim() || undefined,
        });
        return;
      }
      await createCashMovement({
        type: "in",
        source: source!.name,
        purpose: purpose.trim(),
        amount: Number(amount),
        mode,
        bank: bankRequired ? bank?.name : undefined,
        bankId: bankRequired ? bank?.id : undefined,
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
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["cash-movements"] });
      qc.invalidateQueries({ queryKey: ["cash-summary"] });
      if (isGoldSale) qc.invalidateQueries({ queryKey: ["gold-sales"] });
      onClose();
    },
    onError: (err) => setError(errMsg(err, "Could not save.")),
  });

  const loanValid = !isLoan || (!!loanBank && !!loanNumber.trim() && Number(principalAmount) > 0);
  const bankValid = !bankRequired || !!bank;
  const canSubmit = isGoldSale
    ? !!ornamentType.trim() && Number(amount) > 0 && !!branchId && bankValid
    : !!source && !!purpose.trim() && Number(amount) > 0 && loanValid && bankValid;

  return (
    <Sheet visible={visible} onClose={onClose} title="Add Cash" maxHeightPct={isLoan || isGoldSale ? 90 : 65}>
      <AsyncSelect<CashSource>
        label="Source"
        placeholder="Search or add a source (e.g. Savings, Loan, Gold Sale)"
        queryKey={["cash-sources", "picker"]}
        fetcher={fetchSourcesWithGoldSale}
        selectedLabel={source?.name}
        onSelect={(s) => {
          setSource(s);
          // Gold sales don't take Cheque.
          if (s.name === GOLD_SALE && mode === "Cheque") setMode("Cash");
        }}
        onClear={() => setSource(null)}
        keyOf={(s) => s.id}
        renderItem={(s) => ({ title: s.name })}
        onCreateNew={createCashSource}
      />
      {isGoldSale ? (
        <>
          <Field label="Ornament type">
            <Input placeholder="e.g. Gold Chain" value={ornamentType} onChangeText={setOrnamentType} />
          </Field>
          <FieldRow>
            <Field label="Sold amount">
              <Input keyboardType="decimal-pad" placeholder="₹" value={amount} onChangeText={setAmount} />
            </Field>
            <Field label="Cost amount">
              <Input keyboardType="decimal-pad" placeholder="₹" value={cost} onChangeText={setCost} />
            </Field>
          </FieldRow>
        </>
      ) : (
        <>
          <Field label="Purpose">
            <Input placeholder="Short description" value={purpose} onChangeText={setPurpose} />
          </Field>
          <Field label="Amount">
            <Input keyboardType="decimal-pad" placeholder="₹" value={amount} onChangeText={setAmount} />
          </Field>
        </>
      )}
      <Field label="Mode">
        <ChipToggle
          options={isGoldSale ? GOLD_SALE_MODES : MOVE_MODES}
          value={mode}
          onChange={(v) => { setMode(v); if (v !== "UPI" && v !== "Bank Transfer") setBank(null); }}
          wrap
        />
      </Field>
      {bankRequired ? (
        <AsyncSelect<Bank>
          label="Bank (your account)"
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
      {isGoldSale ? (
        <>
          <ResultBox k="Profit / Loss" v={`${profit >= 0 ? "+" : "−"}${inr(Math.abs(profit))}`} tone={profit >= 0 ? "green" : "red"} />
          <Field label="Remarks">
            <Input placeholder="Optional notes" value={remarks} onChangeText={setRemarks} />
          </Field>
        </>
      ) : null}

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
      <PrimaryButton label={isGoldSale ? "Record Gold Sale" : "Add Cash"} onPress={() => m.mutate()} loading={m.isPending} disabled={!canSubmit} />
    </Sheet>
  );
}

// prototype #record-expense-modal
function ExpenseSheet({ visible, onClose, branchId }: FormProps) {
  const qc = useQueryClient();
  const [category, setCategory] = useState<ExpenseCategory | null>(null);
  const [amount, setAmount] = useState("");
  const [mode, setMode] = useState<(typeof EXPENSE_MODES)[number]>("Cash");
  // Description — sent as the expense's payee, same as web's ExpenseModal.
  const [description, setDescription] = useState("");
  const [date, setDate] = useState(todayISO());
  // Uploaded "/uploads/..." URL of the receipt/bill photo, "" when none.
  const [receiptImage, setReceiptImage] = useState("");
  // From Bank — the branch account a non-Cash expense is paid from.
  const [fromBank, setFromBank] = useState<Bank | null>(null);
  const bankRequired = mode !== "Cash";
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (visible) {
      setCategory(null);
      setAmount("");
      setMode("Cash");
      setDescription("");
      setDate(todayISO());
      setReceiptImage("");
      setFromBank(null);
      setError(null);
    }
  }, [visible]);
  const m = useMutation({
    mutationFn: () =>
      createExpense({
        category: category!.name, amount: Number(amount), mode, payee: description.trim(), branchId: branchId!,
        fromBankId: bankRequired ? fromBank?.id : undefined,
        occurredOn: date || undefined,
        receiptImage: receiptImage || undefined,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["expenses"] });
      qc.invalidateQueries({ queryKey: ["cash-movements"] });
      qc.invalidateQueries({ queryKey: ["cash-summary"] });
      qc.invalidateQueries({ queryKey: EXPENSE_CATEGORY_IDS_KEY });
      onClose();
    },
    onError: (err) => setError(errMsg(err, "Could not save.")),
  });
  // A newly created category needs its ledger link resolvable right away.
  const createCategory = async (name: string) => {
    const created = await createExpenseCategory(name);
    qc.invalidateQueries({ queryKey: EXPENSE_CATEGORY_IDS_KEY });
    return created;
  };
  return (
    <Sheet visible={visible} onClose={onClose} title="Record Expense" maxHeightPct={90}>
      <Field label="Description">
        <Input placeholder="e.g. Office maintenance" value={description} onChangeText={setDescription} />
      </Field>
      <AsyncSelect<ExpenseCategory>
        label="Category"
        placeholder="Search or add a category"
        queryKey={["expense-categories", "picker"]}
        fetcher={async (q) => (await listExpenseCategoriesPage(q, 0, PICKER_PAGE_SIZE)).items ?? []}
        selectedLabel={category?.name}
        onSelect={setCategory}
        onClear={() => setCategory(null)}
        keyOf={(c) => c.id}
        renderItem={(c) => ({ title: c.name })}
        onCreateNew={createCategory}
      />
      <FieldRow>
        <Field label="Amount">
          <Input keyboardType="decimal-pad" placeholder="₹" value={amount} onChangeText={setAmount} />
        </Field>
        <DateField label="Date" value={date} onChange={setDate} max={todayISO()} />
      </FieldRow>
      <Field label="Mode">
        <ChipToggle options={EXPENSE_MODES} value={mode} onChange={(v) => { setMode(v); if (v === "Cash") setFromBank(null); }} />
      </Field>
      {bankRequired ? (
        <AsyncSelect<Bank>
          label="From Bank"
          placeholder="Search or add a bank"
          queryKey={["banks", "picker"]}
          fetcher={async (q) => (await listBanksPage({ q: q || undefined, limit: 20, offset: 0 })).items ?? []}
          selectedLabel={fromBank?.name}
          onSelect={setFromBank}
          onClear={() => setFromBank(null)}
          keyOf={(b) => b.id}
          renderItem={(b) => ({ title: b.name })}
          onCreateNew={(name) => createBank({ name })}
        />
      ) : null}
      <UploadField label="Receipt / Bill Image" value={receiptImage} onChange={setReceiptImage} allowPdf={false} />
      {error ? <Txt style={{ fontSize: 12, color: C.red, marginBottom: 10 }}>{error}</Txt> : null}
      <PrimaryButton
        label="Record Expense"
        onPress={() => m.mutate()}
        loading={m.isPending}
        disabled={!category || !(Number(amount) > 0) || !description.trim() || !date || !branchId || (bankRequired && !fromBank)}
      />
    </Sheet>
  );
}
