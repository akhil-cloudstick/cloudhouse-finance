"use client";

import { useCallback, useEffect, useState, type Dispatch, type ReactNode, type SetStateAction } from "react";
import { useModal } from "@/common/components/ModalProvider";
import { useToast } from "@/common/components/ToastProvider";
import { Icon } from "@/common/components/Icon";
import { fmt } from "@/common/utils/format";
import { ApiError } from "@/common/services/httpClient";
import { listActiveBranches } from "@/modules/branches/services/branchService";
import { type BranchView } from "@/modules/branches/types/branch-types";
import { useBranding } from "@/common/providers/BrandingProvider";
import { useLockedBranchId, useShowBranch } from "@/common/hooks/use-branch-switch";
import { createExpense, saveEntryEdit, uploadReceipt } from "@/modules/cash/services/cashService";
import { searchExpenseCategoriesPage, createExpenseCategory } from "@/modules/cash/services/expenseCategoryService";
import { type BackendExpenseCategory } from "@/modules/cash/types/expense-category-types";
import { type EntryInfo } from "@/modules/cash/types/cash-types";
import { PaymentBreakdownFields, newPaymentRow, paymentRowIssue, paymentRowsToInput, isBankMode, type PaymentIssue, type PaymentRow } from "@/modules/cash/components/PaymentBreakdownFields";
import { Select } from "@/common/components/ui/Select";
import { SearchableSelect } from "@/common/components/ui/SearchableSelect";
import { DatePicker } from "@/common/components/ui/DatePicker";
import { FileInput } from "@/common/components/ui/FileInput";
import { useLoanBalance } from "@/modules/cash/hooks/use-loan-balance";
import { singleFlight } from "@/common/utils/singleFlight";
import { FieldError, fieldForMessage } from "@/common/components/ui/FieldError";

// Which field a server message is about, by its words (first match wins).
const SERVER_FIELDS: Record<string, RegExp> = {
  payments: /bank|payment/i, remarks: /remarks/i, branch: /branch/i, date: /date/i, category: /categor|loan/i, amount: /amount/i,
};

type ExpenseModalContentProps = { onSaved?: () => void; tabs?: ReactNode; edit?: EntryInfo };

export function ExpenseModalContent({ onSaved, tabs, edit }: ExpenseModalContentProps) {
  const { closeModal } = useModal();
  const toast = useToast();
  const today = new Date().toISOString().slice(0, 10);
  const [receiptFile, setReceiptFile] = useState<File | null>(null);

  const [amt, setAmt] = useState(edit ? String(edit.amount) : "");
  const [date, setDate] = useState(edit ? edit.occurredOn.slice(0, 10) : today);
  const [cat, setCat] = useState(edit?.category ?? "");
  const [catRec, setCatRec] = useState<BackendExpenseCategory | null>(null);
  // A loan repayment can't exceed what has been drawn and not yet repaid; blocks the button.
  const loanBal = useLoanBalance(catRec);
  const owed = loanBal ? Math.max(loanBal.drawn - loanBal.repaid, 0) : 0;
  const loanExceeded = !!loanBal && (+amt || 0) > owed + 0.005;
  const loanWarning = loanExceeded
    ? `Repayment exceeds what has been paid on ${cat} — only ${fmt(owed)} is outstanding.`
    : "";
  const [payRows, setPayRows] = useState<PaymentRow[]>(() =>
    edit
      ? edit.lines.map((l) => newPaymentRow({ mode: l.mode, amount: String(l.amount), bankId: l.bankId ? String(l.bankId) : "", bankName: l.bankName || "", auto: false }))
      : [newPaymentRow({ mode: "Cash" })]
  );
  const [remarks, setRemarks] = useState(edit?.remarks ?? "");
  const [branches, setBranches] = useState<BranchView[]>([]);
  const { singleBranch } = useBranding();
  const showBranch = useShowBranch();
  const lockedBranchId = useLockedBranchId();
  const branchLocked = singleBranch || lockedBranchId != null;
  const [branchId, setBranchId] = useState<number | "">(edit?.branchId || lockedBranchId || "");
  const [err, setErr] = useState("");
  const [fe, setFe] = useState<Record<string, string>>({});
  const [payIssue, setPayIssue] = useState<PaymentIssue | null>(null);
  const changePayRows: Dispatch<SetStateAction<PaymentRow[]>> = useCallback((a) => { setPayIssue(null); setPayRows(a); }, []);
  const clearFe = (field: string) => setFe((cur) => (cur[field] ? { ...cur, [field]: "" } : cur));
  const fail = (field: string, msg: string) => { setErr(""); setFe({ [field]: msg }); };
  const failFromServer = (e: unknown) => {
    const msg = e instanceof ApiError ? e.message : "Could not save — try again.";
    const field = fieldForMessage(msg, SERVER_FIELDS);
    if (field === "payments") { setErr(""); setFe({}); setPayIssue({ key: payRows.find((r) => isBankMode(r.mode) && !r.bankId)?.key ?? null, message: msg }); return; }
    if (field) fail(field, msg); else { setFe({}); setErr(msg); }
  };
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    listActiveBranches().then((list) => {
      setBranches(list);
      if (list.length) setBranchId((cur) => cur || list[0].id);
    }).catch(() => setErr("Could not load branches — try again later."));
  }, []);

  async function save() { return singleFlight("modal:expense:save", async () => {
    setErr(""); setFe({}); setPayIssue(null);
    if (!cat.trim()) { fail("category", "Please select a category."); return; }
    const amount = +amt;
    if (!(amount > 0)) { fail("amount", "Please enter a valid amount."); return; }
    if (!date) { fail("date", "Please select the date."); return; }
    const issue = paymentRowIssue(payRows, amount);
    if (issue) { setErr(""); setFe({}); setPayIssue(issue); return; }
    if (!branchId) { fail("branch", "Please select a branch."); return; }

    setSaving(true);
    try {
      let receiptImage: string | undefined;
      if (receiptFile) receiptImage = await uploadReceipt(receiptFile);
      const payments = paymentRowsToInput(payRows);

      if (edit) {
        await saveEntryEdit(edit, {
          category: cat, amount, occurredOn: date, remarks: remarks.trim(), branchId, payments, receiptImage,
        });
        onSaved?.();
        closeModal();
        toast("Expense updated");
        return;
      }
      const created = await createExpense({
        category: cat, amount, mode: payments[0].mode, branchId,
        occurredOn: date, receiptImage, remarks: remarks.trim() || undefined, payments,
      });
      onSaved?.();
      closeModal();
      toast(created.status === "Pending" ? `Expense of ${fmt(amount)} submitted for approval` : `Expense of ${fmt(amount)} recorded`);
    } catch (e) {
      failFromServer(e);
    } finally {
      setSaving(false);
    }
  }); }

  return (
    <>
      <div className="hd"><h3>{edit ? "Edit Expense" : "Record Expense"}</h3><button className="x" onClick={closeModal}>×</button></div>
      <div className="bd bd-scroll entry-form">
        {tabs}
        <div className="frow"><div className={fe.category ? "has-err" : undefined}><label className="f">Category *</label>
          <SearchableSelect<BackendExpenseCategory>
            portal
            value={cat}
            onChange={(_id, item) => {
              setCat(item.name);
              setCatRec(item);
              clearFe("category");
              // A category from another form: choosing it flips it to common.
              if (item.type && item.type !== "expense" && !item.isCommon) createExpenseCategory(item.name).catch(() => {});
            }}
            fetchFn={searchExpenseCategoriesPage}
            searchHint="Searches: category name"
            getLabel={(c) => c.name}
            getId={(c) => String(c.id)}
            placeholder="Search or add a category…"
            allowCreate
            onCreate={createExpenseCategory}
          /><FieldError msg={fe.category} /></div></div>
        <div className="frow c2">
          <div className={fe.amount ? "has-err" : undefined}><label className="f">Amount (₹) *</label><input className="inp" type="number" min={1} value={amt} onChange={(e) => { setAmt(e.target.value); clearFe("amount"); }} onWheel={(e) => e.currentTarget.blur()} /><FieldError msg={fe.amount} /></div>
          <div className={fe.date ? "has-err" : undefined}><label className="f">Date *</label><DatePicker value={date} onChange={(v) => { setDate(v); clearFe("date"); }} /><FieldError msg={fe.date} /></div>
        </div>
        <PaymentBreakdownFields total={+amt || 0} rows={payRows} onChange={changePayRows} error={payIssue} />
        {showBranch && (
          <div className="frow">
            <div className={fe.branch ? "has-err" : undefined}><label className="f">Branch *</label>
              <Select
                disabled={branchLocked}
                options={branches.map((b) => ({ value: String(b.id), label: b.name }))}
                value={branchId ? String(branchId) : ""}
                onChange={(v) => { setBranchId(v ? Number(v) : ""); clearFe("branch"); }}
                placeholder="Select branch…"
              /><FieldError msg={fe.branch} /></div>
          </div>
        )}
        <div className="frow"><div><label className="f">Bill{edit?.receiptImage ? <span style={{ fontWeight: 400, color: "var(--muted)" }}> (a bill is attached — choose a file to replace it)</span> : null}</label>
          <FileInput value={receiptFile} onChange={setReceiptFile} accept="image/*" /></div></div>
        <div className="frow"><div className={fe.remarks ? "has-err" : undefined}><label className="f">Remarks</label>
          <textarea className="inp" rows={2} placeholder="Optional notes" value={remarks} onChange={(e) => { setRemarks(e.target.value); clearFe("remarks"); }} /><FieldError msg={fe.remarks} /></div></div>
      </div>
      {(loanWarning || err) && (
        <div style={{ padding: "8px 22px 0", color: "var(--red)", fontSize: 12.5 }}>{loanWarning || err}</div>
      )}
      <div className="ft">
        <button className="btn ghost" onClick={closeModal}>Cancel</button>
        <button className="btn" onClick={save} disabled={saving || loanExceeded}><Icon name="check" /> {saving ? "Saving…" : edit ? "Save Changes" : "Record Expense"}</button>
      </div>
    </>
  );
}
