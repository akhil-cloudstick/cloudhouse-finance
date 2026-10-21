"use client";

import { useCallback, useEffect, useState, type Dispatch, type ReactNode, type SetStateAction } from "react";
import { useModal } from "@/common/components/ModalProvider";
import { useToast } from "@/common/components/ToastProvider";
import { Icon } from "@/common/components/Icon";
import { fmt } from "@/common/utils/format";
import { ApiError } from "@/common/services/httpClient";
import { createCashMovement, createGoldSale, updateMovementEntry, uploadReceipt } from "@/modules/cash/services/cashService";
import { PaymentBreakdownFields, newPaymentRow, paymentRowIssue, paymentRowsToInput, isBankMode, type PaymentIssue, type PaymentRow } from "@/modules/cash/components/PaymentBreakdownFields";
import { type EntryInfo } from "@/modules/cash/types/cash-types";
import { listActiveBranches } from "@/modules/branches/services/branchService";
import { type BranchView } from "@/modules/branches/types/branch-types";
import { useBranding } from "@/common/providers/BrandingProvider";
import { useLockedBranchId, useShowBranch } from "@/common/hooks/use-branch-switch";
import { searchBanksPage, createBank } from "@/modules/banks/services/bankService";
import { type BackendBank } from "@/modules/banks/types/bank-types";
import { searchCashSourcesPage, createCashSource, isLoanSource } from "@/modules/cash/services/cashSourceService";
import { type BackendCashSource } from "@/modules/cash/types/cash-source-types";
import { EXPENSE_CATEGORIES_CHANGED } from "@/modules/cash/services/expenseCategoryService";
import { SearchableSelect } from "@/common/components/ui/SearchableSelect";
import { Select } from "@/common/components/ui/Select";
import { DatePicker } from "@/common/components/ui/DatePicker";
import { FileInput } from "@/common/components/ui/FileInput";
import { useLoanBalance } from "@/modules/cash/hooks/use-loan-balance";
import { FieldError, fieldForMessage } from "@/common/components/ui/FieldError";
import { singleFlight } from "@/common/utils/singleFlight";

// Blur on wheel so scrolling the modal doesn't step the number input.
const noWheelStep = (e: React.WheelEvent<HTMLInputElement>) => e.currentTarget.blur();

const MODE_OPTIONS = [
  { value: "Cash", label: "Cash" },
  { value: "UPI", label: "UPI" },
  { value: "Bank Transfer", label: "Bank Transfer" },
];

// Built-in source name, not a real cash.CashSource row; picking it switches this modal to the gold-sale form.
const GOLD_SALE = "Gold Sale";

// Which field a server message is about, by its words (first match wins).
const SERVER_FIELDS: Record<string, RegExp> = {
  payments: /bank|payment/i, remarks: /remarks/i, branch: /branch/i, date: /date/i, category: /categor|source|loan/i, amount: /amount/i,
};

const searchSourcesWithGoldSale = searchCashSourcesPage;

type AddCashModalContentProps = { onSaved?: () => void; defaultBranchId?: number; tabs?: ReactNode; edit?: EntryInfo };

// A source starting with "Loan" is a loan: entered like any cash-in (no loan number/principal asked),
// and repayments in that category show as credits in the loan's ledger.
export function AddCashModalContent({ onSaved, defaultBranchId, tabs, edit }: AddCashModalContentProps) {
  const { closeModal } = useModal();
  const toast = useToast();
  const today = new Date().toISOString().slice(0, 10);

  const [sourceRec, setSourceRec] = useState<BackendCashSource | null>(edit ? ({ id: 0, name: edit.category } as BackendCashSource) : null);
  const source = sourceRec?.name ?? "";
  const [mode, setMode] = useState(edit?.kind === "gold_sale" ? edit.lines[0]?.mode ?? "" : "");
  const [bank, setBank] = useState(edit?.kind === "gold_sale" ? edit.lines[0]?.bankName ?? "" : "");
  const [bankId, setBankId] = useState(edit?.kind === "gold_sale" && edit.lines[0]?.bankId ? String(edit.lines[0].bankId) : "");
  const [payRows, setPayRows] = useState<PaymentRow[]>(() =>
    edit
      ? edit.lines.map((l) => newPaymentRow({ mode: l.mode, amount: String(l.amount), bankId: l.bankId ? String(l.bankId) : "", bankName: l.bankName || "", auto: false }))
      : [newPaymentRow({ mode: "Cash" })]
  );
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [amt, setAmt] = useState(edit ? String(edit.amount) : "");
  const [date, setDate] = useState(edit ? edit.occurredOn.slice(0, 10) : today);
  const [err, setErr] = useState("");
  const [fe, setFe] = useState<Record<string, string>>({});
  const [payIssue, setPayIssue] = useState<PaymentIssue | null>(null);
  const changePayRows: Dispatch<SetStateAction<PaymentRow[]>> = useCallback((a) => { setPayIssue(null); setPayRows(a); }, []);
  const fail = (field: string, msg: string) => { setErr(""); setFe({ [field]: msg }); };
  const failFromServer = (e: unknown) => {
    const msg = e instanceof ApiError ? e.message : "Could not save — try again.";
    const field = fieldForMessage(msg, SERVER_FIELDS);
    if (field === "payments") { setErr(""); setFe({}); setPayIssue({ key: payRows.find((r) => isBankMode(r.mode) && !r.bankId)?.key ?? null, message: msg }); return; }
    if (field) fail(field, msg); else { setFe({}); setErr(msg); }
  };
  const [saving, setSaving] = useState(false);

  const isLoan = isLoanSource(source);
  const isGoldSale = source === GOLD_SALE;

  const [ornamentType, setOrnamentType] = useState(edit?.ornamentType ?? "");
  const [costAmount, setCostAmount] = useState(edit?.costAmount ? String(edit.costAmount) : "");
  const [remarks, setRemarks] = useState(edit?.remarks ?? "");
  const [branches, setBranches] = useState<BranchView[]>([]);
  const { singleBranch } = useBranding();
  const showBranch = useShowBranch();
  const lockedBranchId = useLockedBranchId();
  const branchLocked = singleBranch || lockedBranchId != null;
  const [branchId, setBranchId] = useState<number | "">(edit?.branchId || defaultBranchId || lockedBranchId || "");
  useEffect(() => {
    listActiveBranches().then((list) => {
      setBranches(list);
      if (list.length) setBranchId((cur) => cur || list[0].id);
    }).catch(() => setErr("Could not load branches — try again later."));
  }, []);
  const sold = +amt || 0;
  const profit = sold > 0 ? sold - (+costAmount || 0) : 0;

  const loanBal = useLoanBalance(sourceRec);
  const drawAmount = +amt || 0;
  // Editing a draw: its own amount is already counted as drawn, so it is available again to the edit.
  const loanLimit = loanBal ? loanBal.balance + (edit ? edit.amount : 0) : 0;
  const loanExceeded = isLoan && !isGoldSale && drawAmount > 0 && !!loanBal && loanBal.principal > 0 && drawAmount > loanLimit + 0.005;
  const loanWarning = loanExceeded
    ? `Loan principal amount exceeded — only ${fmt(Math.max(loanLimit, 0))} is left to draw on ${source}.`
    : "";


  const bankRequired = mode === "UPI" || mode === "Bank Transfer";

  async function saveGoldSale() { return singleFlight("modal:addcash:saveGoldSale", async () => {
    const type = ornamentType.trim();
    const cost = +costAmount || 0;
    if (!type) { fail("ornament", "Please enter the ornament type."); return; }
    if (!(sold > 0)) { fail("amount", "Please enter a valid sold amount."); return; }
    if (cost < 0) { fail("cost", "Cost amount cannot be negative."); return; }
    if (!date) { fail("date", "Please select the date."); return; }
    if (!branchId) { fail("branch", "Please select a branch."); return; }

    setSaving(true);
    try {
      const receiptImage = receiptFile ? await uploadReceipt(receiptFile) : undefined;
      if (edit) {
        await updateMovementEntry(edit.movementId, {
          category: GOLD_SALE, ornamentType: type, costAmount: cost, amount: sold, occurredOn: date, remarks: remarks.trim(), branchId,
          mode, bankId: bankRequired ? +bankId : undefined, receiptImage,
        });
        onSaved?.();
        closeModal();
        toast("Gold sale updated");
        return;
      }
      await createGoldSale({
        ornamentType: type, soldAmount: sold, costAmount: cost, branchId,
        mode, bankId: bankRequired ? +bankId : undefined,
        soldOn: date, remarks: remarks.trim() || undefined, receiptImage,
      });
      onSaved?.();
      closeModal();
      toast(`Gold sale of ${fmt(sold)} recorded${profit >= 0 ? ` — profit ${fmt(profit)}` : ` — loss ${fmt(Math.abs(profit))}`}`);
    } catch (e) {
      failFromServer(e);
    } finally {
      setSaving(false);
    }
  }); }

  async function save() { return singleFlight("modal:addcash:save", async () => {
    setErr(""); setFe({}); setPayIssue(null);
    if (!source) { fail("category", "Please select where the cash is coming from."); return; }
    if (isGoldSale) {
      if (edit && edit.kind !== "gold_sale") { fail("category", "A gold sale can't be recorded from here — pick another category."); return; }
      if (!mode) { fail("mode", "Please select the mode of cash."); return; }
      if (bankRequired && !bankId) { fail("bank", "Please select the bank."); return; }
      if (!branchId) { fail("branch", "Please select a branch."); return; }
      await saveGoldSale();
      return;
    }
    const amount = +amt;
    if (!(amount > 0)) { fail("amount", "Please enter a valid cash amount."); return; }
    if (!date) { fail("date", "Please select the date."); return; }
    const issue = paymentRowIssue(payRows, amount);
    if (issue) { setErr(""); setFe({}); setPayIssue(issue); return; }
    if (!branchId) { fail("branch", "Please select a branch."); return; }

    setSaving(true);
    try {
      const receiptImage = receiptFile ? await uploadReceipt(receiptFile) : undefined;
      const payments = paymentRowsToInput(payRows);
      if (edit) {
        await updateMovementEntry(edit.movementId, {
          category: source, amount, occurredOn: date, remarks: remarks.trim(), branchId, payments, receiptImage,
        });
        onSaved?.();
        closeModal();
        toast("Cash-in updated");
        return;
      }
      await createCashMovement({
        type: "in", source, receiptImage,
        amount, branchId, occurredOn: date,
        remarks: remarks.trim() || undefined, payments,
      });
      // A loan's first entry makes it a repayment category server-side; reload category links for the ledger link.
      if (isLoan) window.dispatchEvent(new Event(EXPENSE_CATEGORIES_CHANGED));
      onSaved?.();
      closeModal();
      toast(`${fmt(amount)} added to cash (${source} · ${payments.map((p) => p.mode).join(" + ")})`);
    } catch (e) {
      failFromServer(e);
    } finally {
      setSaving(false);
    }
  }); }

  const categoryField = (
    <div className={fe.category ? "has-err" : undefined}><label className="f">Category *</label>
      <SearchableSelect<BackendCashSource>
        portal
        disabled={edit?.kind === "gold_sale"}
        value={source}
        onChange={(_id, item) => {
          setSourceRec(item);
          setFe((cur) => ({ ...cur, category: "" }));
          // A category from another form: choosing it flips it to common.
          if (item.type && item.type !== "cash_in" && !item.isCommon && item.name !== GOLD_SALE) createCashSource(item.name).catch(() => {});
        }}
        fetchFn={searchSourcesWithGoldSale}
        searchHint="Searches: category name"
        getLabel={(s) => s.name}
        getId={(s) => String(s.id)}
        placeholder="Search or add a category…"
        allowCreate
        onCreate={createCashSource}
      /><FieldError msg={fe.category} /></div>
  );
  const modeField = (
    <div className={fe.mode ? "has-err" : undefined}><label className="f">Mode *</label>
      <Select
        options={MODE_OPTIONS}
        value={mode}
        onChange={(v) => { setMode(v); if (v !== "UPI" && v !== "Bank Transfer") { setBankId(""); setBank(""); } }}
        placeholder="Select mode…"
      /><FieldError msg={fe.mode} /></div>
  );
  const bankField = (
    <div className={fe.bank ? "has-err" : undefined}><label className="f">Bank * <span style={{ fontWeight: 400, color: "var(--muted)" }}>(your account)</span></label>
      <SearchableSelect<BackendBank>
        portal
        value={bank}
        onChange={(id, item) => { setBankId(id); setBank(item.name); }}
        fetchFn={searchBanksPage}
        searchHint="Searches: bank name"
        getLabel={(b) => b.name}
        getId={(b) => String(b.id)}
        placeholder="Search or add a bank…"
        allowCreate
        onCreate={createBank}
      /><FieldError msg={fe.bank} /></div>
  );
  const amountField = (
    <div className={fe.amount ? "has-err" : undefined}><label className="f">{isGoldSale ? "Sold For (₹) *" : "Amount (₹) *"}</label>
      <input className="inp" type="number" min={1} value={amt} onChange={(e) => setAmt(e.target.value)} onWheel={noWheelStep} /><FieldError msg={fe.amount} /></div>
  );
  const branchField = (
    <div className={fe.branch ? "has-err" : undefined}><label className="f">Branch *</label>
      <Select
        disabled={branchLocked}
        options={branches.map((b) => ({ value: String(b.id), label: b.name }))}
        value={branchId ? String(branchId) : ""}
        onChange={(v) => setBranchId(v ? Number(v) : "")}
        placeholder="Select branch…"
      /><FieldError msg={fe.branch} /></div>
  );

  return (
    <>
      <div className="hd"><h3>{edit ? (edit.kind === "gold_sale" ? "Edit Gold Sale" : "Edit Cash-In") : "Add Cash"}</h3><button className="x" onClick={closeModal}>×</button></div>
      <div className="bd bd-scroll entry-form">
        {tabs}
        <div className="frow">{categoryField}</div>

        {isGoldSale && (
          <div className="frow c2">
            <div className={fe.ornament ? "has-err" : undefined}><label className="f">Ornament Type *</label>
              <input className="inp" placeholder="e.g. Chain, Bangle, Studs" value={ornamentType} onChange={(e) => setOrnamentType(e.target.value)} /><FieldError msg={fe.ornament} /></div>
            <div className={fe.cost ? "has-err" : undefined}><label className="f">Cost to Acquire (₹) *</label><input className="inp" type="number" min={0} value={costAmount} onChange={(e) => setCostAmount(e.target.value)} onWheel={noWheelStep} /><FieldError msg={fe.cost} /></div>
          </div>
        )}

        {isGoldSale ? (
          <>
            <div className="frow c2">
              <div className={fe.date ? "has-err" : undefined}><label className="f">Date *</label><DatePicker value={date} onChange={setDate} /><FieldError msg={fe.date} /></div>
              {modeField}
            </div>
            {bankRequired && <div className="frow">{bankField}</div>}
            <div className={showBranch ? "frow c2" : "frow"}>{amountField}{showBranch && branchField}</div>
          </>
        ) : (
          <>
            <div className="frow c2">
              {amountField}
              <div className={fe.date ? "has-err" : undefined}><label className="f">Date *</label><DatePicker value={date} onChange={setDate} /><FieldError msg={fe.date} /></div>
            </div>
            <PaymentBreakdownFields total={+amt || 0} rows={payRows} onChange={changePayRows} error={payIssue} />
            {showBranch && <div className="frow">{branchField}</div>}
          </>
        )}
        {isGoldSale && amt && (
          <div className="notice" style={{ marginBottom: 4 }}>
            {profit >= 0 ? "Profit" : "Loss"}: <strong style={{ color: profit >= 0 ? "var(--green)" : "var(--red)" }}>{fmt(Math.abs(profit))}</strong>
          </div>
        )}
        {loanWarning && (
          <div className="notice" style={{ marginBottom: 4, borderLeft: "3px solid var(--red)", color: "var(--red)" }}>
            {loanWarning}
          </div>
        )}
        <div className="frow"><div><label className="f">Bill{edit?.receiptImage ? <span style={{ fontWeight: 400, color: "var(--muted)" }}> (a bill is attached — choose a file to replace it)</span> : null}</label>
          <FileInput value={receiptFile} onChange={setReceiptFile} accept="image/*" /></div></div>
        <div className="frow"><div className={fe.remarks ? "has-err" : undefined}><label className="f">Remarks</label>
          <textarea className="inp" rows={2} placeholder="Optional notes" value={remarks} onChange={(e) => setRemarks(e.target.value)} /><FieldError msg={fe.remarks} /></div></div>
        <p style={{ color: "var(--red)", fontSize: 12.5, minHeight: 16, marginTop: 8 }}>{err}</p>
      </div>
      <div className="ft">
        <button className="btn ghost" onClick={closeModal}>Cancel</button>
        <button className="btn" onClick={save} disabled={saving || loanExceeded}><Icon name="check" /> {saving ? "Saving…" : edit ? "Save Changes" : isGoldSale ? "Record Sale" : "Add Cash"}</button>
      </div>
    </>
  );
}
