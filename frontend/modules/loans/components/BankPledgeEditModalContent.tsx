"use client";

import { useState } from "react";
import { useModal } from "@/common/components/ModalProvider";
import { useToast } from "@/common/components/ToastProvider";
import { Icon } from "@/common/components/Icon";
import { DatePicker } from "@/common/components/ui/DatePicker";
import { FieldError } from "@/common/components/ui/FieldError";
import { SearchableSelect } from "@/common/components/ui/SearchableSelect";
import { SplitPaymentInput, ZERO_SPLIT, type SplitAmounts, type SplitPaymentLine } from "@/common/components/SplitPaymentInput";
import { fmt } from "@/common/utils/format";
import { ApiError } from "@/common/services/httpClient";
import { singleFlight } from "@/common/utils/singleFlight";
import { editBankPledge, deleteBankPledge, type BankPledgeEditPreview } from "@/modules/loans/services/loanService";
import { type BankPledgeCashTreatment } from "@/modules/loans/types/loan-types";
import { searchBanksPage } from "@/modules/banks/services/bankService";
import { type BackendBank } from "@/modules/banks/types/bank-types";
import { TableCols } from "@/common/components/ui/TableCols";

// The fields of a pledge record the editor needs (a loan's pledge row and a history row both carry them).
export type EditablePledge = {
  id: number;
  bankId?: number | null;
  bankName: string;
  pledgedAmount: number;
  pledgeDate: string;
  releaseDate: string | null;
  bankPledgeDueDate: string | null;
  bankInterestRate: number;
  referenceNumber: string;
  cashTreatment: BankPledgeCashTreatment;
  status: "Active" | "Released" | "Voided";
  cashAmount?: number;
  upiAmount?: number;
  bankTransferAmount?: number;
  receivedBankId?: number | null;
  releaseCashAmount?: number;
  releaseUpiAmount?: number;
  releaseBankTransferAmount?: number;
  releaseBankId?: number | null;
};

type Props = {
  loanId: number;
  pledge: EditablePledge;
  mode: "edit" | "delete";
  onSaved: () => void;
};

function splitLines(cash = 0, upi = 0, bt = 0, bankId?: number | null): SplitPaymentLine[] {
  return [
    cash > 0 && { mode: "Cash" as const, amount: String(cash) },
    upi > 0 && { mode: "UPI" as const, amount: String(upi), bankId: bankId ?? undefined },
    bt > 0 && { mode: "Bank Transfer" as const, amount: String(bt), bankId: bankId ?? undefined },
  ].filter(Boolean) as SplitPaymentLine[];
}

// Two steps, like the top-up editor: the first click previews (nothing is saved), the second click saves. Saving
// rewrites the pledge's cash lines and, for a released pledge, the release cash lines and its expense entry.
export function BankPledgeEditModalContent({ loanId, pledge: p, mode, onSaved }: Props) {
  const { closeModal, closeAllModals, openChildModal } = useModal();
  const toast = useToast();
  const released = p.status === "Released";
  const [bank, setBank] = useState(p.bankName);
  const [bankId, setBankId] = useState<number | undefined>(p.bankId ?? undefined);
  const [amount, setAmount] = useState(String(p.pledgedAmount));
  const [date, setDate] = useState(p.pledgeDate.slice(0, 10));
  const [dueDate, setDueDate] = useState(p.bankPledgeDueDate?.slice(0, 10) ?? "");
  const [rate, setRate] = useState(String(p.bankInterestRate ?? 0));
  const [reference, setReference] = useState(p.referenceNumber || "");
  const [treatment, setTreatment] = useState<BankPledgeCashTreatment>(p.cashTreatment);
  const [split, setSplit] = useState<SplitAmounts>({ cashAmount: p.cashAmount ?? 0, upiAmount: p.upiAmount ?? 0, bankTransferAmount: p.bankTransferAmount ?? 0, chequeAmount: 0 });
  const [remaining, setRemaining] = useState(0);
  const [receivedBankId, setReceivedBankId] = useState<number | undefined>(p.receivedBankId ?? undefined);
  const [releaseDate, setReleaseDate] = useState(p.releaseDate?.slice(0, 10) ?? "");
  const [relSplit, setRelSplit] = useState<SplitAmounts>({ cashAmount: p.releaseCashAmount ?? 0, upiAmount: p.releaseUpiAmount ?? 0, bankTransferAmount: p.releaseBankTransferAmount ?? 0, chequeAmount: 0 });
  const [relRemaining, setRelRemaining] = useState(0);
  const [relBankId, setRelBankId] = useState<number | undefined>(p.releaseBankId ?? undefined);
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);
  const today = new Date().toISOString().slice(0, 10);
  void ZERO_SPLIT;

  const changed = (set: (v: string) => void) => (v: string) => { setErr(""); set(v); };

  // Builds and sends the request; dry only previews. Returns null (with err set) when the form is not valid yet.
  async function request(dry: boolean): Promise<BankPledgeEditPreview | null> {
    if (mode === "delete") return deleteBankPledge(loanId, p.id, dry);
    const amt = +amount;
    if (!bank.trim()) { setErr("Select the bank."); return null; }
    if (!(amt > 0)) { setErr("Enter a valid amount."); return null; }
    if (treatment === "CashIn") {
      if (Math.abs(remaining) > 0.01) { setErr(`The payment breakdown must add up to the amount (${fmt(amt)}).`); return null; }
      if ((split.upiAmount > 0 || split.bankTransferAmount > 0) && !receivedBankId) { setErr("Select the bank the UPI / Bank Transfer part was received in."); return null; }
      if (released) {
        if (Math.abs(relRemaining) > 0.01) { setErr(`The release payment breakdown must add up to the amount (${fmt(amt)}).`); return null; }
        if ((relSplit.upiAmount > 0 || relSplit.bankTransferAmount > 0) && !relBankId) { setErr("Select the bank the release UPI / Bank Transfer part was paid from."); return null; }
      }
    }
    return editBankPledge(loanId, p.id, {
      bankId, bankName: bank.trim(), pledgedAmount: amt, pledgeDate: date, bankPledgeDueDate: dueDate, bankInterestRate: +rate || 0,
      referenceNumber: reference, cashTreatment: treatment,
      ...(treatment === "CashIn" ? { cashAmount: split.cashAmount, upiAmount: split.upiAmount, bankTransferAmount: split.bankTransferAmount, receivedBankId } : {}),
      ...(released ? { releaseDate } : {}),
      ...(released && treatment === "CashIn" ? { releaseCashAmount: relSplit.cashAmount, releaseUpiAmount: relSplit.upiAmount, releaseBankTransferAmount: relSplit.bankTransferAmount, releaseBankId: relBankId } : {}),
    }, dry);
  }

  // The preview opens as its own modal over this one; its Confirm does the real save.
  async function openPreview() {
    return singleFlight("modal:bank-pledge-edit", async () => {
      setSaving(true);
      try {
        const res = await request(true);
        if (!res) return;
        setErr("");
        openChildModal(
          <BankPledgePreviewModalContent
            mode={mode}
            preview={res}
            onConfirm={async () => {
              await request(false);
              toast(mode === "delete" ? "Bank pledge deleted" : "Bank pledge updated");
              onSaved();
              closeAllModals();
            }}
          />,
        );
      } catch (e) {
        setErr(e instanceof ApiError ? e.message : "Could not preview the change — try again.");
      } finally {
        setSaving(false);
      }
    });
  }

  return (
    <>
      <div className="hd"><h3>{mode === "delete" ? "Delete" : "Edit"} Bank Pledge</h3><button className="x" onClick={closeModal}>×</button></div>
      <div className="bd bd-scroll ledger-edit-bd bank-pledge-edit">
        {mode === "edit" ? (
          <>
            <div className="frow c2">
              <div><label className="f">Bank *</label>
                <SearchableSelect<BackendBank>
                  value={bank}
                  onChange={(id, item) => { setErr(""); setBank(item.name); setBankId(Number(id) || undefined); }}
                  fetchFn={searchBanksPage}
                  searchHint="Searches: bank name"
                  getLabel={(x) => x.name}
                  getId={(x) => String(x.id)}
                  placeholder="Search for a registered bank…"
                /></div>
              <div><label className="f">Pledged Amount (₹) *</label><input className="inp" type="number" min={1} value={amount} onChange={(e) => changed(setAmount)(e.target.value)} /></div>
            </div>
            <div className="frow c2">
              <div><label className="f">Pledge Date *</label><DatePicker value={date} max={today} onChange={changed(setDate)} /></div>
              <div><label className="f">Bank Pledge Due Date</label><DatePicker value={dueDate} min={date} onChange={changed(setDueDate)} /></div>
            </div>
            <div className="frow c2">
              <div><label className="f">Interest Rate (% p.a.)</label><input className="inp" type="number" min={0} step={0.01} value={rate} onChange={(e) => changed(setRate)(e.target.value)} /></div>
              <div><label className="f">Reference Number</label><input className="inp" maxLength={60} value={reference} onChange={(e) => changed(setReference)(e.target.value)} /></div>
            </div>
            <h4 style={{ margin: "14px 0 6px", fontSize: 13 }}>Cash treatment</h4>
            {/* the same selectable cards the New Re-Pledge form uses (their styles hang off .repledge-modal-bd) */}
            <div className="repledge-modal-bd" style={{ padding: 0 }}>
              <div className="rp-opts">
                {(["RecordOnly", "CashIn"] as const).map((t) => (
                  <label key={t} className={"cradio rp-opt" + (treatment === t ? " on" : "")}>
                    <input type="radio" name="bpTreatment" checked={treatment === t} onChange={() => { setErr(""); setTreatment(t); }} />
                    <span className="mark" />
                    <span>
                      <strong>{t === "CashIn" ? "Add to Cash-in-Hand" : "Record only"}</strong>
                      <span className="rp-opt-d">{t === "CashIn" ? "Bank money added to branch cash." : "No cash effect."}</span>
                    </span>
                  </label>
                ))}
              </div>
            </div>
            {treatment === "CashIn" && (
              <>
                <h4 style={{ margin: "14px 0 6px", fontSize: 13 }}>How the advance was received</h4>
                <SplitPaymentInput
                  totalAmount={+amount || 0} initialLines={splitLines(p.cashAmount, p.upiAmount, p.bankTransferAmount, p.receivedBankId)} label={null}
                  onChange={(s, r, bid) => { setErr(""); setSplit(s); setRemaining(r); setReceivedBankId(bid); }}
                />
              </>
            )}
            {released && (
              <>
                <h4 style={{ margin: "18px 0 6px", fontSize: 13 }}>Release</h4>
                <div className="frow">
                  <div><label className="f">Release Date *</label><DatePicker value={releaseDate} min={date} max={today} onChange={changed(setReleaseDate)} /></div>
                </div>
                {treatment === "CashIn" && (
                  <>
                    <h4 style={{ margin: "14px 0 6px", fontSize: 13 }}>How the bank was repaid</h4>
                    <SplitPaymentInput
                      totalAmount={+amount || 0}
                      initialLines={p.cashTreatment === "CashIn" && ((p.releaseCashAmount ?? 0) + (p.releaseUpiAmount ?? 0) + (p.releaseBankTransferAmount ?? 0) > 0)
                        ? splitLines(p.releaseCashAmount, p.releaseUpiAmount, p.releaseBankTransferAmount, p.releaseBankId) : undefined}
                      label={null}
                      onChange={(s, r, bid) => { setErr(""); setRelSplit(s); setRelRemaining(r); setRelBankId(bid); }}
                    />
                  </>
                )}
              </>
            )}
          </>
        ) : (
          <p style={{ marginBottom: 12 }}>
            Delete the <b>{fmt(p.pledgedAmount)}</b> pledge to <b>{p.bankName}</b> ({p.pledgeDate.slice(0, 10)})?
          </p>
        )}
        <FieldError msg={err} />
      </div>
      <div className="ft">
        <button className="btn" onClick={openPreview} disabled={saving}>
          <Icon name={mode === "delete" ? "trash" : "check"} /> {saving ? "Working…" : "Preview the change"}
        </button>
      </div>
    </>
  );
}

function BankPledgePreviewModalContent({ mode, preview, onConfirm }: { mode: "edit" | "delete"; preview: BankPledgeEditPreview; onConfirm: () => Promise<void> }) {
  const { closeModal } = useModal();
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);
  const b = preview.before;
  const a = preview.after;
  const treatmentLabel = (t?: string) => (t === "CashIn" ? "Added to Cash-in-Hand" : "Record only");
  // Long values (e.g. "Added to Cash-in-Hand") wrap inside their own column instead of running into the next one.
  const wrapCell = { whiteSpace: "normal", overflowWrap: "anywhere", textOverflow: "clip" } as const;
  const row = (label: string, before: React.ReactNode, after: React.ReactNode) => (
    <tr><td>{label}</td><td className="num" style={wrapCell}>{before}</td><td className="num" style={{ ...wrapCell, fontWeight: 600, color: String(before) !== String(after) ? "var(--brand)" : undefined }}>{after}</td></tr>
  );

  async function confirm() {
    return singleFlight("modal:bank-pledge-confirm", async () => {
      setSaving(true);
      try {
        await onConfirm();
      } catch (e) {
        setErr(e instanceof ApiError ? e.message : "Could not save the change — try again.");
        setSaving(false);
      }
    });
  }

  return (
    <>
      <div className="hd"><h3>{mode === "delete" ? "Delete" : "Edit"} Bank Pledge</h3><button className="x" onClick={closeModal}>×</button></div>
      <div className="bd bd-scroll ledger-edit-bd">
        <label className="f">{mode === "delete" ? "This record will be removed" : "What changes"}</label>
        <div className="tbl-wrap"><table className="tbl"><TableCols widths={[28, 36, 36]} />
          <thead><tr><th></th><th className="num">Before</th><th className="num">After</th></tr></thead>
          <tbody>
            {row("Bank", b.bankName, a ? a.bankName : "—")}
            {row("Pledged amount", fmt(b.pledgedAmount), a ? fmt(a.pledgedAmount) : "—")}
            {row("Pledge date", b.pledgeDate.slice(0, 10), a ? a.pledgeDate.slice(0, 10) : "—")}
            {row("Cash treatment", treatmentLabel(b.cashTreatment), a ? treatmentLabel(a.cashTreatment) : "—")}
            {row("Cash received", fmt((b.cashAmount ?? 0) + (b.upiAmount ?? 0) + (b.bankTransferAmount ?? 0)), a ? fmt((a.cashAmount ?? 0) + (a.upiAmount ?? 0) + (a.bankTransferAmount ?? 0)) : "—")}
            {b.releaseDate && row("Release date", b.releaseDate.slice(0, 10), a?.releaseDate ? a.releaseDate.slice(0, 10) : "—")}
          </tbody>
        </table></div>
        <FieldError msg={err} />
      </div>
      <div className="ft">
        <button className="btn ghost" onClick={closeModal} disabled={saving}>Back</button>
        <button className="btn" onClick={confirm} disabled={saving}>
          <Icon name={mode === "delete" ? "trash" : "check"} /> {saving ? "Working…" : mode === "delete" ? "Confirm delete" : "Confirm & save"}
        </button>
      </div>
    </>
  );
}
