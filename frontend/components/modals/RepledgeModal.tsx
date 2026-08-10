"use client";

import { useState } from "react";
import { useModal } from "@/components/Modal";
import { useToast } from "@/components/Toast";
import { Icon } from "@/lib/icons";
import { fmt, fmtW } from "@/lib/format";
import { recordBankPledge, type LoanView } from "@/lib/loansApi";
import { searchBanksPage, createBank, type BackendBank } from "@/lib/bankApi";
import { SearchableSelect } from "@/components/SearchableSelect";
import { ApiError } from "@/lib/api";

/* Ported from legacy/app.js's `openRepledgeModal()` / `saveRepledge()`. Now
 * posts to the real POST /loans/:id/bank-pledge endpoint. The old mock's
 * bank picker (sourced from db.banks, a hardcoded list) has no backend
 * equivalent — replaced with a free-text bank name field, matching the
 * backend's BankPledgeRecord.BankName (a plain string, not a Bank
 * resource) — that's since changed: banks are now a real backend resource
 * (see internal/bank), so the field below is a SearchableSelect against
 * `GET /banks` with allowCreate, matching NewLoan.tsx's ornament-type
 * picker — typing a bank that doesn't exist yet shows a "+ Create" row
 * that adds it. */
export function RepledgeModalContent({ loan, onSaved }: { loan: LoanView; onSaved: () => void }) {
  const { closeModal } = useModal();
  const toast = useToast();
  const today = new Date().toISOString().slice(0, 10);

  const [bank, setBank] = useState("");
  const [bankLabel, setBankLabel] = useState("");
  const [amt, setAmt] = useState("");
  const [date, setDate] = useState(today);
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!bank.trim()) { setErr("Please enter the bank to repledge with."); return; }
    if (!date) { setErr("Please select the pledge date."); return; }
    const amount = +amt;
    if (!amount || amount <= 0) { setErr("Please enter the pledged amount."); return; }
    setSaving(true);
    try {
      await recordBankPledge(loan.numericId, { bankName: bank.trim(), pledgedAmount: amount, pledgeDate: date });
      onSaved();
      closeModal();
      toast(`Gold repledged to ${bank.trim()}`);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Could not record the pledge — try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div className="hd"><h3>Repledge Gold to Bank — {loan.id}</h3><button className="x" onClick={closeModal}>×</button></div>
      <div className="bd">
        <div className="notice" style={{ marginBottom: 16 }}>
          <Icon name="bank" /> {fmtW(loan.totalNetWeight)} gold pledged against this loan
        </div>
        <div className="frow"><div><label className="f">Bank *</label>
          <SearchableSelect<BackendBank>
            value={bankLabel}
            onChange={(_id, item) => { setBank(item.name); setBankLabel(item.name); }}
            fetchFn={searchBanksPage}
            getLabel={(b) => b.name}
            getId={(b) => String(b.id)}
            placeholder="Search or add a bank…"
            allowCreate
            onCreate={createBank}
          /></div></div>
        <div className="frow c2">
          <div><label className="f">Pledged Amount (₹) *</label><input className="inp" type="number" min={1} placeholder="amount raised from bank" value={amt} onChange={(e) => setAmt(e.target.value)} /></div>
          <div><label className="f">Pledge Date *</label><input className="inp" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
        </div>
        <p style={{ color: "var(--red)", fontSize: 12.5, minHeight: 16, marginTop: 8 }}>{err}</p>
      </div>
      <div className="ft">
        <button className="btn ghost" onClick={closeModal}>Cancel</button>
        <button className="btn" onClick={save} disabled={saving}><Icon name="check" /> {saving ? "Saving…" : "Repledge to Bank"}</button>
      </div>
    </>
  );
}

/* Loan picker shown by BankPledge.tsx's "New Re-Pledge" button — that page
 * previously only allowed starting a repledge from a loan's own detail page
 * (LoanDetail.tsx's "Repledge to Bank" button). This lets staff kick off a
 * repledge for any not-yet-bank-pledged loan directly from the Bank
 * Re-Pledge page, then hands off to RepledgeModalContent above. */
export function SelectLoanForRepledgeModalContent({ loans, onPicked }: { loans: LoanView[]; onPicked: (loan: LoanView) => void }) {
  const { closeModal } = useModal();
  const [loanId, setLoanId] = useState("");

  const eligible = loans.filter((l) => l.bankPledgeStatus !== "Bank Pledged");
  const selected = eligible.find((l) => l.id === loanId);

  return (
    <>
      <div className="hd"><h3>New Bank Re-Pledge</h3><button className="x" onClick={closeModal}>×</button></div>
      <div className="bd">
        <div className="frow"><div><label className="f">Loan *</label>
          <select className="inp" value={loanId} onChange={(e) => setLoanId(e.target.value)}>
            <option value="">Select loan…</option>
            {eligible.map((l) => <option key={l.id} value={l.id}>{l.id} — {l.customerName} ({fmtW(l.totalNetWeight)}, outstanding {fmt(l.outstanding)})</option>)}
          </select></div></div>
        {eligible.length === 0 && (
          <p className="notice"><Icon name="shield" /> No loans are eligible for a new bank re-pledge right now — every loan is either already bank-pledged or has none.</p>
        )}
      </div>
      <div className="ft">
        <button className="btn ghost" onClick={closeModal}>Cancel</button>
        <button className="btn" disabled={!selected} onClick={() => selected && onPicked(selected)}><Icon name="check" /> Next</button>
      </div>
    </>
  );
}
