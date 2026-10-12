"use client";

import { useEffect, useMemo, useState } from "react";
import { useModal } from "@/common/components/ModalProvider";
import { useToast } from "@/common/components/ToastProvider";
import { ApiError } from "@/common/services/httpClient";
import { fmt, fmtDate } from "@/common/utils/format";
import { SplitPaymentInput, ZERO_SPLIT, type SplitAmounts } from "@/common/components/SplitPaymentInput";
import { getPendingInterest, payInterestMonths } from "@/modules/investments/services/investmentService";
import { type BackendInvestmentPayout } from "@/modules/investments/types/investment-types";
import { singleFlight } from "@/common/utils/singleFlight";

type PayInterestModalContentProps = { investmentId: number; investmentNumber: string; onSaved: () => void };

/* Pays several months of interest in one go. Staff enter the amount and how it is paid; the amount is applied to
 * the oldest unpaid months in order, each month in full, so it has to be a whole number of months. The list
 * below shows which months the amount covers as it is typed. */
export function PayInterestModalContent({ investmentId, investmentNumber, onSaved }: PayInterestModalContentProps) {
  const { closeModal } = useModal();
  const toast = useToast();
  const [months, setMonths] = useState<BackendInvestmentPayout[]>([]);
  const [loading, setLoading] = useState(true);
  const [amount, setAmount] = useState("");
  const [split, setSplit] = useState<SplitAmounts>(ZERO_SPLIT);
  const [remaining, setRemaining] = useState(0);
  const [bankId, setBankId] = useState<number | undefined>(undefined);
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    getPendingInterest(investmentId)
      .then((list) => { setMonths(list); if (list.length) setAmount(String(list[0].amount)); })
      .catch((e) => setErr(e instanceof ApiError ? e.message : "Could not load the unpaid interest."))
      .finally(() => setLoading(false));
  }, [investmentId]);

  const amt = +amount || 0;
  // How many whole months the typed amount covers (a part-month is not allowed).
  const cover = useMemo(() => {
    let sum = 0;
    let n = 0;
    for (const m of months) {
      if (sum + m.amount > amt + 0.01) break;
      sum = Math.round((sum + m.amount) * 100) / 100;
      n++;
    }
    return { n, sum, next: months[n] ? Math.round((sum + months[n].amount) * 100) / 100 : null };
  }, [months, amt]);
  const exact = amt > 0 && cover.n > 0 && Math.abs(cover.sum - amt) < 0.01;
  const total = Math.round(months.reduce((s, m) => s + m.amount, 0) * 100) / 100;
  const balanced = Math.abs(remaining) < 0.01;
  const bankMissing = split.upiAmount + split.bankTransferAmount > 0 && !bankId;

  let hint = "";
  if (amt > 0 && !exact) {
    hint = cover.n === 0
      ? `Less than the next month's interest of ${fmt(months[0]?.amount ?? 0)}`
      : `Not whole months — ${fmt(cover.sum)} covers ${cover.n}${cover.next ? `, ${fmt(cover.next)} covers ${cover.n + 1}` : ""}`;
  } else if (bankMissing) {
    hint = "Select a bank";
  } else if (!balanced && amt > 0) {
    hint = `Payment breakdown is ${fmt(Math.abs(remaining))} ${remaining > 0 ? "short of" : "over"} the amount`;
  }

  async function save() { return singleFlight("modal:payinterest:save", async () => {
    setSaving(true);
    setErr("");
    try {
      const paid = await payInterestMonths(investmentId, {
        amount: amt,
        cashAmount: split.cashAmount,
        upiAmount: split.upiAmount,
        bankTransferAmount: split.bankTransferAmount,
        chequeAmount: split.chequeAmount,
        bankId,
      });
      toast(`${paid.length} month${paid.length === 1 ? "" : "s"} of interest paid — ${fmt(amt)}`);
      onSaved();
      closeModal();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Could not record the interest payment — try again.");
    } finally {
      setSaving(false);
    }
  }); }

  return (
    <>
      <div className="hd"><h3>Pay Interest — {investmentNumber}</h3><button className="x" onClick={closeModal}>×</button></div>
      <div className="bd bd-scroll">
        {loading ? (
          <div className="notice">Loading…</div>
        ) : months.length === 0 ? (
          <div className="notice">There is no unpaid interest on this investment.</div>
        ) : (
          <>
            <div className="notice" style={{ marginBottom: 14 }}>
              {months.length} unpaid month{months.length === 1 ? "" : "s"} · <strong>{fmt(total)}</strong> in all
            </div>
            <div className="frow"><div>
              <label className="f">Amount (₹) *</label>
              <input className="inp" type="number" min={0} step={0.01} value={amount} onChange={(e) => setAmount(e.target.value)} />
            </div></div>
            <div style={{ fontSize: 12.5, margin: "6px 0 10px", color: exact ? "var(--green)" : "var(--muted)" }}>
              {amt > 0 && cover.n > 0
                ? `Covers ${cover.n} month${cover.n === 1 ? "" : "s"}: #${months[0].sequenceNo}${cover.n > 1 ? `–#${months[cover.n - 1].sequenceNo}` : ""} (due ${fmtDate(months[0].dueDate)}${cover.n > 1 ? ` to ${fmtDate(months[cover.n - 1].dueDate)}` : ""})`
                : "Enter the amount to see the months it covers"}
            </div>
            <div className="frow">
              <SplitPaymentInput totalAmount={amt} onChange={(s, r, bid) => { setSplit(s); setRemaining(r); setBankId(bid); }} />
            </div>
            <div style={{ marginTop: 10, maxHeight: 150, overflowY: "auto", overflowX: "hidden" }}>
              <table className="tbl tbl-center" style={{ width: "100%", minWidth: 0 }}>
                <thead><tr><th>#</th><th>Due</th><th className="num">Interest</th><th></th></tr></thead>
                <tbody>
                  {months.map((m, i) => (
                    <tr key={m.id}>
                      <td>{m.sequenceNo}</td>
                      <td>{fmtDate(m.dueDate)}</td>
                      <td className="num">{fmt(m.amount)}</td>
                      <td style={{ color: "var(--green)" }}>{i < cover.n && amt > 0 ? "✓" : ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
        {err && <div className="notice" style={{ marginTop: 10 }}>{err}</div>}
      </div>
      <div className="ft">
        <span className="pay-ft-msg">{hint}</span>
        <button className="btn ghost" onClick={closeModal}>Cancel</button>
        <button className="btn" disabled={saving || loading || months.length === 0 || !exact || !balanced || bankMissing} onClick={save}>
          {saving ? "Recording…" : `Pay ${amt > 0 ? fmt(amt) : "Interest"}`}
        </button>
      </div>
    </>
  );
}
