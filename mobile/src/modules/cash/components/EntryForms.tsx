import React, { useEffect, useState } from "react";
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
  toast,
} from "@/common/components/ui";
import { FieldErr } from "@/common/components/ErrorText";
import { UploadField } from "@/common/components/UploadField";
import { EXPENSE_CATEGORY_IDS_KEY } from "@/common/components/BillLink";
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

const ENTRY_TYPES = ["debit", "credit", "self"] as const;
type EntryType = (typeof ENTRY_TYPES)[number];
const ENTRY_LABELS = { debit: "Debit (Expense)", credit: "Credit (Cash In)", self: "Self Transfer" } as const;

type AddEntrySheetProps = { visible: boolean; onClose: () => void };

// The Ledger's single "Add Entry" sheet — a Credit / Debit / Self Transfer
// switch on top, each tab one form (mirrors web's AddEntryModal).
export function AddEntrySheet({ visible, onClose }: AddEntrySheetProps) {
  const [type, setType] = useState<EntryType>("debit");
  // Bumped per open so each tab starts from a clean form.
  const [session, setSession] = useState(0);
  useEffect(() => {
    if (visible) {
      setType("debit");
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
  const [receiptImage, setReceiptImage] = useState(edit?.receiptImage ?? "");
  const [remarks, setRemarks] = useState(edit?.remarks ?? "");
  const bankRequired = mode === "UPI" || mode === "Bank Transfer";

  const isLoan = !!source && isLoanSource(source.name);
  const isGoldSale = source?.name === GOLD_SALE;
  // A loan is entered like any other cash-in — no loan number or principal is asked for.
  const [ornamentType, setOrnamentType] = useState(edit?.ornamentType ?? "");
  const [cost, setCost] = useState(edit?.costAmount ? String(edit.costAmount) : "");
  // How the cost to acquire was paid — recorded in the ledger only; it never leaves a balance (web "Cost Paid By").
  const [costMode, setCostMode] = useState<(typeof GOLD_SALE_MODES)[number]>((edit?.costMode as (typeof GOLD_SALE_MODES)[number]) || "Cash");
  const [costBank, setCostBank] = useState<Bank | null>(edit?.costBankId ? ({ id: edit.costBankId, name: edit.costBank ?? "", createdAt: "", updatedAt: "" } as Bank) : null);
  const costBankRequired = costMode === "UPI" || costMode === "Bank Transfer";
  // Per-field messages, each shown under the field it is about (set on Save, cleared as the field is fixed).
  const [fe, setFe] = useState<Record<string, string>>({});
  const feTxt = (k: string) => (fe[k] ? <Txt style={{ fontSize: 12, color: C.red, marginTop: 4 }}>{fe[k]}</Txt> : null);
  const profit = (Number(amount) || 0) - (Number(cost) || 0);
  const branchId = branch?.id;

  const m = useMutation({
    mutationFn: async () => {
      if (isGoldSale) {
        if (edit) {
          await updateMovementEntry(edit.movementId, {
            category: GOLD_SALE, ornamentType: ornamentType.trim(), costAmount: Number(cost || 0), amount: Number(amount), occurredOn: date,
            remarks: remarks.trim(), branchId, mode, bankId: bankRequired ? bank?.id : undefined, receiptImage: receiptImage || undefined,
            ...(Number(cost) > 0 ? { costMode, costBankId: costBankRequired ? costBank?.id : undefined } : {}),
          });
          return;
        }
        await createGoldSale({
          ornamentType: ornamentType.trim(), soldAmount: Number(amount), costAmount: Number(cost || 0), branchId: branchId!,
          mode, bankId: bankRequired ? bank?.id : undefined,
          ...(Number(cost) > 0 ? { costMode, costBankId: costBankRequired ? costBank?.id : undefined } : {}),
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
      });
    },
    onSuccess: () => {
      refreshCashQueries(qc);
      if (isGoldSale) qc.invalidateQueries({ queryKey: ["gold-sales"] });
      // A loan's first entry also made it a repayment category server side.
      if (isLoan) qc.invalidateQueries({ queryKey: EXPENSE_CATEGORY_IDS_KEY });
      onClose();
    },
    onError: (err) => toast.error(errMsg(err, "Could not save.")),
  });

  const bankValid = !bankRequired || !!bank;
  const payValid = paymentRowsError(payRows, Number(amount) || 0) === "";
  // A loan that already has a principal on record can't be drawn past what is left to draw.
  const loanBal = useLoanBalance(source);
  const drawAmount = Number(amount) || 0;
  // Editing a draw: its own amount is already counted as drawn, so it is available again to the edit.
  const loanLimit = loanBal ? loanBal.balance + (edit ? edit.amount : 0) : 0;
  const loanExceeded = isLoan && !isGoldSale && drawAmount > 0 && !!loanBal && loanBal.principal > 0 && drawAmount > loanLimit + 0.005;
  const loanWarning = loanExceeded ? `Loan principal amount exceeded — only ${inr(Math.max(loanLimit, 0))} is left to draw on ${source?.name}.` : "";
  // An edited gold sale stays a gold sale, and any other cash-in can't become one.
  const editBlocked = !!edit && (edit.kind === "gold_sale" ? !isGoldSale : isGoldSale);
  const canSubmit = !loanExceeded && !editBlocked;
  // Every problem is shown at once, each under its own field, instead of a silently disabled button.
  function submit() {
    const errors: Record<string, string> = {};
    if (!source) errors.source = "Please select a category.";
    if (isGoldSale && !ornamentType.trim()) errors.ornament = "Please enter the ornament type.";
    if (!(Number(amount) > 0)) errors.amount = isGoldSale ? "Please enter the sold amount." : "Please enter an amount greater than zero.";
    if (!date) errors.date = "Please select the date.";
    if (!branchId) errors.branch = "Please select a branch.";
    if (isGoldSale && !bankValid) errors.bank = "Please select the bank the sale was received in.";
    if (isGoldSale && Number(cost) > 0 && costBankRequired && !costBank) errors.costBank = "Please select the bank the cost was paid from.";
    if (!isGoldSale && Number(amount) > 0 && !payValid) errors.payments = paymentRowsError(payRows, Number(amount) || 0);
    setFe(errors);
    if (Object.keys(errors).length) return;
    m.mutate();
  }

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
      {feTxt("source")}

      {isGoldSale ? (
        <FieldRow>
          <Field label="Ornament type">
            <Input placeholder="e.g. Gold Chain" value={ornamentType} onChangeText={setOrnamentType} />
            {feTxt("ornament")}
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
          {feTxt("bank")}
          <Field label="Sold amount">
            <Input keyboardType="decimal-pad" placeholder="₹" value={amount} onChangeText={setAmount} />
            {feTxt("amount")}
          </Field>
          {Number(cost) > 0 ? (
            <>
              <Field label="Cost paid by *">
                <ChipToggle
                  options={GOLD_SALE_MODES}
                  value={costMode}
                  onChange={(v) => { setCostMode(v); if (v !== "UPI" && v !== "Bank Transfer") setCostBank(null); }}
                  wrap
                />
              </Field>
              {costBankRequired ? <BankPicker label="Cost bank (your account)" bank={costBank} onChange={setCostBank} /> : null}
              {feTxt("costBank")}
            </>
          ) : null}
          <BranchField branch={branch} onChange={setBranch} />
          {feTxt("branch")}
        </>
      ) : (
        <>
          <Field label="Amount">
            <Input keyboardType="decimal-pad" placeholder="₹" value={amount} onChangeText={setAmount} />
            {feTxt("amount")}
          </Field>
          <DateField label="Date" value={date} onChange={setDate} max={todayISO()} />
          <PaymentBreakdownFields total={Number(amount) || 0} rows={payRows} onChange={setPayRows} bankLabel="Bank (your account)" />
          {feTxt("payments")}
          <BranchField branch={branch} onChange={setBranch} />
          {feTxt("branch")}
        </>
      )}
      <UploadField label="Bill" value={receiptImage} onChange={setReceiptImage} allowPdf={false} />
      {isGoldSale ? <ResultBox k="Profit / Loss" v={`${profit >= 0 ? "+" : "−"}${inr(Math.abs(profit))}`} tone={profit >= 0 ? "green" : "red"} /> : null}
      <Field label="Remarks">
        <Input maxLength={150} placeholder="Optional notes (max 150 characters)" value={remarks} onChangeText={setRemarks} />
      </Field>

      <LoanWarning text={loanWarning} />
      {editBlocked ? <Txt style={{ fontSize: 12, color: C.red, marginBottom: 10 }}>A gold sale can&apos;t be turned into another category, or the other way round.</Txt> : null}
      <SheetFooter>
        <PrimaryButton label={edit ? "Save Changes" : isGoldSale ? "Record Gold Sale" : "Add Cash"} onPress={submit} loading={m.isPending} disabled={!canSubmit} />
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
  const [receiptImage, setReceiptImage] = useState(edit?.receiptImage ?? "");
  const [remarks, setRemarks] = useState(edit?.remarks ?? "");
  const [tried, setTried] = useState(false);
  const branchId = branch?.id;
  // Editing the same loan repayment: its own amount is already counted as repaid, so it is added back.
  const owed = loanBal ? Math.max(loanBal.drawn - loanBal.repaid, 0) + (edit && category?.name === edit.category ? edit.amount : 0) : 0;
  const debitExceeded = !!loanBal && (Number(amount) || 0) > owed + 0.005;
  const debitWarning = debitExceeded ? `Repayment exceeds what has been paid on ${category?.name} — only ${inr(owed)} is outstanding.` : "";
  const payValid = paymentRowsError(payRows, Number(amount) || 0) === "";
  const errs: Record<string, string> = {};
  if (!category) errs.category = "Select a category.";
  if (!(Number(amount) > 0)) errs.amount = "Enter an amount greater than zero.";
  if (!date) errs.date = "Select the date.";
  if (Number(amount) > 0 && !payValid) errs.pay = paymentRowsError(payRows, Number(amount) || 0);
  if (!branchId) errs.branch = "Select a branch.";
  if (debitExceeded) errs.amount = debitWarning;
  const fe = (k: string) => (tried ? errs[k] : undefined);

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
    onError: (err) => toast.error(errMsg(err, "Could not save.")),
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
        fetcher={async (q) => (await listExpenseCategoriesPage(q, 0, PICKER_PAGE_SIZE, true)).items ?? []}
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
      <FieldErr m={fe("category")} />
      <Field label="Amount">
        <Input keyboardType="decimal-pad" placeholder="₹" value={amount} onChangeText={setAmount} />
      </Field>
      <FieldErr m={fe("amount")} />
      <DateField label="Date" value={date} onChange={setDate} max={todayISO()} />
      <FieldErr m={fe("date")} />
      <PaymentBreakdownFields total={Number(amount) || 0} rows={payRows} onChange={setPayRows} bankLabel="From Bank" />
      <FieldErr m={fe("pay")} />
      <BranchField branch={branch} onChange={setBranch} />
      <FieldErr m={fe("branch")} />
      <UploadField label="Bill" value={receiptImage} onChange={setReceiptImage} allowPdf={false} />
      <Field label="Remarks">
        <Input maxLength={150} placeholder="Optional notes (max 150 characters)" value={remarks} onChangeText={setRemarks} />
      </Field>
      <LoanWarning text={debitWarning} />
      <SheetFooter>
        <PrimaryButton
          label={edit ? "Save Changes" : "Record Expense"}
          onPress={() => (Object.keys(errs).length ? setTried(true) : m.mutate())}
          loading={m.isPending}
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
  const [receiptImage, setReceiptImage] = useState(edit?.receiptImage ?? "");
  const [remarks, setRemarks] = useState(edit?.remarks ?? "");
  const [tried, setTried] = useState(false);
  const branchId = branch?.id;

  const loan = category && isLoanSource(category.name) ? category : null;
  // A transfer to a loan is a repayment — it can't exceed what has been drawn and
  // not yet repaid. When editing, the entry's own amount is already counted as repaid.
  const loanBal = useLoanBalance(loan);
  const owed = loanBal ? Math.max(loanBal.drawn - loanBal.repaid, 0) + (edit ? edit.amount : 0) : 0;
  const loanExceeded = !!loanBal && (Number(amount) || 0) > owed + 0.005;
  const loanWarning = loanExceeded ? `Repayment exceeds what has been paid on ${category?.name} — only ${inr(owed)} is outstanding.` : "";
  // A new transfer needs a real loan category row (with its details); an edit keeps working while its row is looked up.
  const loanReady = !!loan && (loan.id > 0 || !!edit);

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
    onError: (err) => toast.error(errMsg(err, "Could not save.")),
  });

  const errs: Record<string, string> = {};
  if (!category) errs.category = "Select a category.";
  if (!date) errs.date = "Select the date.";
  if (!fromBank) errs.fromBank = "Select the From Bank.";
  if (!loan && !toBank) errs.toBank = "Select the To Bank.";
  else if (!loan && toBank && fromBank && toBank.id === fromBank.id) errs.toBank = "From Bank and To Bank must be different.";
  if (!(Number(amount) > 0)) errs.amount = "Enter an amount greater than zero.";
  else if (loanExceeded) errs.amount = loanWarning;
  if (!branchId) errs.branch = "Select a branch.";
  const fe = (k: string) => (tried ? errs[k] : undefined);

  function submit() {
    if (Object.keys(errs).length) return setTried(true);
    if (loan && !loanReady) return toast.error("This loan has no details recorded yet — add cash from it first.");
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
      <FieldErr m={fe("category")} />
      <DateField label="Date" value={date} onChange={setDate} max={todayISO()} />
      <FieldErr m={fe("date")} />
      <Field label="Mode">
        <ChipToggle options={SELF_MODES} value={mode} onChange={setMode} />
      </Field>
      <BankPicker label="From Bank" bank={fromBank} onChange={setFromBank} />
      <FieldErr m={fe("fromBank")} />
      {loan ? null : <BankPicker label="To Bank" bank={toBank} onChange={setToBank} />}
      <FieldErr m={fe("toBank")} />
      <Field label="Amount">
        <Input keyboardType="decimal-pad" placeholder="₹" value={amount} onChangeText={setAmount} />
      </Field>
      <FieldErr m={fe("amount")} />
      <BranchField branch={branch} onChange={setBranch} />
      <FieldErr m={fe("branch")} />
      <UploadField label="Bill" value={receiptImage} onChange={setReceiptImage} allowPdf={false} />
      <Field label="Remarks">
        <Input maxLength={150} placeholder="Optional notes (max 150 characters)" value={remarks} onChangeText={setRemarks} />
      </Field>
      <LoanWarning text={loanWarning} />
      <SheetFooter>
        <PrimaryButton
          label={edit ? "Save Changes" : "Record Transfer"}
          onPress={submit}
          loading={m.isPending}
        />
      </SheetFooter>
    </>
  );
}
