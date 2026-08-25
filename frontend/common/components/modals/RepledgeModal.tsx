"use client";

import { useState } from "react";
import { useModal } from "@/common/components/Modal";
import { useToast } from "@/common/components/Toast";
import { Icon } from "@/common/components/Icon";
import { fmt, fmtW } from "@/common/utils/format";
import { recordBankPledge, searchLoansPage, type BankPledgeCashTreatment, type LoanView } from "@/modules/loans/services/loanService";
import { searchBanksPage, type BackendBank } from "@/modules/banks/services/bankService";
import { SearchableSelect } from "@/common/components/ui/SearchableSelect";
import { DatePicker } from "@/common/components/ui/DatePicker";
import { ApiError } from "@/common/services/httpClient";

/* Ported from legacy/app.js's `openRepledgeModal()` / `saveRepledge()`. Now
 * posts to the real POST /loans/:id/bank-pledge endpoint. The old mock's
 * bank picker (sourced from db.banks, a hardcoded list) has no backend
 * equivalent — replaced with a free-text bank name field, matching the
 * backend's BankPledgeRecord.BankName (a plain string, not a Bank
 * resource) — that's since changed: banks are now a real backend resource
 * (see internal/bank), so the field below is a SearchableSelect against
 * `GET /banks`. Unlike NewLoan.tsx's ornament-type picker, inline creation
 * is intentionally disabled here — per the bank re-pledge spec, a bank
 * must be registered (with its branch/IFSC/account details) via "Add
 * Bank" (BankModal.tsx) before it can be re-pledged against, so staff
 * can't accidentally create a bare, detail-less bank record from this
 * modal. */
export function RepledgeModalContent({ loan, onSaved }: { loan: LoanView; onSaved: () => void }) {
  const { closeModal } = useModal();
  const toast = useToast();
  const today = new Date().toISOString().slice(0, 10);

  const [bank, setBank] = useState("");
  const [bankId, setBankId] = useState<number | undefined>(undefined);
  const [bankLabel, setBankLabel] = useState("");
  const [amt, setAmt] = useState("");
  const [date, setDate] = useState(today);
  const [dueDate, setDueDate] = useState("");
  const [interestRate, setInterestRate] = useState("");
  const [referenceNumber, setReferenceNumber] = useState("");
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);

  /* Defaults to RecordOnly — the harmless choice. Staff must actively opt in to
   * moving money, rather than being blocked by a required field: leaving this
   * alone just files a paperwork record. Immutable once saved (a wrong pick is
   * fixed by voiding the record), so the consequence is spelled out below the
   * control rather than left to be discovered afterwards. */
  const [cashTreatment, setCashTreatment] = useState<BankPledgeCashTreatment>("RecordOnly");

  async function save() {
    if (!bank.trim()) { setErr("Please enter the bank to repledge with."); return; }
    if (!date) { setErr("Please select the pledge date."); return; }
    const amount = +amt;
    if (!amount || amount <= 0) { setErr("Please enter the pledged amount."); return; }
    setSaving(true);
    try {
      await recordBankPledge(loan.numericId, {
        bankId,
        bankName: bank.trim(),
        pledgedAmount: amount,
        pledgeDate: date,
        bankInterestRate: interestRate ? +interestRate : undefined,
        referenceNumber: referenceNumber.trim() || undefined,
        bankPledgeDueDate: dueDate || undefined,
        cashTreatment,
      });
      onSaved();
      closeModal();
      toast(
        cashTreatment === "CashIn"
          ? `Gold repledged to ${bank.trim()} — ${fmt(amount)} added to Cash-in-Hand`
          : `Gold repledged to ${bank.trim()} — recorded only, no cash effect`
      );
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
        {loan.ornaments.length > 0 && (
          <div style={{ marginBottom: 16 }}>
            <label className="f">Gold/Ornaments Being Pledged</label>
            <ul style={{ margin: "4px 0 0", paddingLeft: 18, fontSize: 13 }}>
              {loan.ornaments.map((o) => (
                <li key={o.id}>
                  {o.name} — {fmtW(o.netWeight)} net ({o.purity})
                  {o.quantity > 1 ? ` × ${o.quantity}` : ""}
                </li>
              ))}
            </ul>
          </div>
        )}
        <div className="frow"><div><label className="f">Bank *</label>
          <SearchableSelect<BackendBank>
            value={bankLabel}
            onChange={(id, item) => { setBank(item.name); setBankLabel(item.name); setBankId(Number(id) || undefined); }}
            fetchFn={searchBanksPage}
            getLabel={(b) => b.name}
            getId={(b) => String(b.id)}
            placeholder="Search for a registered bank…"
          /></div></div>
        <div className="frow c2">
          <div><label className="f">Pledged Amount (₹) *</label><input className="inp" type="number" min={1} placeholder="amount raised from bank" value={amt} onChange={(e) => setAmt(e.target.value)} /></div>
          <div><label className="f">Pledge Date *</label><DatePicker value={date} onChange={setDate} /></div>
        </div>
        <div className="frow c2">
          <div><label className="f">Bank Interest Rate (% p.a.)</label><input className="inp" type="number" min={0} step={0.01} placeholder="rate charged by the bank" value={interestRate} onChange={(e) => setInterestRate(e.target.value)} /></div>
          <div><label className="f">Reference Number</label><input className="inp" placeholder="bank's pledge/document reference" value={referenceNumber} onChange={(e) => setReferenceNumber(e.target.value)} maxLength={60} /></div>
        </div>
        <div className="frow"><div><label className="f">Bank Pledge Due Date</label><DatePicker value={dueDate} onChange={setDueDate} min={date} /></div></div>

        {/* Cash treatment. Not every re-pledge brings money into the branch
          * till — some are purely book-keeping — so this is an explicit choice
          * per transaction rather than an assumption. */}
        <div className="frow"><div>
          <label className="f">Cash Treatment *</label>
          <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 4 }}>
            <label className="cradio" style={{ fontSize: 13 }}>
              <input
                type="radio"
                name="cashTreatment"
                checked={cashTreatment === "RecordOnly"}
                onChange={() => setCashTreatment("RecordOnly")}
              />
              <span className="mark" />
              <span><strong>Record Only</strong> — no cash effect. Files the re-pledge record without touching Cash-in-Hand.</span>
            </label>
            <label className="cradio" style={{ fontSize: 13 }}>
              <input
                type="radio"
                name="cashTreatment"
                checked={cashTreatment === "CashIn"}
                onChange={() => setCashTreatment("CashIn")}
              />
              <span className="mark" />
              <span><strong>Add to Cash-in-Hand</strong> — the bank&apos;s advance came into the branch till.</span>
            </label>
          </div>
          {/* .notice is display:flex — keep the text in one child element. */}
          <p className="notice" style={{ marginTop: 8, fontSize: 12.5 }}>
            <Icon name="shield" />
            <span>
              {cashTreatment === "CashIn"
                ? `${amt ? fmt(+amt) : "The pledged amount"} will be added to Cash-in-Hand now, and booked back out when the gold is released.`
                : "No cash movement will be created, now or on release."}
              {" "}This cannot be edited later — a wrong choice must be corrected by voiding the record.
            </span>
          </p>
        </div></div>

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
 * Re-Pledge page, then hands off to RepledgeModalContent above.
 *
 * The picker is a SearchableSelect (server-side search, 10 rows per request,
 * next page appended on scroll) rather than a native <select> over the
 * caller's already-loaded loan array — that array is the Bank Re-Pledge
 * page's own list, which won't stay complete as loan volume grows. */
const loanLabel = (l: LoanView) =>
  `${l.id} — ${l.customerName} (${fmtW(l.totalNetWeight)}, outstanding ${fmt(l.outstanding)})`;

const searchEligibleLoansPage = (q: string, page: number) =>
  searchLoansPage(q, page, { excludeBankPledged: true });

export function SelectLoanForRepledgeModalContent({ onPicked }: { onPicked: (loan: LoanView) => void }) {
  const { closeModal } = useModal();
  const [selected, setSelected] = useState<LoanView | null>(null);
  const [label, setLabel] = useState("");

  return (
    <>
      <div className="hd"><h3>New Bank Re-Pledge</h3><button className="x" onClick={closeModal}>×</button></div>
      <div className="bd">
        <div className="frow"><div><label className="f">Loan *</label>
          <SearchableSelect<LoanView>
            value={label}
            onChange={(_id, l) => { setSelected(l); setLabel(loanLabel(l)); }}
            fetchFn={searchEligibleLoansPage}
            getLabel={loanLabel}
            getId={(l) => String(l.numericId)}
            placeholder="Search by loan number…"
          /></div></div>
        <p className="notice"><Icon name="shield" /><span>Only loans whose gold isn&apos;t already with a bank are listed. Type a loan number to search, or scroll for more.</span></p>
      </div>
      <div className="ft">
        <button className="btn ghost" onClick={closeModal}>Cancel</button>
        <button className="btn" disabled={!selected} onClick={() => selected && onPicked(selected)}><Icon name="check" /> Next</button>
      </div>
    </>
  );
}
