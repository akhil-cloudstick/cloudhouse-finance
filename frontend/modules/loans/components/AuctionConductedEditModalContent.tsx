"use client";

import { useEffect, useState } from "react";
import { useModal } from "@/common/components/ModalProvider";
import { useToast } from "@/common/components/ToastProvider";
import { Icon } from "@/common/components/Icon";
import { DatePicker } from "@/common/components/ui/DatePicker";
import { FieldError } from "@/common/components/ui/FieldError";
import { ShortfallDecisionPicker, applyShortfallChoice, hasDecidedShortfall, useCanDecideShortfall, type ShortfallChoice } from "@/modules/loans/components/ShortfallDecisionPicker";
import { SplitPaymentInput, type SplitAmounts, type SplitPaymentLine } from "@/common/components/SplitPaymentInput";
import { fmt } from "@/common/utils/format";
import { ApiError } from "@/common/services/httpClient";
import { singleFlight } from "@/common/utils/singleFlight";
import {
  editAuctionSale, editAuctionSurplus, editAuctionWriteOff, getAuctionSaleCurrent,
  type AppliedAuctionDependent, type AuctionDependent, type AuctionEditPreview, type AuctionSaleCurrent,
} from "@/modules/loans/services/loanService";
import { type ConcludedAuctionRowView } from "@/modules/loans/types/loan-types";
import { TableCols } from "@/common/components/ui/TableCols";

type Props = {
  auction: ConcludedAuctionRowView;
  loanId: number;
  minDate?: string; // the loan's start
  onSaved: () => void;
};

const dateOnly = (v?: string | null) => (v ? v.slice(0, 10) : "");
const sameSplit = (a: SplitAmounts, c: AuctionSaleCurrent) =>
  Math.abs(a.cashAmount - c.cashAmount) < 0.005 && Math.abs(a.upiAmount - c.upiAmount) < 0.005 && Math.abs(a.bankTransferAmount - c.bankTransferAmount) < 0.005;

// One editor for a concluded auction: the sale amount and expenses (with how the buyer paid), and — when the auction
// has one — the surplus settlement or the write-off date. Only what was changed is sent; the first click previews the
// effect on the loan, the second saves it.

export function AuctionConductedEditModalContent({ auction, loanId, minDate, onSaved }: Props) {
  const { closeModal } = useModal();
  const toast = useToast();
  const [cur, setCur] = useState<AuctionSaleCurrent | null>(null);
  const [loadErr, setLoadErr] = useState("");
  const [date, setDate] = useState("");
  const [saleAmount, setSaleAmount] = useState("");
  const [expenses, setExpenses] = useState("");
  const [split, setSplit] = useState<SplitAmounts>({ cashAmount: 0, upiAmount: 0, bankTransferAmount: 0, chequeAmount: 0 });
  const [remaining, setRemaining] = useState(0);
  const [bankId, setBankId] = useState<number | undefined>(undefined);
  // surplus settlement
  const hasSurplus = auction.surplusPayableAmount > 0 && !!auction.surplusDisposition;
  const [disposition, setDisposition] = useState<string>(auction.surplusDisposition || "RefundedToCustomer");
  const [refundDate, setRefundDate] = useState("");
  const [sSplit, setSSplit] = useState<SplitAmounts>({ cashAmount: auction.surplusPayableAmount, upiAmount: 0, bankTransferAmount: 0, chequeAmount: 0 });
  const [sRemaining, setSRemaining] = useState(0);
  const [sBank, setSBank] = useState<number | undefined>(undefined);
  const [surplusTouched, setSurplusTouched] = useState(false);
  // write-off
  const hasWriteOff = auction.finalSettlementStatus === "WrittenOff";
  const [woDate, setWoDate] = useState(dateOnly(auction.decisionRequests.find((d) => d.status === "WriteOff")?.decidedAt));
  const [woTouched, setWoTouched] = useState(false);

  const [preview, setPreview] = useState<AuctionEditPreview | null>(null);
  const [chosen, setChosen] = useState<Record<string, boolean>>({});
  // a sale edited into a shortfall: its decision can be made here
  const [shortfallChoice, setShortfallChoice] = useState<ShortfallChoice>({ decision: "", remarks: "" });
  const canDecideShortfall = useCanDecideShortfall();
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const c = await getAuctionSaleCurrent(loanId);
        if (!alive) return;
        setCur(c); setDate(dateOnly(c.saleDate)); setSaleAmount(String(c.saleAmount)); setExpenses(String(c.auctionExpenses || 0));
        setSplit({ cashAmount: c.cashAmount, upiAmount: c.upiAmount, bankTransferAmount: c.bankTransferAmount, chequeAmount: 0 });
        setBankId(c.bankId ?? undefined);
        setRefundDate(dateOnly(c.saleDate) || today);
      } catch (e) {
        if (alive) setLoadErr(e instanceof ApiError ? e.message : "Could not load this auction — try again.");
      }
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loanId]);

  const key = (d: AuctionDependent) => `${d.kind}:${d.id}`;
  const applied = (p: AuctionEditPreview): AppliedAuctionDependent[] =>
    p.dependents.filter((d) => chosen[key(d)]).map((d) => ({ kind: d.kind, id: d.id }));
  const touch = () => { setPreview(null); setErr(""); };

  const initialLines: SplitPaymentLine[] = cur ? ([
    cur.cashAmount > 0 && { mode: "Cash" as const, amount: String(cur.cashAmount) },
    cur.upiAmount > 0 && { mode: "UPI" as const, amount: String(cur.upiAmount), bankId: cur.bankId ?? undefined },
    cur.bankTransferAmount > 0 && { mode: "Bank Transfer" as const, amount: String(cur.bankTransferAmount), bankId: cur.bankId ?? undefined },
  ].filter(Boolean) as SplitPaymentLine[]) : [];

  const saleChanged = !!cur && (
    Math.abs(+saleAmount - cur.saleAmount) > 0.005 || Math.abs((+expenses || 0) - (cur.auctionExpenses || 0)) > 0.005 ||
    date !== dateOnly(cur.saleDate) || !sameSplit(split, cur) || (bankId ?? null) !== (cur.bankId ?? null)
  );

  async function saveSurplusAndWriteOff() {
    if (showSurplus && surplusTouched) {
      const refund = disposition === "RefundedToCustomer";
      const mode = sSplit.upiAmount > 0 ? "UPI" : sSplit.bankTransferAmount > 0 ? "Bank Transfer" : "Cash";
      await editAuctionSurplus(loanId, { disposition, ...(refund ? { mode, bankId: sBank, settledOn: refundDate || undefined } : {}) }, false);
    }
    if (hasWriteOff && woTouched) await editAuctionWriteOff(loanId, woDate, false);
  }

  // The surplus settlement only applies while the sale still leaves a surplus: worked out live from what is typed
  // (against what the loan owed at the sale), and from the preview once there is one.
  const owedAtSale = auction.saleAmount - (auction.auctionExpenses || 0) - auction.surplusShortfall;
  const surplusNow = preview?.outcome ? preview.outcome.surplus : (+saleAmount || 0) - (+expenses || 0) - owedAtSale;
  const showSurplus = hasSurplus && surplusNow > 0.005;
  const askShortfall = !!preview?.outcome && !preview.outcome.fullyCovered && preview.outcome.shortfall > 0.005 && !hasDecidedShortfall(auction);

  async function submit() {
    return singleFlight("modal:auction-conducted-edit", async () => {
      const dry = preview == null;
      setSaving(true);
      try {
        if (!saleChanged && !(showSurplus && surplusTouched) && !(hasWriteOff && woTouched)) { setErr("Nothing has been changed."); return; }
        const refund = disposition === "RefundedToCustomer";
        if (showSurplus && surplusTouched && refund) {
          if (Math.abs(sRemaining) > 0.01) { setErr("The refund must be paid out by one mode and add up to the surplus."); return; }
          if ((sSplit.upiAmount > 0 || sSplit.bankTransferAmount > 0) && !sBank) { setErr("Select the bank for the refund."); return; }
        }
        if (hasWriteOff && woTouched && !woDate) { setErr("Choose the write-off date."); return; }
        if (!dry && askShortfall && shortfallChoice.decision && !shortfallChoice.remarks.trim()) { setErr("Give a reason for the shortfall decision."); return; }
        let res: AuctionEditPreview;
        if (saleChanged) {
          const sale = +saleAmount;
          const exp = +expenses || 0;
          if (!(sale > 0)) { setErr("Enter a valid sale amount."); return; }
          if (exp < 0 || exp > sale) { setErr("Auction expenses cannot be negative or more than the sale amount."); return; }
          if (Math.abs(remaining) > 0.01) { setErr(`The payment breakdown must add up to the sale amount (${fmt(sale)}).`); return; }
          if ((split.upiAmount > 0 || split.bankTransferAmount > 0) && !bankId) { setErr("Select the bank for the UPI / Bank Transfer part."); return; }
          res = await editAuctionSale(loanId, {
            saleAmount: sale, auctionExpenses: exp, saleDate: date,
            cashAmount: split.cashAmount, upiAmount: split.upiAmount, bankTransferAmount: split.bankTransferAmount, bankId,
            applyDependents: dry ? [] : applied(preview!),
          }, dry);
          if (!dry) await saveSurplusAndWriteOff();
        } else if (showSurplus && surplusTouched) {
          res = await editAuctionSurplus(loanId, { disposition, ...(refund ? { mode: sSplit.upiAmount > 0 ? "UPI" : sSplit.bankTransferAmount > 0 ? "Bank Transfer" : "Cash", bankId: sBank, settledOn: refundDate || undefined } : {}) }, dry);
          if (!dry && hasWriteOff && woTouched) await editAuctionWriteOff(loanId, woDate, false);
        } else {
          res = await editAuctionWriteOff(loanId, woDate, dry);
        }
        if (dry) {
          setPreview(res); setErr("");
          setChosen(Object.fromEntries(res.dependents.map((d) => [key(d), true])));
          return;
        }
        // the shortfall decision chosen here is recorded once the sale is saved; if that fails the sale stays saved and
        // the decision can still be made from Auction Management
        let decisionNote = "";
        if (askShortfall && shortfallChoice.decision) {
          try {
            await applyShortfallChoice(loanId, shortfallChoice);
          } catch (e) {
            decisionNote = e instanceof ApiError ? e.message : "the shortfall decision could not be recorded";
          }
        }
        toast(decisionNote ? `Auction updated — but ${decisionNote}. Decide the shortfall from Auction Management.` : "Auction updated");
        onSaved();
        closeModal();
      } catch (e) {
        setErr(e instanceof ApiError ? e.message : "Could not save the change — try again.");
        setPreview(null);
      } finally {
        setSaving(false);
      }
    });
  }

  const row = (label: string, before: number, after: number) => (
    <tr>
      <td>{label}</td>
      <td className="num">{fmt(before)}</td>
      <td className="num" style={{ fontWeight: 600, color: Math.abs(after - before) > 0.005 ? "var(--brand)" : undefined }}>{fmt(after)}</td>
    </tr>
  );
  const o = preview?.outcome;

  return (
    <>
      <div className="hd"><h3>Edit Auction — {auction.loanNumber}</h3><button className="x" onClick={closeModal}>×</button></div>
      <div className="bd bd-scroll ledger-edit-bd">
        {loadErr && <FieldError msg={loadErr} />}
        {cur && (
          <>
            <div className="frow c2">
              <div><label className="f">Sale Date *</label><DatePicker value={date} min={minDate} max={today} onChange={(v) => { touch(); setDate(v); }} /></div>
              <div><label className="f">Sale Amount (₹) *</label><input className="inp" type="number" min={0} value={saleAmount} onChange={(e) => { touch(); setSaleAmount(e.target.value); }} /></div>
            </div>
            <div className="frow">
              <div><label className="f">Auction Expenses (₹)</label><input className="inp" type="number" min={0} value={expenses} onChange={(e) => { touch(); setExpenses(e.target.value); }} /></div>
            </div>
            <div style={{ marginTop: 18, paddingTop: 14, borderTop: "1px solid var(--line)" }}>
              <h4 style={{ margin: "0 0 10px", fontSize: 13 }}>Payment breakdown</h4>
              <SplitPaymentInput
                totalAmount={+saleAmount || 0} initialLines={initialLines} label={null}
                onChange={(s, r, b) => { touch(); setSplit(s); setRemaining(r); setBankId(b); }}
              />
            </div>
            {showSurplus && (
              <div style={{ marginTop: 18, paddingTop: 14, borderTop: "1px solid var(--line)" }}>
                <h4 style={{ margin: "0 0 10px", fontSize: 13 }}>Surplus settlement</h4>
                <div style={{ marginBottom: 12 }}>
                <label className="f">Surplus {fmt(auction.surplusPayableAmount)} *</label>
                <div style={{ display: "flex", gap: 28, marginTop: 6 }}>
                  <label className="cradio" style={{ fontSize: 13, alignItems: "center" }}>
                    <input type="radio" name="surplus-disposition" checked={disposition === "RefundedToCustomer"} onChange={() => { touch(); setSurplusTouched(true); setDisposition("RefundedToCustomer"); }} />
                    <span className="mark" style={{ marginTop: 0 }} />
                    <span><strong className="cradio-title">Refund to customer</strong></span>
                  </label>
                  <label className="cradio" style={{ fontSize: 13, alignItems: "center" }}>
                    <input type="radio" name="surplus-disposition" checked={disposition === "RecordedAsIncome"} onChange={() => { touch(); setSurplusTouched(true); setDisposition("RecordedAsIncome"); }} />
                    <span className="mark" style={{ marginTop: 0 }} />
                    <span><strong className="cradio-title">Record as company income</strong></span>
                  </label>
                </div>
              </div>
                {disposition === "RefundedToCustomer" && (
                  <>
                    <div className="frow c2">
                      <div><label className="f">Refund Date</label><DatePicker value={refundDate} min={minDate} max={today} onChange={(v) => { touch(); setSurplusTouched(true); setRefundDate(v); }} /></div>
                    </div>
                    <SplitPaymentInput
                      totalAmount={auction.surplusPayableAmount} initialLines={[{ mode: "Cash" as const, amount: String(auction.surplusPayableAmount) }]} label={null}
                      onChange={(s, r, b) => { setSSplit(s); setSRemaining(r); setSBank(b); if (surplusTouched) touch(); }}
                    />
                  </>
                )}
              </div>
            )}
            {hasWriteOff && (
              <div style={{ marginTop: 18, paddingTop: 14, borderTop: "1px solid var(--line)" }}>
                <h4 style={{ margin: "0 0 10px", fontSize: 13 }}>Write-off</h4>
                <div className="frow"><div><label className="f">Write-off Date *</label><DatePicker value={woDate} min={minDate} max={today} onChange={(v) => { touch(); setWoTouched(true); setWoDate(v); }} /></div></div>
              </div>
            )}
          </>
        )}
        {preview && (
          <div style={{ marginTop: 12 }}>
            {o && (
              <p style={{ marginBottom: 8 }}>
                Net <b>{fmt(o.netProceeds)}</b> vs <b>{fmt(o.totalDebt)}</b> owed: {o.fullyCovered
                  ? <>loan cleared{o.surplus > 0.005 ? <>, surplus <b>{fmt(o.surplus)}</b></> : null}.</>
                  : <>shortfall <b>{fmt(o.shortfall)}</b>.</>}
              </p>
            )}
            {[preview.before, preview.after].some((x) => x.principal || x.interest || x.penalInterest || x.total) || preview.before.status !== preview.after.status ? (<>
            <label className="f">What changes on the loan (as of its last entry)</label>
            <div className="tbl-wrap"><table className="tbl"><TableCols widths={[40, 30, 30]} />
              <thead><tr><th></th><th className="num">Before</th><th className="num">After</th></tr></thead>
              <tbody>
                {row("Principal owed", preview.before.principal, preview.after.principal)}
                {row("Interest owed", preview.before.interest, preview.after.interest)}
                {row("Penal interest owed", preview.before.penalInterest, preview.after.penalInterest)}
                {row("Total owed", preview.before.total, preview.after.total)}
                <tr><td>Status</td><td className="num">{preview.before.status}</td><td className="num">{preview.after.status}</td></tr>
              </tbody>
            </table></div>
            </>) : null}
            {preview.dependents.length > 0 && (
              <div style={{ marginTop: 14 }}>
                <label className="f">This also affects entries booked from the auction</label>
                {preview.dependents.map((d) => (
                  <label key={key(d)} className="ccheck" style={{ margin: "6px 0" }}>
                    <input type="checkbox" checked={!!chosen[key(d)]} onChange={(e) => setChosen((c) => ({ ...c, [key(d)]: e.target.checked }))} />
                    <span className="mark" />
                    <span>
                      <b>Also update this:</b> {d.description}
                      <div style={{ fontSize: "0.85em", color: "var(--muted)" }}>{d.current} → {d.suggested}{d.required ? " (required to keep the books consistent)" : ""}</div>
                    </span>
                  </label>
                ))}
              </div>
            )}
          </div>
        )}
        {askShortfall && preview?.outcome && (
          <ShortfallDecisionPicker shortfall={preview.outcome.shortfall} value={shortfallChoice} onChange={setShortfallChoice} canDecide={canDecideShortfall} />
        )}
        <FieldError msg={err} />
      </div>
      <div className="ft">
        <button className="btn ghost" onClick={closeModal} disabled={saving}>Cancel</button>
        <button className="btn" onClick={submit} disabled={saving || !cur || !!loadErr}>
          <Icon name="check" /> {saving ? "Working…" : preview ? "Confirm" : "Preview the change"}
        </button>
      </div>
    </>
  );
}
