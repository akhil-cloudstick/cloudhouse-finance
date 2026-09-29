"use client";

import { useState } from "react";
import { useModal } from "@/common/components/Modal";
import { useToast } from "@/common/components/Toast";
import { Icon } from "@/common/components/Icon";
import { fmt } from "@/common/utils/format";
import { ApiError } from "@/common/services/httpClient";
import { createCashMovement } from "@/modules/cash/services/cashService";
import { searchBanksPage, createBank, type BackendBank } from "@/modules/banks/services/bankService";
import { searchCashSourcesPage, createCashSource, type BackendCashSource } from "@/modules/cash/services/cashSourceService";
import { SearchableSelect } from "@/common/components/ui/SearchableSelect";
import { Select } from "@/common/components/ui/Select";
import { DatePicker } from "@/common/components/ui/DatePicker";

const MODE_OPTIONS = [
  { value: "Cash", label: "Cash" },
  { value: "UPI", label: "UPI" },
  { value: "Bank Transfer", label: "Bank Transfer" },
];

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
 * arrived — the Bank picker doubles for both cases that imply one: a
 * Loan-sourced top-up (which bank the loan itself came from) and a non-cash
 * Mode (which bank the UPI/transfer moved through) — see `bankRequired`
 * below and backend/internal/cash/service.go's Record. */
export function AddCashModalContent({ onSaved }: { onSaved?: () => void }) {
  const { closeModal } = useModal();
  const toast = useToast();
  const today = new Date().toISOString().slice(0, 10);

  const [source, setSource] = useState("");
  const [mode, setMode] = useState("");
  const [bank, setBank] = useState("");
  const [amt, setAmt] = useState("");
  const [date, setDate] = useState(today);
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);

  const isLoan = source === "Loan";

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

  // Bank is required for a non-cash Mode (which bank the UPI/transfer
  // actually moved through) — see backend/internal/cash/service.go's
  // Record. A Loan-sourced top-up asks the same "which bank" question via
  // the Loan Details block's own Bank field instead (isLoan excludes it
  // here so it's never shown twice).
  const bankRequired = !isLoan && (mode === "UPI" || mode === "Bank Transfer");

  async function save() {
    if (!source) { setErr("Please select where the cash is coming from."); return; }
    if (!mode) { setErr("Please select the mode of cash."); return; }
    if (bankRequired && !bank) {
      setErr("Please select the bank.");
      return;
    }
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
        bank: isLoan ? loanBankName : bankRequired ? bank : undefined,
        amount, occurredOn: date, loanSource,
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
        <div className={bankRequired ? "frow c3" : "frow c2"}>
          <div><label className="f">Source of Cash *</label>
            <SearchableSelect<BackendCashSource>
              value={source}
              onChange={(_id, item) => {
                const v = item.name;
                setSource(v);
                if (v !== "Loan" && mode !== "UPI" && mode !== "Bank Transfer") setBank("");
              }}
              fetchFn={searchCashSourcesPage}
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
              onChange={(v) => { setMode(v); if (v !== "UPI" && v !== "Bank Transfer" && !isLoan) setBank(""); }}
              placeholder="Select mode…"
            /></div>
          {bankRequired && (
            <div><label className="f">Bank *</label>
              <SearchableSelect<BackendBank>
                value={bank}
                onChange={(_id, item) => setBank(item.name)}
                fetchFn={searchBanksPage}
                getLabel={(b) => b.name}
                getId={(b) => String(b.id)}
                placeholder="Search or add a bank…"
                allowCreate
                onCreate={createBank}
              /></div>
          )}
        </div>

        {isLoan && (
          <div style={{ border: "1px dashed var(--line)", borderRadius: 8, padding: 12, marginTop: 4 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: "var(--accent, #8a6d3b)", marginBottom: 12 }}>LOAN DETAILS</div>
            <div className="frow c3">
              <div><label className="f">Bank *</label>
                <SearchableSelect<BackendBank>
                  value={loanBankName}
                  onChange={(id, item) => { setLoanBankId(id); setLoanBankName(item.name); }}
                  fetchFn={searchBanksPage}
                  getLabel={(b) => b.name}
                  getId={(b) => String(b.id)}
                  placeholder="Search or add a bank…"
                  allowCreate
                  onCreate={createBank}
                /></div>
              <div><label className="f">Loan Number *</label>
                <input className="inp" placeholder="e.g. LN-00049" value={loanNumber} onChange={(e) => setLoanNumber(e.target.value)} /></div>
              <div><label className="f">Principal Amount (₹) *</label>
                <input className="inp" type="number" min={1} value={principalAmount} onChange={(e) => setPrincipalAmount(e.target.value)} /></div>
            </div>
            <div className="frow c3">
              <div><label className="f">Interest Rate (%)</label>
                <input className="inp" type="number" min={0} step="0.01" placeholder="Optional" value={interestRate} onChange={(e) => setInterestRate(e.target.value)} /></div>
              <div><label className="f">Duration (months)</label>
                <input className="inp" type="number" min={1} placeholder="Optional" value={durationMonths} onChange={(e) => setDurationMonths(e.target.value)} /></div>
            </div>
          </div>
        )}

        <div className="frow c2" style={{ marginTop: isLoan ? 14 : 0 }}>
          <div><label className="f">Cash Amount (₹) *</label><input className="inp" type="number" min={1} value={amt} onChange={(e) => setAmt(e.target.value)} /></div>
          <div><label className="f">{isLoan ? "Date of Loan *" : "Date *"}</label><DatePicker value={date} onChange={setDate} /></div>
        </div>
        <p style={{ color: "var(--red)", fontSize: 12.5, minHeight: 16, marginTop: 8 }}>{err}</p>
      </div>
      <div className="ft">
        <button className="btn ghost" onClick={closeModal}>Cancel</button>
        <button className="btn" onClick={save} disabled={saving}><Icon name="check" /> {saving ? "Saving…" : "Add Cash"}</button>
      </div>
    </>
  );
}
