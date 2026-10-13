import React, { useEffect, useState } from "react";
import { View } from "react-native";
import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import {
  AsyncSelect,
  C,
  ChipToggle,
  DateField,
  Field,
  FieldRow,
  Input,
  PrimaryButton,
  ResultBox,
  Sheet,
  SheetFooter,
  Txt,
} from "@/common/components/ui";
import { UploadField } from "@/common/components/UploadField";
import { EXPENSE_CATEGORY_IDS_KEY } from "@/common/components/LedgerList";
import { inr, todayISO } from "@/common/utils/format";
import type { Bank } from "@/modules/banks/types/bank-types";
import {
  createCashMovement,
  createCashSource,
  createCategory,
  createExpense,
  createExpenseCategory,
  createGoldSale,
  createSelfTransfer,
  getExpenseEntry,
  getMovementEntry,
  saveEntryEdit,
  listCashSourcesPage,
  listCategoriesPage,
  listExpenseCategoriesPage,
  updateMovementEntry,
  PICKER_PAGE_SIZE,
} from "@/modules/cash/services/cashService";
import type { CashSource, Category, EntryInfo, ExpenseCategory } from "@/modules/cash/types/cash-types";
import {
  BankPicker,
  BranchField,
  GOLD_SALE,
  GOLD_SALE_MODES,
  LoanWarning,
  SELF_MODES,
  errMsg,
  flipToCommon,
  isLoanSource,
  useLoanBalance,
  useOwnBranch,
} from "./EntryFormParts";
import { PaymentBreakdownFields, newPaymentRow, paymentRowsError, paymentRowsToInput, type PaymentRow } from "./PaymentBreakdownFields";

// Credit / Debit / Self Transfer entry forms. Credit and Debit follow one
// order: Category → Amount → Date → Mode (with its payment breakdown) →
// Branch → Bill → Remarks. Self Transfer keeps its own order and a single
// Mode, with Remarks added. Each form also opens on an existing entry (`edit`)
// from the ledger's Edit button.

/** Every list an entry shows up in — reloaded after one is added or edited. */
export function refreshCashQueries(qc: QueryClient) {
  for (const key of ["cash-movements", "cash-summary", "ledger", "branch-ledger", "expenses", "cash-entry"]) {
    qc.invalidateQueries({ queryKey: [key] });
  }
}

// The entry's lines as payment rows, for an edit.
const rowsOf = (edit: EntryInfo): PaymentRow[] =>
  edit.lines.map((l) =>
    newPaymentRow({
      mode: (l.mode as PaymentRow["mode"]) || "Cash",
      amount: String(l.amount),
      bank: l.bankId ? ({ id: l.bankId, name: l.bankName ?? "", createdAt: "", updatedAt: "" } as Bank) : null,
      auto: false,
    })
  );

const branchOf = (edit?: EntryInfo) => (edit?.branchId ? { id: edit.branchId, name: edit.branchName } : null);

const ENTRY_TYPES = ["credit", "debit", "self"] as const;
type EntryType = (typeof ENTRY_TYPES)[number];
const ENTRY_LABELS = { credit: "Credit (Cash In)", debit: "Debit (Expense)", self: "Self Transfer" } as const;

type AddEntrySheetProps = { visible: boolean; onClose: () => void };

// The Ledger's single "Add Entry" sheet — a Credit / Debit / Self Transfer
// switch on top, each tab one form (mirrors web's AddEntryModal).
export function AddEntrySheet({ visible, onClose }: AddEntrySheetProps) {
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

// viaExpense: entryId is an expense id (the Expenses list's Edit action), not a cash movement.
type EditEntrySheetProps = { entryId: number | null; onClose: () => void; viaExpense?: boolean };

// The ledger's Edit button for a cash-in, a debit or a self transfer: loads the
// entry and opens the same form it was recorded with, filled in.
export function EditEntrySheet({ entryId, onClose, viaExpense }: EditEntrySheetProps) {
  const q = useQuery({ queryKey: ["cash-entry", viaExpense ? "expense" : "movement", entryId], queryFn: () => (viaExpense ? getExpenseEntry(entryId!) : getMovementEntry(entryId!)), enabled: entryId != null, staleTime: 0, gcTime: 0 });
  const info = q.data;
  const title = info?.kind === "debit" ? "Edit Expense" : info?.kind === "self_transfer" ? "Edit Self Transfer" : "Edit Cash-In";
  return (
    <Sheet visible={entryId != null} onClose={onClose} title={title} maxHeightPct={90}>
      {info ? (
        info.kind === "debit" ? <DebitForm key={info.movementId} onClose={onClose} edit={info} />
        : info.kind === "self_transfer" ? <SelfTransferForm key={info.movementId} onClose={onClose} edit={info} />
        : <CreditForm key={info.movementId} onClose={onClose} edit={info} />
      ) : (
        <Txt style={{ fontSize: 13, color: q.isError ? C.red : C.muted }}>{q.isError ? "Could not load this entry." : "Loading…"}</Txt>
      )}
    </Sheet>
  );
}

type CreditFormProps = { onClose: () => void; edit?: EntryInfo };

// Credit (Cash In) — prototype #add-cash-modal (+ #gold-sale-modal, a source of it)
function CreditForm({ onClose, edit }: CreditFormProps) {
  const qc = useQueryClient();
  const [source, setSource] = useState<CashSource | null>(edit ? ({ id: 0, name: edit.category, createdAt: "" } as CashSource) : null);
  const [amount, setAmount] = useState(edit ? String(edit.amount) : "");
  const [date, setDate] = useState(edit ? edit.occurredOn.slice(0, 10) : todayISO());
  // The payment breakdown. A Gold Sale keeps a single Mode / Bank instead.
  const [payRows, setPayRows] = useState<PaymentRow[]>(() => (edit ? rowsOf(edit) : [newPaymentRow()]));
  const goldEdit = edit?.kind === "gold_sale" ? edit : undefined;
  const [mode, setMode] = useState<(typeof GOLD_SALE_MODES)[number]>((goldEdit?.lines[0]?.mode as (typeof GOLD_SALE_MODES)[number]) || "Cash");
  const [bank, setBank] = useState<Bank | null>(goldEdit?.lines[0]?.bankId ? ({ id: goldEdit.lines[0].bankId, name: goldEdit.lines[0].bankName ?? "", createdAt: "", updatedAt: "" } as Bank) : null);
  const [branch, setBranch] = useOwnBranch(branchOf(edit));
  // Uploaded "/uploads/..." URL of the bill, "" when none.
  const [receiptImage, setReceiptImage] = useState("");
  const [remarks, setRemarks] = useState(edit?.remarks ?? "");
  const [error, setError] = useState<string | null>(null);
  const bankRequired = mode === "UPI" || mode === "Bank Transfer";

  const isLoan = !!source && isLoanSource(source.name);
  const isGoldSale = source?.name === GOLD_SALE;
  // A loan source asks for its details only once — on its first entry.
  const needsLoanDetails = isLoan && source?.principalAmount == null && !edit;
  const [ornamentType, setOrnamentType] = useState(edit?.ornamentType ?? "");
  const [cost, setCost] = useState(edit?.costAmount ? String(edit.costAmount) : "");
  const profit = (Number(amount) || 0) - (Number(cost) || 0);
  const [loanNumber, setLoanNumber] = useState("");
  const [principalAmount, setPrincipalAmount] = useState("");
  const [interestRate, setInterestRate] = useState("");
  const [durationMonths, setDurationMonths] = useState("");
  const branchId = branch?.id;

  const m = useMutation({
    mutationFn: async () => {
      if (isGoldSale) {
        if (edit) {
          await updateMovementEntry(edit.movementId, {
            category: GOLD_SALE, ornamentType: ornamentType.trim(), costAmount: Number(cost || 0), amount: Number(amount), occurredOn: date,
            remarks: remarks.trim(), branchId, mode, bankId: bankRequired ? bank?.id : undefined, receiptImage: receiptImage || undefined,
          });
          return;
        }
        await createGoldSale({
          ornamentType: ornamentType.trim(), soldAmount: Number(amount), costAmount: Number(cost || 0), branchId: branchId!,
          mode, bankId: bankRequired ? bank?.id : undefined,
          soldOn: date, receiptImage: receiptImage || undefined,
          remarks: remarks.trim() || undefined,
        });
        return;
      }
      const payments = paymentRowsToInput(payRows);
      if (edit) {
        await updateMovementEntry(edit.movementId, {
          category: source!.name, amount: Number(amount), occurredOn: date, remarks: remarks.trim(), branchId,
          payments, receiptImage: receiptImage || undefined,
        });
        return;
      }
      await createCashMovement({
        type: "in",
        source: source!.name,
        amount: Number(amount),
        branchId,
        occurredOn: date,
        receiptImage: receiptImage || undefined,
        remarks: remarks.trim() || undefined,
        payments,
        loanSource: needsLoanDetails
          ? {
              loanNumber: loanNumber.trim(),
              principalAmount: Number(principalAmount),
              interestRate: interestRate.trim() ? Number(interestRate) : undefined,
              durationMonths: durationMonths.trim() ? Number(durationMonths) : undefined,
            }
          : undefined,
      });
    },
    onSuccess: () => {
      refreshCashQueries(qc);
      if (isGoldSale) qc.invalidateQueries({ queryKey: ["gold-sales"] });
      // A loan's first entry also created its repayment category server side.
      if (needsLoanDetails) qc.invalidateQueries({ queryKey: EXPENSE_CATEGORY_IDS_KEY });
      onClose();
    },
    onError: (err) => setError(errMsg(err, "Could not save.")),
  });

  const loanValid = !needsLoanDetails || (!!loanNumber.trim() && Number(principalAmount) > 0 && Number(amount) <= Number(principalAmount));
  const bankValid = !bankRequired || !!bank;
  const payValid = paymentRowsError(payRows, Number(amount) || 0) === "";
  // A loan can't be drawn past its principal: a new loan checks the amount against
  // the principal typed in, an existing one against what is left to draw.
  const loanBal = useLoanBalance(source);
  const drawAmount = Number(amount) || 0;
  const loanLimit = needsLoanDetails ? Number(principalAmount) || 0 : loanBal ? loanBal.balance : 0;
  const loanExceeded = isLoan && !isGoldSale && drawAmount > 0 && (needsLoanDetails ? loanLimit > 0 : !!loanBal) && drawAmount > loanLimit + 0.005;
  const loanWarning = loanExceeded ? `Loan principal amount exceeded — only ${inr(Math.max(loanLimit, 0))} is left to draw on ${source?.name}.` : "";
  // An edited gold sale stays a gold sale, and any other cash-in can't become one.
  const editBlocked = !!edit && (edit.kind === "gold_sale" ? !isGoldSale : isGoldSale);
  const canSubmit = !loanExceeded && !editBlocked && (isGoldSale
    ? !!ornamentType.trim() && Number(amount) > 0 && !!date && !!branchId && bankValid
    : !!source && Number(amount) > 0 && !!date && !!branchId && loanValid && payValid);

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
        }}
        onClear={() => setSource(null)}
        keyOf={(s) => s.id}
        renderItem={(s) => ({ title: s.name })}
        onCreateNew={createCashSource}
      />

      {needsLoanDetails ? (
        <View style={{ borderWidth: 1, borderColor: C.line, borderStyle: "dashed", borderRadius: 10, padding: 12, marginBottom: 10 }}>
          <Txt style={{ fontSize: 12, fontWeight: "700", color: C.brandDeep, marginBottom: 8 }}>LOAN DETAILS</Txt>
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

      {edit && isLoan ? (
        <View style={{ borderWidth: 1, borderColor: C.line, borderStyle: "dashed", borderRadius: 10, padding: 12, marginBottom: 10 }}>
          <Txt style={{ fontSize: 12, fontWeight: "700", color: C.brandDeep, marginBottom: 8 }}>LOAN DETAILS</Txt>
          <Field label="Loan Number">
            <Input value={edit.loanNumber || "—"} editable={false} />
          </Field>
          <Field label="Principal Amount (₹)">
            <Input value={edit.principalAmount ? String(edit.principalAmount) : "—"} editable={false} />
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

      {isGoldSale ? (
        <>
          <DateField label="Date" value={date} onChange={setDate} max={todayISO()} />
          <Field label="Mode">
            <ChipToggle
              options={GOLD_SALE_MODES}
              value={mode}
              onChange={(v) => { setMode(v); if (v !== "UPI" && v !== "Bank Transfer") setBank(null); }}
              wrap
            />
          </Field>
          {bankRequired ? <BankPicker label="Bank (your account)" bank={bank} onChange={setBank} /> : null}
          <Field label="Sold amount">
            <Input keyboardType="decimal-pad" placeholder="₹" value={amount} onChangeText={setAmount} />
          </Field>
          <BranchField branch={branch} onChange={setBranch} />
        </>
      ) : (
        <>
          <Field label="Amount">
            <Input keyboardType="decimal-pad" placeholder="₹" value={amount} onChangeText={setAmount} />
          </Field>
          <DateField label={needsLoanDetails ? "Date of Loan" : "Date"} value={date} onChange={setDate} max={todayISO()} />
          <PaymentBreakdownFields total={Number(amount) || 0} rows={payRows} onChange={setPayRows} bankLabel="Bank (your account)" />
          <BranchField branch={branch} onChange={setBranch} />
        </>
      )}
      <UploadField label="Bill" value={receiptImage} onChange={setReceiptImage} allowPdf={false} />
      {isGoldSale ? <ResultBox k="Profit / Loss" v={`${profit >= 0 ? "+" : "−"}${inr(Math.abs(profit))}`} tone={profit >= 0 ? "green" : "red"} /> : null}
      <Field label="Remarks">
        <Input placeholder="Optional notes" value={remarks} onChangeText={setRemarks} />
      </Field>

      <LoanWarning text={loanWarning} />
      {editBlocked ? <Txt style={{ fontSize: 12, color: C.red, marginBottom: 10 }}>A gold sale can&apos;t be turned into another category, or the other way round.</Txt> : null}
      {error ? <Txt style={{ fontSize: 12, color: C.red, marginBottom: 10 }}>{error}</Txt> : null}
      <SheetFooter>
        <PrimaryButton label={edit ? "Save Changes" : isGoldSale ? "Record Gold Sale" : "Add Cash"} onPress={() => m.mutate()} loading={m.isPending} disabled={!canSubmit} />
      </SheetFooter>
    </>
  );
}

type DebitFormProps = { onClose: () => void; edit?: EntryInfo };

// Debit (Expense) — prototype #record-expense-modal
function DebitForm({ onClose, edit }: DebitFormProps) {
  const qc = useQueryClient();
  const [category, setCategory] = useState<ExpenseCategory | null>(edit ? ({ id: 0, name: edit.category, createdAt: "" } as ExpenseCategory) : null);
  // An expense under a loan is a repayment — it can't exceed what has been drawn
  // and not yet repaid.
  const loanBal = useLoanBalance(category);
  const [amount, setAmount] = useState(edit ? String(edit.amount) : "");
  const [date, setDate] = useState(edit ? edit.occurredOn.slice(0, 10) : todayISO());
  // The payment breakdown — each line is the mode, its amount and, for UPI /
  // Bank Transfer, the branch account the expense is paid from.
  const [payRows, setPayRows] = useState<PaymentRow[]>(() => (edit ? rowsOf(edit) : [newPaymentRow()]));
  const [branch, setBranch] = useOwnBranch(branchOf(edit));
  // Uploaded "/uploads/..." URL of the receipt/bill photo, "" when none.
  const [receiptImage, setReceiptImage] = useState("");
  const [remarks, setRemarks] = useState(edit?.remarks ?? "");
  const [error, setError] = useState<string | null>(null);
  const branchId = branch?.id;
  const owed = loanBal ? Math.max(loanBal.drawn - loanBal.repaid, 0) : 0;
  const debitExceeded = !!loanBal && (Number(amount) || 0) > owed + 0.005;
  const debitWarning = debitExceeded ? `Repayment exceeds what has been paid on ${category?.name} — only ${inr(owed)} is outstanding.` : "";
  const payValid = paymentRowsError(payRows, Number(amount) || 0) === "";

  const m = useMutation({
    mutationFn: async () => {
      const payments = paymentRowsToInput(payRows);
      if (edit) {
        await saveEntryEdit(edit, {
          category: category!.name, amount: Number(amount), occurredOn: date, remarks: remarks.trim(), branchId,
          payments, receiptImage: receiptImage || undefined,
        });
        return;
      }
      await createExpense({
        category: category!.name, amount: Number(amount), mode: payments[0].mode, branchId: branchId!,
        occurredOn: date || undefined,
        receiptImage: receiptImage || undefined,
        remarks: remarks.trim() || undefined,
        payments,
      });
    },
    onSuccess: () => {
      refreshCashQueries(qc);
      qc.invalidateQueries({ queryKey: EXPENSE_CATEGORY_IDS_KEY });
      onClose();
    },
    onError: (err) => setError(errMsg(err, "Could not save.")),
  });
  // A newly created category needs its ledger link resolvable right away.
  const createCat = async (name: string) => {
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
          flipToCommon(c, "expense", createCat);
        }}
        onClear={() => setCategory(null)}
        keyOf={(c) => c.id}
        renderItem={(c) => ({ title: c.name })}
        onCreateNew={createCat}
      />
      <Field label="Amount">
        <Input keyboardType="decimal-pad" placeholder="₹" value={amount} onChangeText={setAmount} />
      </Field>
      <DateField label="Date" value={date} onChange={setDate} max={todayISO()} />
      <PaymentBreakdownFields total={Number(amount) || 0} rows={payRows} onChange={setPayRows} bankLabel="From Bank" />
      <BranchField branch={branch} onChange={setBranch} />
      <UploadField label="Bill" value={receiptImage} onChange={setReceiptImage} allowPdf={false} />
      <Field label="Remarks">
        <Input placeholder="Optional notes" value={remarks} onChangeText={setRemarks} />
      </Field>
      <LoanWarning text={debitWarning} />
      {error ? <Txt style={{ fontSize: 12, color: C.red, marginBottom: 10 }}>{error}</Txt> : null}
      <SheetFooter>
        <PrimaryButton
          label={edit ? "Save Changes" : "Record Expense"}
          onPress={() => m.mutate()}
          loading={m.isPending}
          disabled={!category || !(Number(amount) > 0) || !date || !branchId || !payValid || debitExceeded}
        />
      </SheetFooter>
    </>
  );
}

type SelfTransferFormProps = { onClose: () => void; edit?: EntryInfo };

// Self Transfer — moves money between two of the business's own banks: a debit
// on From Bank and a credit on To Bank. A loan category locks To Bank to the
// loan's bank and books the transfer as a repayment on that loan. One Mode, no
// payment breakdown.
function SelfTransferForm({ onClose, edit }: SelfTransferFormProps) {
  const qc = useQueryClient();
  const [category, setCategory] = useState<Category | null>(edit ? ({ id: 0, name: edit.category, createdAt: "" } as Category) : null);
  // Editing starts from the entry's category name; a loan's own row (its bank)
  // is looked up so To Bank can lock to it.
  useEffect(() => {
    if (!edit || !isLoanSource(edit.category)) return;
    listCategoriesPage("self_transfer", edit.category, 0)
      .then((r) => {
        const found = (r.items ?? []).find((c) => c.name === edit.category);
        if (found) setCategory(found);
      })
      .catch(() => {});
  }, [edit]);
  const [amount, setAmount] = useState(edit ? String(edit.amount) : "");
  const [mode, setMode] = useState<(typeof SELF_MODES)[number]>((edit?.lines[0]?.mode as (typeof SELF_MODES)[number]) || "Bank Transfer");
  const [date, setDate] = useState(edit ? edit.occurredOn.slice(0, 10) : todayISO());
  const [fromBank, setFromBank] = useState<Bank | null>(edit?.fromBankId ? ({ id: edit.fromBankId, name: edit.fromBank ?? "", createdAt: "", updatedAt: "" } as Bank) : null);
  const [toBank, setToBank] = useState<Bank | null>(edit?.toBankId ? ({ id: edit.toBankId, name: edit.toBank ?? "", createdAt: "", updatedAt: "" } as Bank) : null);
  const [branch, setBranch] = useOwnBranch(branchOf(edit));
  const [receiptImage, setReceiptImage] = useState("");
  const [remarks, setRemarks] = useState(edit?.remarks ?? "");
  const [error, setError] = useState<string | null>(null);
  const branchId = branch?.id;

  const loan = category && isLoanSource(category.name) ? category : null;
  // A transfer to a loan is a repayment — it can't exceed what has been drawn and
  // not yet repaid. When editing, the entry's own amount is already counted as repaid.
  const loanBal = useLoanBalance(loan);
  const owed = loanBal ? Math.max(loanBal.drawn - loanBal.repaid, 0) + (edit ? edit.amount : 0) : 0;
  const loanExceeded = !!loanBal && (Number(amount) || 0) > owed + 0.005;
  const loanWarning = loanExceeded ? `Repayment exceeds what has been paid on ${category?.name} — only ${inr(owed)} is outstanding.` : "";
  const loanReady = !!loan && loan.principalAmount != null;

  const m = useMutation({
    mutationFn: async () => {
      if (edit) {
        await updateMovementEntry(edit.movementId, {
          category: category!.name, amount: Number(amount), fromBankId: fromBank!.id, fromBank: fromBank!.name,
          toBankId: loan ? undefined : toBank!.id, toBank: loan ? undefined : toBank!.name,
          mode, receiptImage: receiptImage || undefined, branchId, occurredOn: date, remarks: remarks.trim(),
        });
        return;
      }
      await createSelfTransfer({
        category: category!.name, amount: Number(amount), fromBankId: fromBank!.id, fromBank: fromBank!.name,
        toBankId: loan ? undefined : toBank!.id, toBank: loan ? undefined : toBank!.name,
        mode, receiptImage: receiptImage || undefined, branchId, occurredOn: date, remarks: remarks.trim() || undefined,
      });
    },
    onSuccess: () => {
      refreshCashQueries(qc);
      onClose();
    },
    onError: (err) => setError(errMsg(err, "Could not save.")),
  });

  function submit() {
    if (loan && !loanReady) {
      setError("This loan has no details recorded yet — add cash from it first.");
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
      {loan ? null : <BankPicker label="To Bank" bank={toBank} onChange={setToBank} />}
      <Field label="Amount">
        <Input keyboardType="decimal-pad" placeholder="₹" value={amount} onChangeText={setAmount} />
      </Field>
      <BranchField branch={branch} onChange={setBranch} />
      <UploadField label="Bill" value={receiptImage} onChange={setReceiptImage} allowPdf={false} />
      <Field label="Remarks">
        <Input placeholder="Optional notes" value={remarks} onChangeText={setRemarks} />
      </Field>
      <LoanWarning text={loanWarning} />
      {error ? <Txt style={{ fontSize: 12, color: C.red, marginBottom: 10 }}>{error}</Txt> : null}
      <SheetFooter>
        <PrimaryButton
          label={edit ? "Save Changes" : "Record Transfer"}
          onPress={submit}
          loading={m.isPending}
          disabled={!category || !(Number(amount) > 0) || !date || !fromBank || (!loan && !toBank) || !branchId || loanExceeded}
        />
      </SheetFooter>
    </>
  );
}
