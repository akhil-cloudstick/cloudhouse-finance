"use client";

import { useEffect, useState } from "react";
import { useModal } from "@/product/components/Modal";
import { useToast } from "@/product/components/Toast";
import { Icon } from "@/product/components/Icon";
import { fmt } from "@/product/utils/format";
import { ApiError } from "@/product/services/httpClient";
import { createCashMovement, createGoldSale } from "@/product/pages/cash/services/cashService";
import { listActiveBranches, type BranchView } from "@/product/pages/branches/services/branchService";
import { searchBanksPage, createBank, type BackendBank } from "@/product/pages/banks/services/bankService";
import { searchCashSourcesPage, createCashSource, searchLoanSourcesPage, type BackendCashSource } from "@/product/pages/cash/services/cashSourceService";
import type { BackendLoanCashSource } from "@/product/pages/cash/services/cashService";
import { SearchableSelect } from "@/product/components/ui/SearchableSelect";
import { Select } from "@/product/components/ui/Select";
import { DatePicker } from "@/product/components/ui/DatePicker";

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
 * being limited to the two defaults. Picking "Loan" reveals the Loan
 * Details block below (bank/loan number/principal required, interest
 * rate/duration optional) — see backend/internal/cash/model.go's
 * LoanCashSource.
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

  const [source, setSource] = useState("");
  const [mode, setMode] = useState("");
  // The branch's own account the UPI/transfer landed in.
  const [bank, setBank] = useState("");
  const [bankId, setBankId] = useState("");
  const [amt, setAmt] = useState("");
  const [date, setDate] = useState(today);
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);

  const isLoan = source === "Loan";
  const isGoldSale = source === GOLD_SALE;

  // Gold Sale fields — only shown/required when source is GOLD_SALE.
  const [ornamentType, setOrnamentType] = useState("");
  const [costAmount, setCostAmount] = useState("");
  const [remarks, setRemarks] = useState("");
  // Every cash-in lands in one branch's till — without a branch it never
  // reaches any branch's Balance in Hand (cash.SummaryService only sums a
  // branch's own movements), so Branch is required for every source.
  // Defaults to the branch the Cash page is currently showing.
  const [branches, setBranches] = useState<BranchView[]>([]);
  const [branchId, setBranchId] = useState<number | "">(defaultBranchId || "");
  useEffect(() => {
    listActiveBranches().then((list) => {
      setBranches(list);
      if (list.length) setBranchId((cur) => cur || list[0].id);
    }).catch(() => setErr("Could not load branches — try again later."));
  }, []);
  const sold = +amt || 0;
  const profit = sold > 0 ? sold - (+costAmount || 0) : 0;

  // Loan Details block — only shown/required when source is "Loan". Its
  // Bank field IS the "which bank was this loan from" answer — the same
  // question bankRequired's plain Bank field would otherwise ask, so
  // isLoan skips that field entirely rather than showing Bank twice.
  const [loanBankId, setLoanBankId] = useState("");
  const [loanBankName, setLoanBankName] = useState("");
  const [loanNumber, setLoanNumber] = useState("");
  const [principalAmount, setPrincipalAmount] = useState("");
  const [interestRate, setInterestRate] = useState("");
  const [durationMonths, setDurationMonths] = useState("");
  // The cash drawn defaults to the loan's principal — still editable after,
  // for a loan drawn in parts.
  const setPrincipal = (v: string) => { setPrincipalAmount(v); setAmt(v); };

  // Bank is required for a non-cash Mode — the branch account the
  // UPI/transfer landed in (see backend/internal/cash/service.go's Record).
  const bankRequired = mode === "UPI" || mode === "Bank Transfer";

  async function saveGoldSale() {
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
  }

  async function save() {
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
    if (!date) { setErr(isLoan ? "Please select the date of the loan." : "Please select the date."); return; }

    let loanSource: { bankId: number; loanNumber: string; principalAmount: number; interestRate?: number; durationMonths?: number } | undefined;
    if (isLoan) {
      if (!loanBankId) { setErr("Please select the bank the loan is from."); return; }
      if (!loanNumber.trim()) { setErr("Please enter the loan number."); return; }
      const principal = +principalAmount;
      if (!(principal > 0)) { setErr("Please enter a valid principal amount."); return; }
      loanSource = {
        bankId: +loanBankId,
        loanNumber: loanNumber.trim(),
        principalAmount: principal,
        interestRate: interestRate.trim() ? +interestRate : undefined,
        durationMonths: durationMonths.trim() ? +durationMonths : undefined,
      };
    }

    setSaving(true);
    try {
      await createCashMovement({
        type: "in", source, mode,
        bank: bankRequired ? bank : isLoan ? loanBankName : undefined,
        bankId: bankRequired ? +bankId : undefined,
        amount, branchId, occurredOn: date, loanSource,
      });
      onSaved?.();
      closeModal();
      toast(`${fmt(amount)} added to cash (${source} · ${mode})`);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Could not save — try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div className="hd"><h3>Add Cash</h3><button className="x" onClick={closeModal}>×</button></div>
      <div className="bd bd-scroll">
        <div className="frow c2">
          <div><label className="f">Source of Cash *</label>
            <SearchableSelect<BackendCashSource>
                portal
              value={source}
              onChange={(_id, item) => setSource(item.name)}
              fetchFn={searchSourcesWithGoldSale}
              getLabel={(s) => s.name}
              getId={(s) => String(s.id)}
              placeholder="Search or add a source…"
              allowCreate
              onCreate={createCashSource}
            /></div>
          <div><label className="f">Mode of Cash *</label>
            <Select
              options={MODE_OPTIONS}
              value={mode}
              onChange={(v) => { setMode(v); if (v !== "UPI" && v !== "Bank Transfer") { setBankId(""); setBank(""); } }}
              placeholder="Select mode…"
            /></div>
        </div>

        {bankRequired && (
          <div className="frow">
            <div><label className="f">Bank * <span style={{ fontWeight: 400, color: "var(--muted)" }}>(your account)</span></label>
              <SearchableSelect<BackendBank>
                portal
                value={bank}
                onChange={(id, item) => { setBankId(id); setBank(item.name); }}
                fetchFn={searchBanksPage}
                getLabel={(b) => b.name}
                getId={(b) => String(b.id)}
                placeholder="Search or add a bank…"
                allowCreate
                onCreate={createBank}
              /></div>
          </div>
        )}

        <div className={isGoldSale ? "frow c2" : "frow"}>
          {isGoldSale && (
            <div><label className="f">Ornament Type *</label>
              <input className="inp" placeholder="e.g. Chain, Bangle, Studs" value={ornamentType} onChange={(e) => setOrnamentType(e.target.value)} /></div>
          )}
          <div><label className="f">Branch *</label>
            <Select
              options={branches.map((b) => ({ value: String(b.id), label: b.name }))}
              value={branchId ? String(branchId) : ""}
              onChange={(v) => setBranchId(v ? Number(v) : "")}
              placeholder="Select branch…"
            /></div>
        </div>

        {isLoan && (
          <div style={{ border: "1px dashed var(--line)", borderRadius: 8, padding: 12, marginTop: 4 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: "var(--accent, #8a6d3b)", marginBottom: 12 }}>LOAN DETAILS</div>
            <div className="frow c2">
              <div><label className="f">Bank *</label>
                <SearchableSelect<BackendBank>
                portal
                  value={loanBankName}
                  onChange={(id, item) => {
                    // The loan list is per bank — a loan picked under the old
                    // bank no longer applies.
                    if (id !== loanBankId) { setLoanNumber(""); setPrincipal(""); setInterestRate(""); setDurationMonths(""); }
                    setLoanBankId(id); setLoanBankName(item.name);
                  }}
                  fetchFn={searchBanksPage}
                  getLabel={(b) => b.name}
                  getId={(b) => String(b.id)}
                  placeholder="Search or add a bank…"
                  allowCreate
                  onCreate={createBank}
                /></div>
              <div><label className="f">Loan Number *</label>
                {/* key={loanBankId}: SearchableSelect caches results per
                  * search term, so remount to reload this bank's loans. */}
                <SearchableSelect<BackendLoanCashSource>
                portal
                  key={loanBankId}
                  value={loanNumber}
                  onChange={(_id, item) => {
                    setLoanNumber(item.loanNumber);
                    if (!item.id) return; // newly typed loan — nothing to pre-fill
                    setLoanBankId(String(item.bankId));
                    setLoanBankName(item.bank?.name || "");
                    setPrincipal(String(item.principalAmount));
                    setInterestRate(item.interestRate != null ? String(item.interestRate) : "");
                    setDurationMonths(item.durationMonths != null ? String(item.durationMonths) : "");
                  }}
                  fetchFn={(q, p) => searchLoanSourcesPage(q, p, loanBankId ? +loanBankId : undefined)}
                  getLabel={(l) => l.loanNumber}
                  getId={(l) => l.loanNumber}
                  renderLabel={(l) => (
                    <span className="ss-name">
                      <b style={{ flexShrink: 0 }}>{l.loanNumber}</b>
                      {l.bank?.name ? <span style={{ fontSize: 12, color: "var(--muted)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", minWidth: 0 }}>· {l.bank.name} · {fmt(l.principalAmount)}</span> : null}
                    </span>
                  )}
                  placeholder="Search or add a loan…"
                  allowCreate
                  onCreate={async (q) => ({ id: 0, cashMovementId: 0, bankId: 0, loanNumber: q, principalAmount: 0 })}
                /></div>
            </div>
            <div className="frow c2">
              <div><label className="f">Principal Amount (₹) *</label>
                <input className="inp" type="number" min={1} value={principalAmount} onChange={(e) => setPrincipal(e.target.value)} onWheel={noWheelStep} /></div>
              <div><label className="f">Interest Rate (%)</label>
                <input className="inp" type="number" min={0} step="0.01" placeholder="Optional" value={interestRate} onChange={(e) => setInterestRate(e.target.value)} onWheel={noWheelStep} /></div>
            </div>
            <div className="frow c2">
              <div><label className="f">Duration (months)</label>
                <input className="inp" type="number" min={1} placeholder="Optional" value={durationMonths} onChange={(e) => setDurationMonths(e.target.value)} onWheel={noWheelStep} /></div>
            </div>
          </div>
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
          <div className="frow c2" style={{ marginTop: isLoan ? 14 : 0 }}>
            <div><label className="f">Cash Amount (₹) *</label><input className="inp" type="number" min={1} value={amt} onChange={(e) => setAmt(e.target.value)} onWheel={noWheelStep} /></div>
            <div><label className="f">{isLoan ? "Date of Loan *" : "Date *"}</label><DatePicker value={date} onChange={setDate} /></div>
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
