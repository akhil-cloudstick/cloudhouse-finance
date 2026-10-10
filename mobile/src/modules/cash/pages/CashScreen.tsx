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
  FabMenu,
  type FabMenuAction,
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
  SheetFooter,
  Txt,
  toast,
} from "@/common/components/ui";
import { useServerList } from "@/common/hooks/use-server-list";
import { UploadField } from "@/common/components/UploadField";
import { useAuth } from "@/common/providers/AuthProvider";
import { ApiError } from "@/common/services/httpClient";
import { approveExpense, createCashMovement, createCashSource, createExpense, createCategory, getLoanBalance, createExpenseCategory, createGoldSale, createSelfTransfer, getCashSummary, listCategoriesPage, listCashMovementsPage, listCashSourcesPage, listExpenseCategoriesPage, listExpensesPage, listGoldSalesPage, rejectExpense, PICKER_PAGE_SIZE } from "@/modules/cash/services/cashService";
import { type CashSource, type Category, type ExpenseCategory, type CashMovement, type Expense, type GoldSale } from "@/modules/cash/types/cash-types";
import { createBank, listBanksPage } from "@/modules/banks/services/bankService";
import { listBranchesPage } from "@/modules/branches/services/branchService";
import type { Bank } from "@/modules/banks/types/bank-types";
import { dmy, inr, todayISO } from "@/common/utils/format";
import { isUserCancel, userMessage } from "@/common/services/apiErrors";
import { shareMovementsPdf } from "@/common/utils/ledgerExport";
import { EXPENSE_CATEGORY_IDS_KEY, modeLink, openLedger, useExpenseCategoryIds } from "@/common/components/LedgerList";
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
const MOVE_MODES = ["Cash", "UPI", "Bank Transfer", "Cheque"] as const;
const EXPENSE_MODES = ["Cash", "UPI", "Bank Transfer"] as const;

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


// "Gold Sale" is a real row of the category list (returned by the server);
// picking it turns the Credit form into the gold-sale form and posts to
// /gold-sales (same as web's AddCashModal; the backend refuses a real source
// by this name, so it's never "flipped" to common either).
const GOLD_SALE = "Gold Sale";
const GOLD_SALE_MODES = ["Cash", "UPI", "Bank Transfer"] as const;
const SELF_MODES = ["Bank Transfer", "UPI", "Cash"] as const;

// A name starting with "Loan" is one bank loan (same rule as web's isLoanSource).
const isLoanSource = (name: string) => name.trim().toLowerCase().startsWith("loan");

// A search also returns categories that belong to another form. Picking one
// from another form that isn't common yet flips it to common — the same
// find-or-create POST the picker's "add" uses (fire-and-forget).
// The balance of the loan a category stands for — undefined while loading, or
// when it isn't a loan with its details on file. Fresh on every open.
function useLoanBalance(cat: { id: number; name: string; principalAmount?: number } | null) {
  const id = cat && cat.id > 0 && isLoanSource(cat.name) && cat.principalAmount != null ? cat.id : 0;
  const q = useQuery({ queryKey: ["loan-balance", id], queryFn: () => getLoanBalance(id), enabled: id > 0, staleTime: 0, gcTime: 0 });
  return id > 0 ? q.data ?? null : null;
}

type LoanWarningProps = { text: string };

function LoanWarning({ text }: LoanWarningProps) {
  return text ? <Txt style={{ fontSize: 12.5, color: C.red, marginBottom: 10 }}>{text}</Txt> : null;
}

function flipToCommon(item: { name: string; type?: string; isCommon?: boolean }, own: string, post: (name: string) => Promise<unknown>) {
  if (item.type && item.type !== own && !item.isCommon && item.name !== GOLD_SALE) post(item.name).catch(() => {});
}

const ENTRY_TYPES = ["credit", "debit", "self"] as const;
type EntryType = (typeof ENTRY_TYPES)[number];
const ENTRY_LABELS = { credit: "Credit (Cash In)", debit: "Debit (Expense)", self: "Self Transfer" } as const;

type AddEntrySheetProps = { visible: boolean; onClose: () => void };

// The Ledger's single "Add Entry" sheet — a Credit / Debit / Self Transfer
// switch on top, each tab one form (mirrors web's AddEntryModal). Every form
// follows one order: Category → Date → Mode → (Bank) → Amount → Branch → Bill.
function AddEntrySheet({ visible, onClose }: AddEntrySheetProps) {
  const [type, setType] = useState<EntryType>("credit");
  // Bumped per open so each tab starts from a clean form.
  const [session, setSession] = useState(0);
  useEffect(() => {
    if (visible) {
      setType("credit");
      setSession((n) => n + 1);
    }
  }, [visible]);
  const key = `${type}-${session}`;
  return (
    <Sheet visible={visible} onClose={onClose} title="Add Entry" maxHeightPct={90}>
      <Field>
        <ChipToggle options={ENTRY_TYPES} value={type} onChange={setType} labels={ENTRY_LABELS} />
      </Field>
      {type === "debit" ? <DebitForm key={key} onClose={onClose} /> : type === "self" ? <SelfTransferForm key={key} onClose={onClose} /> : <CreditForm key={key} onClose={onClose} />}
    </Sheet>
  );
}

type BranchPick = { id: number; name: string };

type BranchFieldProps = { branch: BranchPick | null; onChange: (b: BranchPick) => void };

// Branch — a cross-branch user picks one, everyone else books into their own
// branch (read-only; also the lock for a single-branch business).
function BranchField({ branch, onChange }: BranchFieldProps) {
  const { can } = useAuth();
  if (can("Branch_Management", "can_view_all_branches")) {
    return (
      <AsyncSelect<{ id: number; name: string; code?: string }>
        label="Branch"
        placeholder="Search branch"
        queryKey={["branches", "entry-picker"]}
        fetcher={async (q) => (await listBranchesPage({ q: q || undefined, active: true, limit: 20, offset: 0 })).items ?? []}
        selectedLabel={branch?.name}
        onSelect={(b) => onChange({ id: b.id, name: b.name })}
        keyOf={(b) => b.id}
        renderItem={(b) => ({ title: b.name, sub: b.code })}
      />
    );
  }
  return (
    <Field label="Branch">
      <Input value={branch?.name ?? ""} editable={false} />
    </Field>
  );
}

function useOwnBranch() {
  const { employee } = useAuth();
  return useState<BranchPick | null>(employee ? { id: employee.branchId, name: employee.branch?.name ?? "Your branch" } : null);
}

type BankPickerProps = { label: string; bank: Bank | null; onChange: (b: Bank | null) => void };

function BankPicker({ label, bank, onChange }: BankPickerProps) {
  const canCreateBank = useAuth().can("Bank_Management", "can_create_bank");
  return (
    <AsyncSelect<Bank>
      label={label}
      placeholder="Search or add a bank"
      queryKey={["banks", "picker"]}
      fetcher={async (q) => (await listBanksPage({ q: q || undefined, limit: 20, offset: 0 })).items ?? []}
      selectedLabel={bank?.name}
      onSelect={onChange}
      onClear={() => onChange(null)}
      keyOf={(b) => b.id}
      renderItem={(b) => ({ title: b.name })}
      onCreateNew={canCreateBank ? (name) => createBank({ name }) : undefined}
    />
  );
}

type CreditFormProps = { onClose: () => void };

// Credit (Cash In) — prototype #add-cash-modal (+ #gold-sale-modal, a source of it)
function CreditForm({ onClose }: CreditFormProps) {
  const qc = useQueryClient();
  const [source, setSource] = useState<CashSource | null>(null);
  const [amount, setAmount] = useState("");
  const [mode, setMode] = useState<(typeof MOVE_MODES)[number]>("Cash");
  const [date, setDate] = useState(todayISO());
  // The branch's own account a UPI/Bank Transfer landed in.
  const [bank, setBank] = useState<Bank | null>(null);
  const [branch, setBranch] = useOwnBranch();
  // Uploaded "/uploads/..." URL of the bill, "" when none.
  const [receiptImage, setReceiptImage] = useState("");
  const [error, setError] = useState<string | null>(null);
  const bankRequired = mode === "UPI" || mode === "Bank Transfer";

  const isLoan = !!source && isLoanSource(source.name);
  const isGoldSale = source?.name === GOLD_SALE;
  // A loan source asks for its details only once — on its first entry.
  const needsLoanDetails = isLoan && source?.principalAmount == null;
  const [ornamentType, setOrnamentType] = useState("");
  const [cost, setCost] = useState("");
  const [remarks, setRemarks] = useState("");
  const profit = (Number(amount) || 0) - (Number(cost) || 0);
  const [loanBank, setLoanBank] = useState<Bank | null>(null);
  const [loanNumber, setLoanNumber] = useState("");
  const [principalAmount, setPrincipalAmount] = useState("");
  const [interestRate, setInterestRate] = useState("");
  const [durationMonths, setDurationMonths] = useState("");
  const branchId = branch?.id;

  const m = useMutation({
    mutationFn: async () => {
      if (isGoldSale) {
        await createGoldSale({
          ornamentType: ornamentType.trim(), soldAmount: Number(amount), costAmount: Number(cost || 0), branchId: branchId!,
          mode, bankId: bankRequired ? bank?.id : undefined,
          soldOn: date, receiptImage: receiptImage || undefined,
          remarks: remarks.trim() || undefined,
        });
        return;
      }
      await createCashMovement({
        type: "in",
        source: source!.name,
        amount: Number(amount),
        mode,
        bank: bankRequired ? bank?.name : needsLoanDetails ? loanBank?.name : undefined,
        bankId: bankRequired ? bank?.id : undefined,
        branchId,
        occurredOn: date,
        receiptImage: receiptImage || undefined,
        loanSource: needsLoanDetails
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
      // A loan's first entry also created its repayment category server side.
      if (needsLoanDetails) qc.invalidateQueries({ queryKey: EXPENSE_CATEGORY_IDS_KEY });
      onClose();
    },
    onError: (err) => setError(errMsg(err, "Could not save.")),
  });

  const loanValid = !needsLoanDetails || (!!loanBank && !!loanNumber.trim() && Number(principalAmount) > 0 && Number(amount) <= Number(principalAmount));
  const bankValid = !bankRequired || !!bank;
  // A loan can't be drawn past its principal: a new loan checks the amount against
  // the principal typed in, an existing one against what is left to draw.
  const loanBal = useLoanBalance(source);
  const drawAmount = Number(amount) || 0;
  const loanLimit = needsLoanDetails ? Number(principalAmount) || 0 : loanBal ? loanBal.balance : 0;
  const loanExceeded = isLoan && !isGoldSale && drawAmount > 0 && (needsLoanDetails ? loanLimit > 0 : !!loanBal) && drawAmount > loanLimit + 0.005;
  const loanWarning = loanExceeded ? `Loan principal amount exceeded — only ${inr(Math.max(loanLimit, 0))} is left to draw on ${source?.name}.` : "";
  const canSubmit = !loanExceeded && (isGoldSale
    ? !!ornamentType.trim() && Number(amount) > 0 && !!date && !!branchId && bankValid
    : !!source && Number(amount) > 0 && !!date && !!branchId && loanValid && bankValid);

  return (
    <>
      <AsyncSelect<CashSource>
        label="Category"
        placeholder="Search or add a category (e.g. Savings, Loan, Gold Sale)"
        queryKey={["cash-sources", "picker"]}
        fetcher={async (q) => (await listCashSourcesPage(q, 0, PICKER_PAGE_SIZE)).items ?? []}
        selectedLabel={source?.name}
        onSelect={(s) => {
          setSource(s);
          flipToCommon(s, "cash_in", createCashSource);
          // Gold sales don't take Cheque.
          if (s.name === GOLD_SALE && mode === "Cheque") setMode("Cash");
        }}
        onClear={() => setSource(null)}
        keyOf={(s) => s.id}
        renderItem={(s) => ({ title: s.name })}
        onCreateNew={createCashSource}
      />

      {needsLoanDetails ? (
        <View style={{ borderWidth: 1, borderColor: C.line, borderStyle: "dashed", borderRadius: 10, padding: 12, marginBottom: 10 }}>
          <Txt style={{ fontSize: 12, fontWeight: "700", color: C.brandDeep, marginBottom: 8 }}>LOAN DETAILS</Txt>
          <BankPicker label="Bank" bank={loanBank} onChange={setLoanBank} />
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

      {isGoldSale ? (
        <FieldRow>
          <Field label="Ornament type">
            <Input placeholder="e.g. Gold Chain" value={ornamentType} onChangeText={setOrnamentType} />
          </Field>
          <Field label="Cost amount">
            <Input keyboardType="decimal-pad" placeholder="₹" value={cost} onChangeText={setCost} />
          </Field>
        </FieldRow>
      ) : null}

      <DateField label={needsLoanDetails ? "Date of Loan" : "Date"} value={date} onChange={setDate} max={todayISO()} />
      <Field label="Mode">
        <ChipToggle
          options={isGoldSale ? GOLD_SALE_MODES : MOVE_MODES}
          value={mode}
          onChange={(v) => { setMode(v); if (v !== "UPI" && v !== "Bank Transfer") setBank(null); }}
          wrap
        />
      </Field>
      {bankRequired ? <BankPicker label="Bank (your account)" bank={bank} onChange={setBank} /> : null}
      <Field label={isGoldSale ? "Sold amount" : "Amount"}>
        <Input keyboardType="decimal-pad" placeholder="₹" value={amount} onChangeText={setAmount} />
      </Field>
      <BranchField branch={branch} onChange={setBranch} />
      <UploadField label="Bill" value={receiptImage} onChange={setReceiptImage} allowPdf={false} />
      {isGoldSale ? (
        <>
          <ResultBox k="Profit / Loss" v={`${profit >= 0 ? "+" : "−"}${inr(Math.abs(profit))}`} tone={profit >= 0 ? "green" : "red"} />
          <Field label="Remarks">
            <Input placeholder="Optional notes" value={remarks} onChangeText={setRemarks} />
          </Field>
        </>
      ) : null}

      <LoanWarning text={loanWarning} />
      {error ? <Txt style={{ fontSize: 12, color: C.red, marginBottom: 10 }}>{error}</Txt> : null}
      <SheetFooter>
        <PrimaryButton label={isGoldSale ? "Record Gold Sale" : "Add Cash"} onPress={() => m.mutate()} loading={m.isPending} disabled={!canSubmit} />
      </SheetFooter>
    </>
  );
}

type DebitFormProps = { onClose: () => void };

// Debit (Expense) — prototype #record-expense-modal
function DebitForm({ onClose }: DebitFormProps) {
  const qc = useQueryClient();
  const [category, setCategory] = useState<ExpenseCategory | null>(null);
  // An expense under a loan is a repayment — it can't exceed what has been drawn
  // and not yet repaid.
  const loanBal = useLoanBalance(category);
  const [amount, setAmount] = useState("");
  const [mode, setMode] = useState<(typeof EXPENSE_MODES)[number]>("Cash");
  const [date, setDate] = useState(todayISO());
  const [branch, setBranch] = useOwnBranch();
  // Uploaded "/uploads/..." URL of the receipt/bill photo, "" when none.
  const [receiptImage, setReceiptImage] = useState("");
  // From Bank — the branch account a non-Cash expense is paid from.
  const [fromBank, setFromBank] = useState<Bank | null>(null);
  const bankRequired = mode !== "Cash";
  const [error, setError] = useState<string | null>(null);
  const branchId = branch?.id;
  const owed = loanBal ? Math.max(loanBal.drawn - loanBal.repaid, 0) : 0;
  const debitExceeded = !!loanBal && (Number(amount) || 0) > owed + 0.005;
  const debitWarning = debitExceeded ? `Repayment exceeds what has been paid on ${category?.name} — only ${inr(owed)} is outstanding.` : "";

  const m = useMutation({
    mutationFn: () =>
      createExpense({
        category: category!.name, amount: Number(amount), mode, branchId: branchId!,
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
    <>
      <AsyncSelect<ExpenseCategory>
        label="Category"
        placeholder="Search or add a category"
        queryKey={["expense-categories", "picker"]}
        fetcher={async (q) => (await listExpenseCategoriesPage(q, 0, PICKER_PAGE_SIZE)).items ?? []}
        selectedLabel={category?.name}
        onSelect={(c) => {
          setCategory(c);
          flipToCommon(c, "expense", createCategory);
        }}
        onClear={() => setCategory(null)}
        keyOf={(c) => c.id}
        renderItem={(c) => ({ title: c.name })}
        onCreateNew={createCategory}
      />
      <DateField label="Date" value={date} onChange={setDate} max={todayISO()} />
      <Field label="Mode">
        <ChipToggle options={EXPENSE_MODES} value={mode} onChange={(v) => { setMode(v); if (v === "Cash") setFromBank(null); }} />
      </Field>
      {bankRequired ? <BankPicker label="From Bank" bank={fromBank} onChange={setFromBank} /> : null}
      <Field label="Amount">
        <Input keyboardType="decimal-pad" placeholder="₹" value={amount} onChangeText={setAmount} />
      </Field>
      <BranchField branch={branch} onChange={setBranch} />
      <UploadField label="Bill" value={receiptImage} onChange={setReceiptImage} allowPdf={false} />
      <LoanWarning text={debitWarning} />
      {error ? <Txt style={{ fontSize: 12, color: C.red, marginBottom: 10 }}>{error}</Txt> : null}
      <SheetFooter>
        <PrimaryButton
          label="Record Expense"
          onPress={() => m.mutate()}
          loading={m.isPending}
          disabled={!category || !(Number(amount) > 0) || !date || !branchId || (bankRequired && !fromBank) || debitExceeded}
        />
      </SheetFooter>
    </>
  );
}

type SelfTransferFormProps = { onClose: () => void };

// Self Transfer — moves money between two of the business's own banks: a debit
// on From Bank and a credit on To Bank. A loan category locks To Bank to the
// loan's bank and books the transfer as a repayment on that loan.
function SelfTransferForm({ onClose }: SelfTransferFormProps) {
  const qc = useQueryClient();
  const [category, setCategory] = useState<Category | null>(null);
  const [amount, setAmount] = useState("");
  const [mode, setMode] = useState<(typeof SELF_MODES)[number]>("Bank Transfer");
  const [date, setDate] = useState(todayISO());
  const [fromBank, setFromBank] = useState<Bank | null>(null);
  const [toBank, setToBank] = useState<Bank | null>(null);
  const [branch, setBranch] = useOwnBranch();
  const [receiptImage, setReceiptImage] = useState("");
  const [error, setError] = useState<string | null>(null);
  const branchId = branch?.id;

  const loan = category && isLoanSource(category.name) ? category : null;
  const loanBank = loan?.bank?.name ?? "";
  // A transfer to a loan is a repayment — it can't exceed what has been drawn and
  // not yet repaid.
  const loanBal = useLoanBalance(loan);
  const owed = loanBal ? Math.max(loanBal.drawn - loanBal.repaid, 0) : 0;
  const loanExceeded = !!loanBal && (Number(amount) || 0) > owed + 0.005;
  const loanWarning = loanExceeded ? `Repayment exceeds what has been paid on ${category?.name} — only ${inr(owed)} is outstanding.` : "";
  const loanReady = !!loan && loan.principalAmount != null && !!loan.bankId;

  const m = useMutation({
    mutationFn: () =>
      createSelfTransfer({
        category: category!.name, amount: Number(amount), fromBankId: fromBank!.id, fromBank: fromBank!.name,
        toBankId: loan ? undefined : toBank!.id, toBank: loan ? loanBank : toBank!.name,
        mode, receiptImage: receiptImage || undefined, branchId, occurredOn: date,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["cash-movements"] });
      qc.invalidateQueries({ queryKey: ["cash-summary"] });
      onClose();
    },
    onError: (err) => setError(errMsg(err, "Could not save.")),
  });

  function submit() {
    if (loan && !loanReady) {
      setError("This loan has no bank recorded yet — add cash from it first.");
      return;
    }
    if (!loan && toBank && fromBank && toBank.id === fromBank.id) {
      setError("From Bank and To Bank must be different.");
      return;
    }
    setError(null);
    m.mutate();
  }

  return (
    <>
      <AsyncSelect<Category>
        label="Category"
        placeholder="Search or add a category"
        queryKey={["categories", "self_transfer", "picker"]}
        fetcher={async (q) => (await listCategoriesPage("self_transfer", q, 0, PICKER_PAGE_SIZE)).items ?? []}
        selectedLabel={category?.name}
        onSelect={(c) => {
          setCategory(c);
          flipToCommon(c, "self_transfer", (name) => createCategory("self_transfer", name));
        }}
        onClear={() => setCategory(null)}
        keyOf={(c) => c.id}
        renderItem={(c) => ({ title: c.name })}
        onCreateNew={(name) => createCategory("self_transfer", name)}
      />
      <DateField label="Date" value={date} onChange={setDate} max={todayISO()} />
      <Field label="Mode">
        <ChipToggle options={SELF_MODES} value={mode} onChange={setMode} />
      </Field>
      <BankPicker label="From Bank" bank={fromBank} onChange={setFromBank} />
      {loan ? (
        <Field label="To Bank (loan's bank)">
          <Input value={loanBank || "No bank recorded for this loan"} editable={false} />
        </Field>
      ) : (
        <BankPicker label="To Bank" bank={toBank} onChange={setToBank} />
      )}
      <Field label="Amount">
        <Input keyboardType="decimal-pad" placeholder="₹" value={amount} onChangeText={setAmount} />
      </Field>
      <BranchField branch={branch} onChange={setBranch} />
      <UploadField label="Bill" value={receiptImage} onChange={setReceiptImage} allowPdf={false} />
      <LoanWarning text={loanWarning} />
      {error ? <Txt style={{ fontSize: 12, color: C.red, marginBottom: 10 }}>{error}</Txt> : null}
      <SheetFooter>
        <PrimaryButton
          label="Record Transfer"
          onPress={submit}
          loading={m.isPending}
          disabled={!category || !(Number(amount) > 0) || !date || !fromBank || (!loan && !toBank) || !branchId || loanExceeded}
        />
      </SheetFooter>
    </>
  );
}
