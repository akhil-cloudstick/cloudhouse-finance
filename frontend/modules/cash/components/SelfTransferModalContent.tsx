"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useModal } from "@/common/components/ModalProvider";
import { useToast } from "@/common/components/ToastProvider";
import { Icon } from "@/common/components/Icon";
import { fmt } from "@/common/utils/format";
import { ApiError } from "@/common/services/httpClient";
import { createSelfTransfer, updateMovementEntry, uploadReceipt } from "@/modules/cash/services/cashService";
import { type EntryInfo } from "@/modules/cash/types/cash-types";
import { listActiveBranches } from "@/modules/branches/services/branchService";
import { type BranchView } from "@/modules/branches/types/branch-types";
import { useBranding } from "@/common/providers/BrandingProvider";
import { useLockedBranchId, useShowBranch } from "@/common/hooks/use-branch-switch";
import { searchBanksPage, createBank } from "@/modules/banks/services/bankService";
import { type BackendBank } from "@/modules/banks/types/bank-types";
import { isLoanSource } from "@/modules/cash/services/cashSourceService";
import { searchCategoriesPage, createCategory } from "@/modules/cash/services/categoryService";
import { type BackendCategory } from "@/modules/cash/types/category-types";
import { SearchableSelect } from "@/common/components/ui/SearchableSelect";
import { Select } from "@/common/components/ui/Select";
import { DatePicker } from "@/common/components/ui/DatePicker";
import { FileInput } from "@/common/components/ui/FileInput";
import { useLoanBalance } from "@/modules/cash/hooks/use-loan-balance";
import { singleFlight } from "@/common/utils/singleFlight";

// How the money moved — both ledger rows show it. Banks are always From/To here,
// so unlike Credit/Debit there is no separate Bank field for the mode.
const MODE_OPTIONS = [
  { value: "Bank Transfer", label: "Bank Transfer" },
  { value: "UPI", label: "UPI" },
  { value: "Cash", label: "Cash" },
];

const noWheelStep = (e: React.WheelEvent<HTMLInputElement>) => e.currentTarget.blur();

const searchTransferCategories = searchCategoriesPage("self_transfer");

// `edit` opens the form on an existing self transfer (from the ledger's Edit button).
type SelfTransferModalContentProps = { onSaved?: () => void; defaultBranchId?: number; tabs?: ReactNode; edit?: EntryInfo };

/* Self Transfer tab of the Ledger's Add Entry modal. Moves money between two
 * of the business's own banks: the backend records a debit on From Bank and a
 * credit on To Bank. A loan category locks To Bank to the loan's bank and
 * books the transfer as a repayment on that loan's ledger. */
export function SelfTransferModalContent({ onSaved, defaultBranchId, tabs, edit }: SelfTransferModalContentProps) {
  const { closeModal } = useModal();
  const toast = useToast();
  const today = new Date().toISOString().slice(0, 10);

  // Editing starts from the entry's category name; the full row (a loan's
  // bank) is looked up below.
  const [catRec, setCatRec] = useState<BackendCategory | null>(edit ? ({ id: 0, name: edit.category } as BackendCategory) : null);
  const category = catRec?.name ?? "";
  useEffect(() => {
    if (!edit || !isLoanSource(edit.category)) return;
    searchTransferCategories(edit.category, 0).then((r) => {
      const found = r.items.find((c) => c.name === edit.category);
      if (found) setCatRec(found);
    }).catch(() => {});
  }, [edit]);
  // A loan category (name starts with "Loan") makes this a repayment to the loan's bank.
  const loan = catRec && isLoanSource(catRec.name) ? catRec : null;
  const loanBank = loan?.bank?.name ?? "";
  const loanReady = !!loan && loan.principalAmount != null && !!loan.bankId;

  const [fromBank, setFromBank] = useState(edit?.fromBank ?? "");
  const [fromBankId, setFromBankId] = useState(edit?.fromBankId ? String(edit.fromBankId) : "");
  const [toBank, setToBank] = useState(edit?.toBank ?? "");
  const [toBankId, setToBankId] = useState(edit?.toBankId ? String(edit.toBankId) : "");
  const [mode, setMode] = useState(edit?.lines[0]?.mode || "Bank Transfer");
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [amt, setAmt] = useState(edit ? String(edit.amount) : "");
  const [remarks, setRemarks] = useState(edit?.remarks ?? "");

  // A transfer to a loan is a repayment — it can't exceed what has been drawn
  // and not yet repaid. Blocks the button (the backend refuses it too). When
  // editing, the entry's own amount is already counted as repaid.
  const loanBal = useLoanBalance(loan);
  const owed = loanBal ? Math.max(loanBal.drawn - loanBal.repaid, 0) + (edit ? edit.amount : 0) : 0;
  const loanExceeded = !!loanBal && (+amt || 0) > owed + 0.005;
  const loanWarning = loanExceeded
    ? `Repayment exceeds what has been paid on ${category} — only ${fmt(owed)} is outstanding.`
    : "";

  const [date, setDate] = useState(edit ? edit.occurredOn.slice(0, 10) : today);
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);

  const [branches, setBranches] = useState<BranchView[]>([]);
  const { singleBranch } = useBranding();
  // Single-branch plan: no branch is ever shown — the field is not rendered.
  const showBranch = useShowBranch();
  // Locked (and defaulted) to the global branch selection when one is
  // active, the same way a single-branch business locks it.
  const lockedBranchId = useLockedBranchId();
  const branchLocked = singleBranch || lockedBranchId != null;
  const [branchId, setBranchId] = useState<number | "">(edit?.branchId || defaultBranchId || lockedBranchId || "");
  useEffect(() => {
    listActiveBranches().then((list) => {
      setBranches(list);
      if (list.length) setBranchId((cur) => cur || list[0].id);
    }).catch(() => setErr("Could not load branches — try again later."));
  }, []);

  async function save() { return singleFlight("modal:selftransfer:save", async () => {
    const amount = +amt;
    if (!category) { setErr("Please select a category."); return; }
    if (!(amount > 0)) { setErr("Please enter a valid amount."); return; }
    if (!date) { setErr("Please select the date."); return; }
    if (!fromBankId) { setErr("Please select the From Bank."); return; }
    if (loan && !loanReady) { setErr("This loan has no bank recorded yet — add cash from it first."); return; }
    if (!loan && !toBankId) { setErr("Please select the To Bank."); return; }
    if (!loan && toBankId === fromBankId) { setErr("From Bank and To Bank must be different."); return; }
    if (!branchId) { setErr("Please select a branch."); return; }

    setSaving(true);
    try {
      const receiptImage = receiptFile ? await uploadReceipt(receiptFile) : undefined;
      if (edit) {
        await updateMovementEntry(edit.movementId, {
          category, amount, fromBankId: +fromBankId, fromBank, mode, receiptImage,
          toBankId: loan ? undefined : +toBankId, toBank: loan ? loanBank : toBank,
          branchId, occurredOn: date, remarks: remarks.trim(),
        });
        onSaved?.();
        closeModal();
        toast("Self transfer updated");
        return;
      }
      await createSelfTransfer({
        category, amount, fromBankId: +fromBankId, fromBank, mode, receiptImage,
        toBankId: loan ? undefined : +toBankId, toBank: loan ? loanBank : toBank,
        branchId, occurredOn: date, remarks: remarks.trim() || undefined,
      });
      onSaved?.();
      closeModal();
      toast(`${fmt(amount)} transferred ${fromBank} → ${loan ? loanBank : toBank}`);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Could not save — try again.");
    } finally {
      setSaving(false);
    }
  }); }

  const bankPicker = (value: string, onPick: (id: string, name: string) => void) => (
    <SearchableSelect<BackendBank>
      portal
      value={value}
      onChange={(id, item) => onPick(id, item.name)}
      fetchFn={searchBanksPage}
      searchHint="Searches: bank name"
      getLabel={(b) => b.name}
      getId={(b) => String(b.id)}
      placeholder="Search or add a bank…"
      allowCreate
      onCreate={createBank}
    />
  );

  return (
    <>
      <div className="hd"><h3>{edit ? "Edit Self Transfer" : "Self Transfer"}</h3><button className="x" onClick={closeModal}>×</button></div>
      <div className="bd bd-scroll entry-form">
        {tabs}
        {/* Same order as every entry form: Category → Date → Mode → Amount → Branch → Bill
            (the From/To banks sit with Mode, since they replace the usual Bank field). */}
        <div className="frow">
          <div><label className="f">Category *</label>
            <SearchableSelect<BackendCategory>
              portal
              value={category}
              onChange={(_id, item) => {
                setCatRec(item);
                // A category from another form: choosing it flips it to common.
                if (item.type !== "self_transfer" && !item.isCommon) createCategory("self_transfer")(item.name).catch(() => {});
              }}
              fetchFn={searchTransferCategories}
              searchHint="Searches: category / loan name"
              getLabel={(s) => s.name}
              getId={(s) => String(s.id)}
              placeholder="Search or add a category…"
              allowCreate
              onCreate={createCategory("self_transfer")}
            /></div>
        </div>
        <div className="frow c2">
          <div><label className="f">Date *</label><DatePicker value={date} onChange={setDate} /></div>
          <div><label className="f">Mode *</label><Select options={MODE_OPTIONS} value={mode} onChange={setMode} /></div>
        </div>
        <div className="frow c2">
          <div><label className="f">From Bank *</label>{bankPicker(fromBank, (id, name) => { setFromBankId(id); setFromBank(name); })}</div>
          <div><label className="f">To Bank * {loan && <span style={{ fontWeight: 400, color: "var(--muted)" }}>(loan&apos;s bank)</span>}</label>
            {loan
              ? <input className="inp" readOnly value={loanBank || "No bank recorded for this loan"} />
              : bankPicker(toBank, (id, name) => { setToBankId(id); setToBank(name); })}
          </div>
        </div>
        <div className={showBranch ? "frow c2" : "frow"}>
          <div><label className="f">Amount (₹) *</label><input className="inp" type="number" min={1} value={amt} onChange={(e) => setAmt(e.target.value)} onWheel={noWheelStep} /></div>
          {showBranch && (
            <div><label className="f">Branch *</label>
              <Select
                disabled={branchLocked}
                options={branches.map((b) => ({ value: String(b.id), label: b.name }))}
                value={branchId ? String(branchId) : ""}
                onChange={(v) => setBranchId(v ? Number(v) : "")}
                placeholder="Select branch…"
              /></div>
          )}
        </div>
        <div className="frow"><div><label className="f">Bill{edit?.receiptImage ? <span style={{ fontWeight: 400, color: "var(--muted)" }}> (a bill is attached — choose a file to replace it)</span> : null}</label>
          <FileInput value={receiptFile} onChange={setReceiptFile} accept="image/*" /></div></div>
        <div className="frow"><div><label className="f">Remarks</label>
          <textarea className="inp" rows={2} placeholder="Optional notes" value={remarks} onChange={(e) => setRemarks(e.target.value)} /></div></div>
        {loanWarning && (
          <div className="notice" style={{ marginBottom: 4, borderLeft: "3px solid var(--red)", color: "var(--red)" }}>
            {loanWarning}
          </div>
        )}
        <p style={{ color: "var(--red)", fontSize: 12.5, minHeight: 16, marginTop: 8 }}>{err}</p>
      </div>
      <div className="ft">
        <button className="btn ghost" onClick={closeModal}>Cancel</button>
        <button className="btn" onClick={save} disabled={saving || loanExceeded}><Icon name="check" /> {saving ? "Saving…" : edit ? "Save Changes" : "Record Transfer"}</button>
      </div>
    </>
  );
}
