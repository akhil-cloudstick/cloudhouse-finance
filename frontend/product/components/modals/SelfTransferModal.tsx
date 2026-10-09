"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useModal } from "@/product/components/Modal";
import { useToast } from "@/product/components/Toast";
import { Icon } from "@/product/components/Icon";
import { fmt } from "@/product/utils/format";
import { ApiError } from "@/product/services/httpClient";
import { createSelfTransfer, uploadReceipt } from "@/product/pages/cash/services/cashService";
import { listActiveBranches, type BranchView } from "@/product/pages/branches/services/branchService";
import { useBranding } from "@/product/providers/BrandingProvider";
import { useLockedBranchId, useShowBranch } from "@/product/hooks/useBranchSwitch";
import { searchBanksPage, createBank, type BackendBank } from "@/product/pages/banks/services/bankService";
import { isLoanSource } from "@/product/pages/cash/services/cashSourceService";
import { searchCategoriesPage, createCategory, type BackendCategory } from "@/product/pages/cash/services/categoryService";
import { SearchableSelect } from "@/product/components/ui/SearchableSelect";
import { Select } from "@/product/components/ui/Select";
import { DatePicker } from "@/product/components/ui/DatePicker";
import { FileInput } from "@/product/components/ui/FileInput";
import { useLoanBalance } from "@/product/hooks/useLoanBalance";
import { singleFlight } from "@/product/utils/singleFlight";

// How the money moved — both ledger rows show it. Banks are always From/To here,
// so unlike Credit/Debit there is no separate Bank field for the mode.
const MODE_OPTIONS = [
  { value: "Bank Transfer", label: "Bank Transfer" },
  { value: "UPI", label: "UPI" },
  { value: "Cash", label: "Cash" },
];

const noWheelStep = (e: React.WheelEvent<HTMLInputElement>) => e.currentTarget.blur();

const searchTransferCategories = searchCategoriesPage("self_transfer");

/* Self Transfer tab of the Ledger's Add Entry modal. Moves money between two
 * of the business's own banks: the backend records a debit on From Bank and a
 * credit on To Bank. A loan category locks To Bank to the loan's bank and
 * books the transfer as a repayment on that loan's ledger. */
export function SelfTransferModalContent({ onSaved, defaultBranchId, tabs }: { onSaved?: () => void; defaultBranchId?: number; tabs?: ReactNode }) {
  const { closeModal } = useModal();
  const toast = useToast();
  const today = new Date().toISOString().slice(0, 10);

  const [catRec, setCatRec] = useState<BackendCategory | null>(null);
  const category = catRec?.name ?? "";
  // A loan category (name starts with "Loan") makes this a repayment to the loan's bank.
  const loan = catRec && isLoanSource(catRec.name) ? catRec : null;
  const loanBank = loan?.bank?.name ?? "";
  const loanReady = !!loan && loan.principalAmount != null && !!loan.bankId;

  const [fromBank, setFromBank] = useState("");
  const [fromBankId, setFromBankId] = useState("");
  const [toBank, setToBank] = useState("");
  const [toBankId, setToBankId] = useState("");
  const [mode, setMode] = useState("Bank Transfer");
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [amt, setAmt] = useState("");

  // A transfer to a loan is a repayment — it can't exceed what has been drawn
  // and not yet repaid. Blocks the button (the backend refuses it too).
  const loanBal = useLoanBalance(loan);
  const owed = loanBal ? Math.max(loanBal.drawn - loanBal.repaid, 0) : 0;
  const loanExceeded = !!loanBal && (+amt || 0) > owed + 0.005;
  const loanWarning = loanExceeded
    ? `Repayment exceeds what has been paid on ${category} — only ${fmt(owed)} is outstanding.`
    : "";

  const [date, setDate] = useState(today);
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
  const [branchId, setBranchId] = useState<number | "">(defaultBranchId || lockedBranchId || "");
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
      await createSelfTransfer({
        category, amount, fromBankId: +fromBankId, fromBank, mode, receiptImage,
        toBankId: loan ? undefined : +toBankId, toBank: loan ? loanBank : toBank,
        branchId, occurredOn: date,
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
      <div className="hd"><h3>Self Transfer</h3><button className="x" onClick={closeModal}>×</button></div>
      <div className="bd bd-scroll">
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
        <div className="frow"><div><label className="f">Bill</label>
          <FileInput value={receiptFile} onChange={setReceiptFile} accept="image/*" /></div></div>
        {loanWarning && (
          <div className="notice" style={{ marginBottom: 4, borderLeft: "3px solid var(--red)", color: "var(--red)" }}>
            {loanWarning}
          </div>
        )}
        <p style={{ color: "var(--red)", fontSize: 12.5, minHeight: 16, marginTop: 8 }}>{err}</p>
      </div>
      <div className="ft">
        <button className="btn ghost" onClick={closeModal}>Cancel</button>
        <button className="btn" onClick={save} disabled={saving || loanExceeded}><Icon name="check" /> {saving ? "Saving…" : "Record Transfer"}</button>
      </div>
    </>
  );
}
