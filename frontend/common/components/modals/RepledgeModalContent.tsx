"use client";

import { useState } from "react";
import { useModal } from "@/common/components/ModalProvider";
import { useToast } from "@/common/components/ToastProvider";
import { Icon } from "@/common/components/Icon";
import { fmt, fmtW } from "@/common/utils/format";
import { recordBankPledge } from "@/modules/loans/services/loanService";
import { type BankPledgeCashTreatment, type LoanView } from "@/modules/loans/types/loan-types";
import { searchBanksPage } from "@/modules/banks/services/bankService";
import { type BackendBank } from "@/modules/banks/types/bank-types";
import { SearchableSelect } from "@/common/components/ui/SearchableSelect";
import { DatePicker } from "@/common/components/ui/DatePicker";
import { SplitPaymentInput, ZERO_SPLIT, type SplitAmounts } from "@/common/components/SplitPaymentInput";
import { ApiError } from "@/common/services/httpClient";
import { useIsSmallScreen } from "@/common/utils/responsive";
import { singleFlight } from "@/common/utils/singleFlight";
import { FieldError, fieldForMessage } from "@/common/components/ui/FieldError";

// Which field a server message is about, by its words (first match wins).
const SERVER_FIELDS: Record<string, RegExp> = {
  split: /breakdown|split|cheque|upi|cash/i, bank: /bank/i, date: /date/i, rate: /interest rate/i, amount: /amount/i,
};

type RepledgeModalContentProps = { loan: LoanView; onSaved: () => void };

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
export function RepledgeModalContent({ loan, onSaved }: RepledgeModalContentProps) {
  const { closeModal } = useModal();
  const toast = useToast();
  const smallScreen = useIsSmallScreen();
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
  // Validation messages, each shown under the field it is about; `err` keeps the ones that fit no field.
  const [fe, setFe] = useState<Record<string, string>>({});
  const fail = (field: string, msg: string) => { setErr(""); setFe({ [field]: msg }); };
  const clearFe = (field: string) => setFe((cur) => (cur[field] ? { ...cur, [field]: "" } : cur));
  const [saving, setSaving] = useState(false);

  /* Defaults to RecordOnly — the harmless choice. Staff must actively opt in to
   * moving money, rather than being blocked by a required field: leaving this
   * alone just files a paperwork record. Immutable once saved (a wrong pick is
   * fixed by voiding the record), so the consequence is spelled out below the
   * control rather than left to be discovered afterwards. */
  const [cashTreatment, setCashTreatment] = useState<BankPledgeCashTreatment>("RecordOnly");
  // How the bank's advance reached the branch — only asked for "CashIn".
  const [split, setSplit] = useState<SplitAmounts>(ZERO_SPLIT);
  const [remaining, setRemaining] = useState(0);
  const [receivedBankId, setReceivedBankId] = useState<number | undefined>(undefined);

  async function save() { return singleFlight("modal:repledge:save", async () => {
    setErr(""); setFe({});
    if (!bank.trim()) { fail("bank", "Please enter the bank to repledge with."); return; }
    if (!date) { fail("date", "Please select the pledge date."); return; }
    const amount = +amt;
    if (!amount || amount <= 0) { fail("amount", "Please enter the pledged amount."); return; }
    if (cashTreatment === "CashIn" && Math.abs(remaining) >= 0.01) { fail("split", "The payment breakdown must add up to the pledged amount."); return; }
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
        ...(cashTreatment === "CashIn" ? { ...split, receivedBankId } : {}),
      });
      onSaved();
      closeModal();
      toast(
        cashTreatment === "CashIn"
          ? `Gold repledged to ${bank.trim()} — ${fmt(amount)} added to Cash-in-Hand`
          : `Gold repledged to ${bank.trim()} — recorded only, no cash effect`
      );
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : "Could not record the pledge — try again.";
      const field = fieldForMessage(msg, SERVER_FIELDS);
      if (field) fail(field, msg); else { setFe({}); setErr(msg); }
    } finally {
      setSaving(false);
    }
  }); }

  return (
    <>
      <div className="hd"><h3>Repledge Gold to Bank — {loan.id}</h3><button className="x" onClick={closeModal}>×</button></div>
      <div className="bd bd-scroll repledge-modal-bd">
        {loan.ornaments.length > 0 && (
          <section className="rp-sec">
            <div className="rp-sec-h">
              <span>Gold being pledged</span>
              <span className="rp-sec-meta">{loan.ornaments.length} item{loan.ornaments.length > 1 ? "s" : ""} · {fmtW(loan.totalNetWeight)} net</span>
            </div>
            <div className="tbl-wrap rp-tbl"><table className="tbl tbl-tight">
              <thead><tr><th>#</th><th>Ornament</th><th>Purity</th><th className="num">Qty</th><th className="num">Net Wt</th><th className="num">Value</th></tr></thead>
              <tbody>
                {loan.ornaments.map((o, i) => (
                  <tr key={o.id ?? i}>
                    <td className="rp-idx">{i + 1}</td>
                    <td style={{ fontWeight: 500 }}>{o.name}</td>
                    <td><span className="chip brand">{o.purity}</span></td>
                    <td className="num">{o.quantity}</td>
                    <td className="num">{fmtW(o.netWeight)}</td>
                    <td className="num">{fmt(o.goldValue)}</td>
                  </tr>
                ))}
              </tbody>
              {loan.ornaments.length > 1 && (
                <tfoot><tr>
                  <td colSpan={4}>Total</td>
                  <td className="num">{fmtW(loan.totalNetWeight)}</td>
                  <td className="num">{fmt(loan.totalGoldValue)}</td>
                </tr></tfoot>
              )}
            </table></div>
          </section>
        )}

        <div className="rp-sec-h"><span>Bank pledge details</span></div>
        {/* Small screens pack all 6 fields into a tight 3-col x 2-row grid
         * (an explicit inline gridTemplateColumns, since `.frow.c3` collapses
         * to one column below the usual breakpoint — that collapse is right
         * for every other c3 usage, just not this compact small-screen
         * layout) to keep the modal short enough that its footer buttons
         * don't get pushed below the fold. Regular screens keep the
         * original, more spacious row grouping instead. */}
        {smallScreen ? (
          <>
            <div className="frow rp-grid rp-compact" style={{ gridTemplateColumns: "repeat(3, minmax(180px, 1fr))" }}>
              <div className={fe.bank ? "has-err" : undefined}><label className="f">Bank *</label>
                <SearchableSelect<BackendBank>
                  value={bankLabel}
                  onChange={(id, item) => { setBank(item.name); setBankLabel(item.name); setBankId(Number(id) || undefined); clearFe("bank"); }}
                  fetchFn={searchBanksPage}
                  searchHint="Searches: bank name"
                  getLabel={(b) => b.name}
                  getId={(b) => String(b.id)}
                  placeholder="Search for a registered bank…"
                /><FieldError msg={fe.bank} /></div>
              <div className={fe.amount ? "has-err" : undefined}><label className="f">Pledged Amount (₹) *</label><input className="inp" type="number" min={1} placeholder="amount raised from bank" value={amt} onChange={(e) => { setAmt(e.target.value); clearFe("amount"); }} /><FieldError msg={fe.amount} /></div>
              <div className={fe.date ? "has-err" : undefined}><label className="f">Pledge Date *</label><DatePicker value={date} onChange={(v) => { setDate(v); clearFe("date"); }} /><FieldError msg={fe.date} /></div>
              <div className={fe.rate ? "has-err" : undefined}><label className="f">Interest Rate (% p.a.)</label><input className="inp" type="number" min={0} step={0.01} placeholder="rate charged by the bank" value={interestRate} onChange={(e) => { setInterestRate(e.target.value); clearFe("rate"); }} /><FieldError msg={fe.rate} /></div>
              <div><label className="f">Reference Number</label><input className="inp" placeholder="bank's pledge/document reference" value={referenceNumber} onChange={(e) => setReferenceNumber(e.target.value)} maxLength={60} /></div>
              <div><label className="f">Bank Pledge Due Date</label><DatePicker value={dueDate} onChange={setDueDate} min={date} /></div>
            </div>
          </>
        ) : (
          <div className="frow c3 rp-grid">
            <div className={fe.bank ? "has-err" : undefined}><label className="f">Bank *</label>
              <SearchableSelect<BackendBank>
                value={bankLabel}
                onChange={(id, item) => { setBank(item.name); setBankLabel(item.name); setBankId(Number(id) || undefined); clearFe("bank"); }}
                fetchFn={searchBanksPage}
                searchHint="Searches: bank name"
                getLabel={(b) => b.name}
                getId={(b) => String(b.id)}
                placeholder="Search for a registered bank…"
              /><FieldError msg={fe.bank} /></div>
            <div className={fe.amount ? "has-err" : undefined}><label className="f">Pledged Amount (₹) *</label><input className="inp" type="number" min={1} placeholder="amount raised from bank" value={amt} onChange={(e) => { setAmt(e.target.value); clearFe("amount"); }} /><FieldError msg={fe.amount} /></div>
            <div className={fe.date ? "has-err" : undefined}><label className="f">Pledge Date *</label><DatePicker value={date} onChange={(v) => { setDate(v); clearFe("date"); }} /><FieldError msg={fe.date} /></div>
            <div className={fe.rate ? "has-err" : undefined}><label className="f">Interest Rate (% p.a.)</label><input className="inp" type="number" min={0} step={0.01} placeholder="rate charged by the bank" value={interestRate} onChange={(e) => { setInterestRate(e.target.value); clearFe("rate"); }} /><FieldError msg={fe.rate} /></div>
            <div><label className="f">Reference Number</label><input className="inp" placeholder="bank's pledge/document reference" value={referenceNumber} onChange={(e) => setReferenceNumber(e.target.value)} maxLength={60} /></div>
            <div><label className="f">Bank Pledge Due Date</label><DatePicker value={dueDate} onChange={setDueDate} min={date} /></div>
          </div>
        )}

        {/* Cash treatment. Not every re-pledge brings money into the branch
          * till — some are purely book-keeping — so this is an explicit choice
          * per transaction rather than an assumption. */}
        <div className="rp-sec-h rp-after-grid"><span>Cash treatment *</span></div>
        <div>
          <div className="rp-opts">
            <label className={"cradio rp-opt" + (cashTreatment === "RecordOnly" ? " on" : "")}>
              <input
                type="radio"
                name="cashTreatment"
                checked={cashTreatment === "RecordOnly"}
                onChange={() => setCashTreatment("RecordOnly")}
              />
              <span className="mark" />
              <span>
                <strong>Record only</strong>
                <span className="rp-opt-d">No cash effect.</span>
              </span>
            </label>
            <label className={"cradio rp-opt" + (cashTreatment === "CashIn" ? " on" : "")}>
              <input
                type="radio"
                name="cashTreatment"
                checked={cashTreatment === "CashIn"}
                onChange={() => setCashTreatment("CashIn")}
              />
              <span className="mark" />
              <span>
                <strong>Add to Cash-in-Hand</strong>
                <span className="rp-opt-d">Bank money added to branch cash.</span>
              </span>
            </label>
          </div>
        </div>

        {cashTreatment === "CashIn" && (
          <div className="frow" style={{ marginTop: 10 }}>
            <div className={fe.split ? "has-err" : undefined}>
              <SplitPaymentInput totalAmount={+amt || 0} onChange={(s, r, bid) => { setSplit(s); setRemaining(r); setReceivedBankId(bid); clearFe("split"); }} />
              <FieldError msg={fe.split} />
            </div>
          </div>
        )}

        <p style={{ color: "var(--red)", fontSize: 12.5, minHeight: 16, marginTop: 8 }}>{err}</p>
      </div>
      <div className="ft">
        <button className="btn ghost" onClick={closeModal}>Cancel</button>
        <button className="btn" onClick={save} disabled={saving}><Icon name="check" /> {saving ? "Saving…" : "Repledge to Bank"}</button>
      </div>
    </>
  );
}
