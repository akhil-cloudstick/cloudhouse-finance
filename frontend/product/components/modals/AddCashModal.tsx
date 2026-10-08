"use client";

import { useEffect, useState } from "react";
import { useModal } from "@/product/components/Modal";
import { useToast } from "@/product/components/Toast";
import { Icon } from "@/product/components/Icon";
import { fmt } from "@/product/utils/format";
import { ApiError } from "@/product/services/httpClient";
import { createCashMovement, createGoldSale } from "@/product/pages/cash/services/cashService";
import { listActiveBranches, type BranchView } from "@/product/pages/branches/services/branchService";
import { useBranding } from "@/product/providers/BrandingProvider";
import { searchBanksPage, createBank, type BackendBank } from "@/product/pages/banks/services/bankService";
import { searchCashSourcesPage, createCashSource, isLoanSource, type BackendCashSource } from "@/product/pages/cash/services/cashSourceService";
import { EXPENSE_CATEGORIES_CHANGED } from "@/product/pages/cash/services/expenseCategoryService";
import { SearchableSelect } from "@/product/components/ui/SearchableSelect";
import { Select } from "@/product/components/ui/Select";
import { DatePicker } from "@/product/components/ui/DatePicker";
import { singleFlight } from "@/product/utils/singleFlight";

// A focused number input steps its value on mouse-wheel; blurring first
// lets the wheel scroll the modal instead of changing the amount.
const noWheelStep = (e: React.WheelEvent<HTMLInputElement>) => e.currentTarget.blur();

const MODE_OPTIONS = [
  { value: "Cash", label: "Cash" },
  { value: "UPI", label: "UPI" },
  { value: "Bank Transfer", label: "Bank Transfer" },
];

// "Gold Sale" is a built-in source, not a cash.CashSource row — picking it
// turns this modal into the gold-sale form and posts to /gold-sales instead
// (the backend refuses to create a real source with this name).
const GOLD_SALE = "Gold Sale";
const GOLD_SALE_SOURCE: BackendCashSource = { id: -1, name: GOLD_SALE, createdAt: "" };

async function searchSourcesWithGoldSale(q: string, page: number) {
  const res = await searchCashSourcesPage(q, page);
  const matches = !q || GOLD_SALE.toLowerCase().includes(q.trim().toLowerCase());
  return page === 0 && matches ? { ...res, items: [GOLD_SALE_SOURCE, ...res.items] } : res;
}

/* Ported from legacy/app.js's `openAddCashModal()` / `acSourceChanged()` /
 * `saveAddCash()` — now posts to the real POST /cash-movements endpoint.
 * The bank picker used to come from db.banks (a hardcoded list); banks are
 * now a real backend resource (see internal/bank), so this uses the same
 * SearchableSelect + allowCreate pattern as RepledgeModal.tsx.
 *
 * Source of Cash used to be a fixed Savings/Loan <Select> — it's now a
 * SearchableSelect backed by cash.CashSource (find-or-create, same pattern
 * as the Bank picker), so staff can add a new source on the fly instead of
 * being limited to the two defaults. A source whose name starts with
 * "Loan" (isLoanSource — e.g. "Loan HDFC 4471") is one bank loan: the
 * first time it's used the Loan Details block (bank, loan number,
 * principal) comes right after the source, and those details are kept on
 * the source itself — picking it again shows just the normal form. See
 * backend/internal/cash/model.go's CashSource.
 *
 * Mode of Cash (Cash/UPI/Bank Transfer) records how the money physically
 * arrived — a non-cash Mode asks for the one bank account it landed in (see
 * `bankRequired` below and backend/internal/cash/service.go's Record).
 *
 * The built-in "Gold Sale" source (see GOLD_SALE) swaps in the gold-sale
 * fields — ornament type, cost, branch, remarks — and records a gold sale. */
export function AddCashModalContent({ onSaved, defaultBranchId }: { onSaved?: () => void; defaultBranchId?: number }) {
  const { closeModal } = useModal();
  const toast = useToast();
  const today = new Date().toISOString().slice(0, 10);

  // The whole picked row, not just its name — a loan source carries its
  // already-captured details (principalAmount etc.).
  const [sourceRec, setSourceRec] = useState<BackendCashSource | null>(null);
  const source = sourceRec?.name ?? "";
  const [mode, setMode] = useState("");
  // The branch's own account the UPI/transfer landed in.
  const [bank, setBank] = useState("");
  const [bankId, setBankId] = useState("");
  const [amt, setAmt] = useState("");
  const [date, setDate] = useState(today);
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);

  const isLoan = isLoanSource(source);
  const isGoldSale = source === GOLD_SALE;
  // A loan source asks for its details only once — on its first entry.
  const needsLoanDetails = isLoan && sourceRec?.principalAmount == null;

  // Gold Sale fields — only shown/required when source is GOLD_SALE.
  const [ornamentType, setOrnamentType] = useState("");
  const [costAmount, setCostAmount] = useState("");
  const [remarks, setRemarks] = useState("");
  // Every cash-in lands in one branch's till — without a branch it never
  // reaches any branch's Balance in Hand (cash.SummaryService only sums a
  // branch's own movements), so Branch is required for every source.
  // Defaults to the branch the Cash page is currently showing.
  const [branches, setBranches] = useState<BranchView[]>([]);
  // Single-branch business: the one branch is preselected and the picker locked.
  const { singleBranch } = useBranding();
  const [branchId, setBranchId] = useState<number | "">(defaultBranchId || "");
  useEffect(() => {
    listActiveBranches().then((list) => {
      setBranches(list);
      if (list.length) setBranchId((cur) => cur || list[0].id);
    }).catch(() => setErr("Could not load branches — try again later."));
  }, []);
  const sold = +amt || 0;
  const profit = sold > 0 ? sold - (+costAmount || 0) : 0;

  // Loan Details block — only shown/required on a loan source's first
  // entry (needsLoanDetails). Its Bank is the bank the loan came from.
  const [loanBankId, setLoanBankId] = useState("");
  const [loanBankName, setLoanBankName] = useState("");
  const [loanNumber, setLoanNumber] = useState("");
  const [principalAmount, setPrincipalAmount] = useState("");
  // The cash drawn defaults to the loan's principal — still editable after,
  // for a loan drawn in parts.
  const setPrincipal = (v: string) => { setPrincipalAmount(v); setAmt(v); };

  // Bank is required for a non-cash Mode — the branch account the
  // UPI/transfer landed in (see backend/internal/cash/service.go's Record).
  const bankRequired = mode === "UPI" || mode === "Bank Transfer";

  async function saveGoldSale() { return singleFlight("modal:addcash:saveGoldSale", async () => {
    const type = ornamentType.trim();
    const cost = +costAmount || 0;
    if (!type) { setErr("Please enter the ornament type."); return; }
    if (!(sold > 0)) { setErr("Please enter a valid sold amount."); return; }
    if (cost < 0) { setErr("Cost amount cannot be negative."); return; }
    if (!date) { setErr("Please select the date."); return; }
    if (!branchId) { setErr("Please select a branch."); return; }

    setSaving(true);
    try {
      await createGoldSale({
        ornamentType: type, soldAmount: sold, costAmount: cost, branchId,
        mode, bankId: bankRequired ? +bankId : undefined,
        soldOn: date, remarks: remarks.trim() || undefined,
      });
      onSaved?.();
      closeModal();
      toast(`Gold sale of ${fmt(sold)} recorded${profit >= 0 ? ` — profit ${fmt(profit)}` : ` — loss ${fmt(Math.abs(profit))}`}`);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Could not save — try again.");
    } finally {
      setSaving(false);
    }
  }); }

  async function save() { return singleFlight("modal:addcash:save", async () => {
    if (!source) { setErr("Please select where the cash is coming from."); return; }
    if (!mode) { setErr("Please select the mode of cash."); return; }
    if (bankRequired && !bankId) {
      setErr("Please select the bank.");
      return;
    }
    if (!branchId) { setErr("Please select a branch."); return; }
    if (isGoldSale) { await saveGoldSale(); return; }
    const amount = +amt;
    if (!(amount > 0)) { setErr("Please enter a valid cash amount."); return; }
    if (!date) { setErr(needsLoanDetails ? "Please select the date of the loan." : "Please select the date."); return; }

    // Only a loan source's first entry sends its details — later entries
    // reuse the ones the backend already holds on the source.
    let loanSource: { bankId: number; loanNumber: string; principalAmount: number } | undefined;
    if (needsLoanDetails) {
      if (!loanBankId) { setErr("Please select the bank the loan is from."); return; }
      if (!loanNumber.trim()) { setErr("Please enter the loan number."); return; }
      const principal = +principalAmount;
      if (!(principal > 0)) { setErr("Please enter a valid principal amount."); return; }
      if (amount > principal) { setErr("Cash amount can't be more than the loan's principal."); return; }
      loanSource = { bankId: +loanBankId, loanNumber: loanNumber.trim(), principalAmount: principal };
    }

    setSaving(true);
    try {
      await createCashMovement({
        type: "in", source, mode,
        bank: bankRequired ? bank : needsLoanDetails ? loanBankName : undefined,
        bankId: bankRequired ? +bankId : undefined,
        amount, branchId, occurredOn: date, loanSource,
      });
      // A loan's first entry also created its repayment category server
      // side — reload the category links so its ledger link appears.
      if (loanSource) window.dispatchEvent(new Event(EXPENSE_CATEGORIES_CHANGED));
      onSaved?.();
      closeModal();
      toast(`${fmt(amount)} added to cash (${source} · ${mode})`);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Could not save — try again.");
    } finally {
      setSaving(false);
    }
  }); }

  const sourceField = (
    <div><label className="f">Source of Cash *</label>
      <SearchableSelect<BackendCashSource>
        portal
        value={source}
        onChange={(_id, item) => setSourceRec(item)}
        fetchFn={searchSourcesWithGoldSale}
        searchHint="Searches: cash source name"
        getLabel={(s) => s.name}
        getId={(s) => String(s.id)}
        placeholder="Search or add a source…"
        allowCreate
        onCreate={createCashSource}
      /></div>
  );
  const modeField = (
    <div><label className="f">Mode of Cash *</label>
      <Select
        options={MODE_OPTIONS}
        value={mode}
        onChange={(v) => { setMode(v); if (v !== "UPI" && v !== "Bank Transfer") { setBankId(""); setBank(""); } }}
        placeholder="Select mode…"
      /></div>
  );
  const bankField = (
    <div><label className="f">Bank * <span style={{ fontWeight: 400, color: "var(--muted)" }}>(your account)</span></label>
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
      /></div>
  );
  const bankRow = bankRequired && <div className="frow">{bankField}</div>;
  const branchRow = (
    <div className={isGoldSale ? "frow c2" : "frow"}>
      {isGoldSale && (
        <div><label className="f">Ornament Type *</label>
          <input className="inp" placeholder="e.g. Chain, Bangle, Studs" value={ornamentType} onChange={(e) => setOrnamentType(e.target.value)} /></div>
      )}
      <div><label className="f">Branch *</label>
        <Select
          disabled={singleBranch}
          options={branches.map((b) => ({ value: String(b.id), label: b.name }))}
          value={branchId ? String(branchId) : ""}
          onChange={(v) => setBranchId(v ? Number(v) : "")}
          placeholder="Select branch…"
        /></div>
    </div>
  );

  return (
    <>
      <div className="hd"><h3>Add Cash</h3><button className="x" onClick={closeModal}>×</button></div>
      <div className="bd bd-scroll">
        {needsLoanDetails ? (
          // A new loan source: Source → Loan Details → Mode → Bank? → Branch
          // → Cash Amount → Date of Loan.
          <>
            <div className="frow">{sourceField}</div>
            <div style={{ border: "1px dashed var(--line)", borderRadius: 8, padding: 12, marginBottom: 14 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: "var(--accent, #8a6d3b)", marginBottom: 12 }}>LOAN DETAILS</div>
              <div className="frow c2">
                <div><label className="f">Bank *</label>
                  <SearchableSelect<BackendBank>
                    portal
                    value={loanBankName}
                    onChange={(id, item) => { setLoanBankId(id); setLoanBankName(item.name); }}
                    fetchFn={searchBanksPage}
                    searchHint="Searches: bank name"
                    getLabel={(b) => b.name}
                    getId={(b) => String(b.id)}
                    placeholder="Search or add a bank…"
                    allowCreate
                    onCreate={createBank}
                  /></div>
                <div><label className="f">Loan Number *</label>
                  <input className="inp" placeholder="As on the bank's loan account" value={loanNumber} onChange={(e) => setLoanNumber(e.target.value)} /></div>
              </div>
              <div className="frow c2">
                <div><label className="f">Principal Amount (₹) *</label>
                  <input className="inp" type="number" min={1} value={principalAmount} onChange={(e) => setPrincipal(e.target.value)} onWheel={noWheelStep} /></div>
              </div>
            </div>
            <div className="frow c2">{modeField}{bankRequired && bankField}</div>
            {branchRow}
          </>
        ) : (
          <>
            <div className="frow c2">{sourceField}{modeField}</div>
            {bankRow}
            {branchRow}
          </>
        )}

        {isGoldSale ? (
          <>
            <div className="frow c2">
              <div><label className="f">Sold For (₹) *</label><input className="inp" type="number" min={1} value={amt} onChange={(e) => setAmt(e.target.value)} onWheel={noWheelStep} /></div>
              <div><label className="f">Cost to Acquire (₹) *</label><input className="inp" type="number" min={0} value={costAmount} onChange={(e) => setCostAmount(e.target.value)} onWheel={noWheelStep} /></div>
            </div>
            <div className="frow c2">
              <div><label className="f">Date *</label><DatePicker value={date} onChange={setDate} /></div>
            </div>
            {amt && (
              <div className="notice" style={{ marginBottom: 4 }}>
                {profit >= 0 ? "Profit" : "Loss"}: <strong style={{ color: profit >= 0 ? "var(--green)" : "var(--red)" }}>{fmt(Math.abs(profit))}</strong>
              </div>
            )}
            <div className="frow"><div><label className="f">Remarks</label>
              <textarea className="inp" rows={2} placeholder="Optional notes" value={remarks} onChange={(e) => setRemarks(e.target.value)} /></div></div>
          </>
        ) : (
          <div className="frow c2">
            <div><label className="f">Cash Amount (₹) *</label><input className="inp" type="number" min={1} value={amt} onChange={(e) => setAmt(e.target.value)} onWheel={noWheelStep} /></div>
            <div><label className="f">{needsLoanDetails ? "Date of Loan *" : "Date *"}</label><DatePicker value={date} onChange={setDate} /></div>
          </div>
        )}
        <p style={{ color: "var(--red)", fontSize: 12.5, minHeight: 16, marginTop: 8 }}>{err}</p>
      </div>
      <div className="ft">
        <button className="btn ghost" onClick={closeModal}>Cancel</button>
        <button className="btn" onClick={save} disabled={saving}><Icon name="check" /> {saving ? "Saving…" : isGoldSale ? "Record Sale" : "Add Cash"}</button>
      </div>
    </>
  );
}
