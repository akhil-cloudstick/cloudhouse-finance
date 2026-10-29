"use client";

import { useEffect, useState } from "react";
import { useModal } from "@/common/components/ModalProvider";
import { useToast } from "@/common/components/ToastProvider";
import { Icon } from "@/common/components/Icon";
import { DatePicker } from "@/common/components/ui/DatePicker";
import { FieldError } from "@/common/components/ui/FieldError";
import { SplitPaymentInput, type SplitAmounts, type SplitPaymentLine } from "@/common/components/SplitPaymentInput";
import { fmt } from "@/common/utils/format";
import { ApiError } from "@/common/services/httpClient";
import { singleFlight } from "@/common/utils/singleFlight";
import {
  deleteAuctionSale, deleteAuctionSurplus, deleteAuctionWriteOff, editAuctionSale, editAuctionSurplus, editAuctionWriteOff,
  getAuctionHistory, getAuctionSaleCurrent,
  type AppliedAuctionDependent, type AuctionDependent, type AuctionEditPreview, type AuctionSaleCurrent,
} from "@/modules/loans/services/loanService";
import { type AuctionRecordView } from "@/modules/loans/types/loan-types";

export type AuctionEditKind = "sale" | "surplus" | "write-off";

type Props = {
  loanId: number;
  kind: AuctionEditKind;
  mode: "edit" | "delete";
  minDate?: string; // the loan's start
  onSaved: () => void;
};

const TITLES: Record<AuctionEditKind, string> = { sale: "Auction Sale", surplus: "Auction Surplus Settlement", "write-off": "Auction Write-Off" };

const dateOnly = (v?: string | null) => (v ? v.slice(0, 10) : "");

// Two steps, like a top-up edit: the first click previews what the change does (nothing is saved) and lists the
// entries the auction booked because of the sale — a settled surplus, a shortfall decision, a write-off — each with
// an "Also update this" box; the second click saves the change and updates the ticked ones.

export function AuctionEditModalContent({ loanId, kind, mode, minDate, onSaved }: Props) {
  const { closeModal } = useModal();
  const toast = useToast();
  const [cur, setCur] = useState<AuctionSaleCurrent | null>(null);
  const [record, setRecord] = useState<AuctionRecordView | null>(null);
  const [loadErr, setLoadErr] = useState("");
  const [date, setDate] = useState("");
  const [saleAmount, setSaleAmount] = useState("");
  const [expenses, setExpenses] = useState("");
  const [split, setSplit] = useState<SplitAmounts>({ cashAmount: 0, upiAmount: 0, bankTransferAmount: 0, chequeAmount: 0 });
  const [remaining, setRemaining] = useState(0);
  const [bankId, setBankId] = useState<number | undefined>(undefined);
  const [disposition, setDisposition] = useState("RefundedToCustomer");
  const [preview, setPreview] = useState<AuctionEditPreview | null>(null);
  const [chosen, setChosen] = useState<Record<string, boolean>>({});
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        if (kind === "sale") {
          const c = await getAuctionSaleCurrent(loanId);
          if (!alive) return;
          setCur(c); setDate(dateOnly(c.saleDate)); setSaleAmount(String(c.saleAmount)); setExpenses(String(c.auctionExpenses || 0));
          setSplit({ cashAmount: c.cashAmount, upiAmount: c.upiAmount, bankTransferAmount: c.bankTransferAmount, chequeAmount: 0 });
          setBankId(c.bankId ?? undefined);
        } else {
          const hist = await getAuctionHistory(loanId);
          const rec = hist.find((r) => r.saleAmount > 0) ?? null;
          if (!alive) return;
          setRecord(rec);
          if (rec?.surplusDisposition) setDisposition(rec.surplusDisposition);
          const wo = rec?.decisionRequests.find((d) => d.status === "WriteOff");
          setDate(dateOnly(wo?.decidedAt) || today);
        }
      } catch (e) {
        if (alive) setLoadErr(e instanceof ApiError ? e.message : "Could not load this auction entry — try again.");
      }
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loanId, kind]);

  const key = (d: AuctionDependent) => `${d.kind}:${d.id}`;
  const applied = (p: AuctionEditPreview): AppliedAuctionDependent[] =>
    p.dependents.filter((d) => chosen[key(d)]).map((d) => ({ kind: d.kind, id: d.id }));

  function changed<T>(set: (v: T) => void) {
    return (v: T) => { setPreview(null); setErr(""); set(v); };
  }

  const initialLines: SplitPaymentLine[] = cur ? ([
    cur.cashAmount > 0 && { mode: "Cash" as const, amount: String(cur.cashAmount) },
    cur.upiAmount > 0 && { mode: "UPI" as const, amount: String(cur.upiAmount), bankId: cur.bankId ?? undefined },
    cur.bankTransferAmount > 0 && { mode: "Bank Transfer" as const, amount: String(cur.bankTransferAmount), bankId: cur.bankId ?? undefined },
  ].filter(Boolean) as SplitPaymentLine[]) : [];

  // the surplus refund goes out by one mode
  function surplusMode(): string | undefined {
    if (split.upiAmount > 0) return "UPI";
    if (split.bankTransferAmount > 0) return "Bank Transfer";
    return "Cash";
  }

  async function submit() {
    return singleFlight("modal:auction-edit", async () => {
      const dry = preview == null;
      setSaving(true);
      try {
        let res: AuctionEditPreview;
        if (kind === "sale") {
          if (mode === "delete") {
            res = await deleteAuctionSale(loanId, dry ? [] : applied(preview!), dry);
          } else {
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
          }
        } else if (kind === "surplus") {
          if (mode === "delete") {
            res = await deleteAuctionSurplus(loanId, dry);
          } else {
            const refund = disposition === "RefundedToCustomer";
            if (refund && Math.abs(remaining) > 0.01) { setErr("The refund must be paid out by one mode and add up to the surplus."); return; }
            if (refund && (split.upiAmount > 0 || split.bankTransferAmount > 0) && !bankId) { setErr("Select the bank for the refund."); return; }
            res = await editAuctionSurplus(loanId, { disposition, ...(refund ? { mode: surplusMode(), bankId, settledOn: date || undefined } : {}) }, dry);
          }
        } else if (mode === "delete") {
          res = await deleteAuctionWriteOff(loanId, dry ? [] : applied(preview!), dry);
        } else {
          if (!date) { setErr("Choose the write-off date."); return; }
          res = await editAuctionWriteOff(loanId, date, dry);
        }
        if (dry) {
          setPreview(res); setErr("");
          // every dependent starts ticked: leaving a required one out is refused when saving
          setChosen(Object.fromEntries(res.dependents.map((d) => [key(d), true])));
          return;
        }
        toast(mode === "delete" ? `${TITLES[kind]} deleted` : `${TITLES[kind]} updated and the loan recalculated`);
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

  const surplusAmount = record?.surplusPayableAmount ?? 0;
  const ready = kind === "sale" ? !!cur || mode === "delete" : !!record || kind === "write-off";
  const o = preview?.outcome;

  return (
    <>
      <div className="hd"><h3>{mode === "delete" ? "Delete" : "Edit"} {TITLES[kind]}</h3><button className="x" onClick={closeModal}>×</button></div>
      <div className="bd bd-scroll ledger-edit-bd">
        {loadErr && <FieldError msg={loadErr} />}
        <p className="notice" style={{ marginBottom: 12 }}>
          {kind === "sale"
            ? "The loan is recalculated up to the sale, so what the sale clears, the surplus or shortfall, the loan's status and the cash ledger update to match. Entries booked because of the sale are listed for you to update too."
            : kind === "surplus"
              ? "The surplus settlement's cash entry is rewritten to match."
              : "The shortfall written off is recalculated for its date."}
        </p>
        {mode === "edit" && ready && kind === "sale" && (
          <>
            <div className="frow c2">
              <div><label className="f">Sale Date *</label><DatePicker value={date} min={minDate} max={today} onChange={changed(setDate)} /></div>
              <div><label className="f">Sale Amount (₹) *</label><input className="inp" type="number" min={0} value={saleAmount} onChange={(e) => changed(setSaleAmount)(e.target.value)} /></div>
            </div>
            <div className="frow">
              <div><label className="f">Auction Expenses (₹)</label><input className="inp" type="number" min={0} value={expenses} onChange={(e) => changed(setExpenses)(e.target.value)} /></div>
            </div>
            <div style={{ marginTop: 18, paddingTop: 14, borderTop: "1px solid var(--line)" }}>
              <h4 style={{ margin: "0 0 10px", fontSize: 13 }}>Payment breakdown</h4>
              <SplitPaymentInput
                totalAmount={+saleAmount || 0} initialLines={initialLines} label={null}
                onChange={(s, r, b) => { setPreview(null); setErr(""); setSplit(s); setRemaining(r); setBankId(b); }}
              />
            </div>
          </>
        )}
        {mode === "edit" && kind === "surplus" && record && (
          <>
            <div style={{ marginBottom: 12 }}>
                <label className="f">Surplus {fmt(surplusAmount)} *</label>
                <div style={{ display: "flex", gap: 28, marginTop: 6 }}>
                  <label className="cradio" style={{ fontSize: 13, alignItems: "center" }}>
                    <input type="radio" name="surplus-disposition" checked={disposition === "RefundedToCustomer"} onChange={() => changed(setDisposition)("RefundedToCustomer")} />
                    <span className="mark" style={{ marginTop: 0 }} />
                    <span><strong className="cradio-title">Refund to customer</strong></span>
                  </label>
                  <label className="cradio" style={{ fontSize: 13, alignItems: "center" }}>
                    <input type="radio" name="surplus-disposition" checked={disposition === "RecordedAsIncome"} onChange={() => changed(setDisposition)("RecordedAsIncome")} />
                    <span className="mark" style={{ marginTop: 0 }} />
                    <span><strong className="cradio-title">Record as company income</strong></span>
                  </label>
                </div>
              </div>
            {disposition === "RefundedToCustomer" && (
              <>
                <div className="frow c2">
                  <div><label className="f">Refund Date</label><DatePicker value={date} min={minDate} max={today} onChange={changed(setDate)} /></div>
                </div>
                <SplitPaymentInput
                  totalAmount={surplusAmount} initialLines={[{ mode: "Cash" as const, amount: String(surplusAmount) }]} label={null}
                  onChange={(s, r, b) => { setPreview(null); setErr(""); setSplit(s); setRemaining(r); setBankId(b); }}
                />
              </>
            )}
          </>
        )}
        {mode === "edit" && kind === "write-off" && (
          <div className="frow"><div><label className="f">Write-off Date *</label><DatePicker value={date} min={minDate} max={today} onChange={changed(setDate)} /></div></div>
        )}
        {mode === "delete" && (
          <p style={{ marginBottom: 12 }}>
            {kind === "sale"
              ? "Delete this auction sale? Its cash entries and expense entry are removed and the auction goes back to the scheduled stage."
              : kind === "surplus"
                ? "Delete this surplus settlement? The refund's cash entry is removed and the surplus is payable again."
                : "Delete this write-off? The shortfall decision goes back to pending and the loan to Auctioned - Balance Due."}
          </p>
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
            <div className="tbl-wrap"><table className="tbl">
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
        <FieldError msg={err} />
      </div>
      <div className="ft">
        <button className="btn ghost" onClick={closeModal} disabled={saving}>Cancel</button>
        <button className="btn" onClick={submit} disabled={saving || !ready || !!loadErr}>
          <Icon name={mode === "delete" ? "trash" : "check"} /> {saving ? "Working…" : preview ? (mode === "delete" ? "Confirm delete" : "Confirm") : "Preview the change"}
        </button>
      </div>
    </>
  );
}
