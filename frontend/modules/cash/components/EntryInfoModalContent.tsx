"use client";

import { useEffect, useState } from "react";
import { useModal } from "@/common/components/ModalProvider";
import { Icon } from "@/common/components/Icon";
import { fmt, fmtDate, fmtDateTime } from "@/common/utils/format";
import { getMovementEntry } from "@/modules/cash/services/cashService";
import { type EntryInfo, type EntryKind } from "@/modules/cash/types/cash-types";
import { BillLink } from "@/modules/cash/components/BillLink";
import { EditEntryModalContent } from "@/modules/cash/components/EditEntryModalContent";
import { DeleteEntryModalContent } from "@/modules/cash/components/DeleteEntryModalContent";
import { useLoanEntryActions } from "@/modules/cash/components/useLoanEntryActions";
import { useAuctionEntryActions } from "@/modules/loans/components/useAuctionEntryActions";
import { useBankPledgeEntryActions } from "@/modules/loans/components/useBankPledgeEntryActions";
import { useAuth } from "@/common/providers/AuthProvider";

const KIND_LABEL: Record<EntryKind, string> = {
  cash_in: "Credit (Cash In)",
  debit: "Debit (Expense)",
  self_transfer: "Self Transfer",
  gold_sale: "Gold Sale",
  system: "Entry",
};

// initial: the entry already fetched by the caller, so the popup opens complete instead of loading in front of the user.
type EntryInfoModalContentProps = { entryId: number; onChanged?: () => void; initial?: EntryInfo };

/* The ledger's info popup for a cash-in, a debit or a self transfer: its
 * remarks and everything recorded about it — category, amount, date, the
 * payment breakdown (or the From / To banks of a transfer), branch, bill. */
export function EntryInfoModalContent({ entryId, onChanged, initial }: EntryInfoModalContentProps) {
  const { closeModal, openChildModal, closeAllModals } = useModal();
  const { can } = useAuth();
  const loanActions = useLoanEntryActions(onChanged);
  const auctionActions = useAuctionEntryActions(onChanged);
  const pledgeActions = useBankPledgeEntryActions(onChanged);
  const canEditLedger = can("Loan_Management", "can_edit_ledger_entry");
  const canDeleteLedger = can("Loan_Management", "can_delete_ledger_entry");
  const [info, setInfo] = useState<EntryInfo | null>(initial ?? null);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (initial) return;
    let cancelled = false;
    getMovementEntry(entryId)
      .then((i) => { if (!cancelled) setInfo(i); })
      .catch(() => { if (!cancelled) setErr("Could not load the details of this entry."); });
    return () => { cancelled = true; };
  }, [entryId, initial]);

  if (!info) {
    return (
      <>
        <div className="hd"><h3>Entry Details</h3><button className="x" onClick={closeModal}>×</button></div>
        {/* Same sections as the loaded view, so the popup keeps its size and
         * nothing pops in piece by piece once the entry arrives. */}
        <div className="bd bd-scroll" style={{ minHeight: 360 }}>
          {err ? (
            <p style={{ color: "var(--red)", fontSize: 13 }}>{err}</p>
          ) : (
            <>
              <div className="kv">
                {["Category", "Amount", "Date"].map((k) => (
                  <div className="i" key={k}><div className="k">{k}</div><div className="v" style={{ color: "var(--muted)" }}>…</div></div>
                ))}
              </div>
              <h4 style={{ margin: "18px 0 6px", fontSize: 13 }}>Remarks</h4>
              <div style={{ border: "1px solid var(--line)", borderRadius: 8, padding: "10px 12px", fontSize: 13.5, minHeight: 40, color: "var(--muted)" }}>Loading…</div>
              <h4 style={{ margin: "18px 0 6px", fontSize: 13 }}>Payment breakdown</h4>
              <div style={{ border: "1px solid var(--line)", borderRadius: 8, minHeight: 60 }} />
            </>
          )}
        </div>
      </>
    );
  }

  const isTransfer = info.kind === "self_transfer";
  const item = (k: string, v: React.ReactNode) => (
    <div className="i"><div className="k">{k}</div><div className="v">{v}</div></div>
  );

  return (
    <>
      <div className="hd"><h3>Entry Details</h3><button className="x" onClick={closeModal}>×</button></div>
      <div className="bd bd-scroll">
        <p style={{ fontSize: 12, fontWeight: 700, letterSpacing: ".06em", color: "var(--brand-deep, #423591)", margin: "0 0 12px" }}>{KIND_LABEL[info.kind].toUpperCase()}</p>
        <div className="kv">
          {item("Category", info.category || "—")}
          {info.loanNumber ? item("Loan", info.loanNumber) : null}
          {info.ornamentType ? item("Ornament", info.ornamentType) : null}
          {info.kind === "gold_sale" ? item("Cost", fmt(info.costAmount ?? 0)) : null}
          {item("Amount", fmt(info.amount))}
          {item("Date", fmtDate(info.occurredOn))}
          {info.branchName ? item("Branch", info.branchName) : null}
          {info.status ? item("Status", info.status) : null}
          {info.approvedBy ? item("Approved by", info.approvedBy) : null}
          {info.approvedAt ? item("Approved on", fmtDateTime(info.approvedAt)) : null}
        </div>

        <h4 style={{ margin: "18px 0 6px", fontSize: 13 }}>Remarks</h4>
        <div style={{ border: "1px solid var(--line)", borderRadius: 8, padding: "10px 12px", fontSize: 13.5, whiteSpace: "pre-wrap", minHeight: 40, color: info.remarks ? undefined : "var(--muted)" }}>
          {info.remarks || "No remarks were added to this entry."}
        </div>

        {info.loanEntry === "service_charge" && (
          <p style={{ margin: "14px 0 0", fontSize: 12.5, color: "var(--muted)" }}>This charge is calculated from the loan&apos;s sanction and rate — change it by editing the sanction.</p>
        )}
        {info.loanEntry === "disbursement_reversal" && (
          <p style={{ margin: "14px 0 0", fontSize: 12.5, color: "var(--muted)" }}>This reversal is calculated from the loan&apos;s sanction and cannot be edited on its own — open the loan&apos;s sanction to change it.</p>
        )}
        {isTransfer ? (
          <>
            <h4 style={{ margin: "18px 0 6px", fontSize: 13 }}>Transfer</h4>
            <div className="kv">
              {item("Mode", info.lines[0]?.mode || "—")}
              {item("From bank", info.fromBank || "—")}
              {item("To bank", info.toBank || "—")}
            </div>
          </>
        ) : (
          <>
            <h4 style={{ margin: "18px 0 6px", fontSize: 13 }}>Payment breakdown</h4>
            <table className="tbl" style={{ width: "100%", minWidth: 0 }}>
              <thead><tr><th>Mode</th><th>Bank</th><th className="num">Amount</th></tr></thead>
              <tbody>
                {info.lines.map((l) => (
                  <tr key={l.movementId}><td>{l.mode}</td><td>{l.bankName || "—"}</td><td className="num">{fmt(l.amount)}</td></tr>
                ))}
                {info.lines.length > 1 && (
                  <tr><td colSpan={2} style={{ fontWeight: 600 }}>Total</td><td className="num" style={{ fontWeight: 600 }}>{fmt(info.amount)}</td></tr>
                )}
              </tbody>
            </table>
          </>
        )}

        {info.receiptImage ? (
          <p style={{ margin: "16px 0 0", fontSize: 13 }}>Bill:<BillLink url={info.receiptImage} title={info.category || "Entry"} /></p>
        ) : null}
      </div>
      <div className="ft">
        <button className="btn ghost" onClick={closeModal}>Close</button>
        {info.editable && canDeleteLedger && (
          <button className="btn ghost" style={{ color: "var(--red)" }} onClick={() => openChildModal(<DeleteEntryModalContent entryId={entryId} label={info.category} onDeleted={() => { onChanged?.(); closeAllModals(); }} />)}>
            <Icon name="trash" /> Delete
          </button>
        )}
        {info.editable && (
          <button className="btn" onClick={() => openChildModal(<EditEntryModalContent entryId={entryId} info={info} onSaved={() => { onChanged?.(); closeAllModals(); }} />)}>
            <Icon name="edit" /> Edit
          </button>
        )}
        {/* a gold loan's payout or top-up is edited from the loan's own record, recalculating the loan */}
        {info.loanEntry === "top_up" && info.loanId && info.loanTopUpId && canDeleteLedger && (
          <button className="btn ghost" style={{ color: "var(--red)" }} onClick={() => void loanActions.topUp(info.loanId!, info.loanTopUpId!, "delete")}><Icon name="trash" /> Delete</button>
        )}
        {info.loanEntry === "top_up" && info.loanId && info.loanTopUpId && canEditLedger && (
          <button className="btn" onClick={() => void loanActions.topUp(info.loanId!, info.loanTopUpId!, "edit")}><Icon name="edit" /> Edit</button>
        )}
        {info.loanEntry === "payment" && info.loanId && info.loanPaymentId && canDeleteLedger && (
          <button className="btn ghost" style={{ color: "var(--red)" }} onClick={() => void loanActions.payment(info.loanId!, info.loanPaymentId!, "delete")}><Icon name="trash" /> Delete</button>
        )}
        {info.loanEntry === "payment" && info.loanId && info.loanPaymentId && canEditLedger && (
          <button className="btn" onClick={() => void loanActions.payment(info.loanId!, info.loanPaymentId!, "edit")}><Icon name="edit" /> Edit</button>
        )}
        {(info.loanEntry === "bank_pledge" || info.loanEntry === "bank_pledge_release") && info.loanId && info.bankPledgeId && canDeleteLedger && (
          <button className="btn ghost" style={{ color: "var(--red)" }} onClick={() => void pledgeActions.pledge(info.loanId!, info.bankPledgeId!, "delete")}><Icon name="trash" /> Delete</button>
        )}
        {(info.loanEntry === "bank_pledge" || info.loanEntry === "bank_pledge_release") && info.loanId && info.bankPledgeId && canEditLedger && (
          <button className="btn" onClick={() => void pledgeActions.pledge(info.loanId!, info.bankPledgeId!, "edit")}><Icon name="edit" /> Edit</button>
        )}
        {info.loanEntry === "disbursement" && info.loanId && canEditLedger && (
          <button className="btn" onClick={() => void loanActions.sanction(info.loanId!)}><Icon name="edit" /> Edit</button>
        )}
        {info.loanEntry === "personal_payment" && info.loanId && info.loanPaymentId && canDeleteLedger && (
          <button className="btn ghost" style={{ color: "var(--red)" }} onClick={() => void loanActions.personalPayment(info.loanId!, info.loanPaymentId!, "delete")}><Icon name="trash" /> Delete</button>
        )}
        {info.loanEntry === "personal_payment" && info.loanId && info.loanPaymentId && canEditLedger && (
          <button className="btn" onClick={() => void loanActions.personalPayment(info.loanId!, info.loanPaymentId!, "edit")}><Icon name="edit" /> Edit</button>
        )}
        {/* a personal loan's disbursement cannot be deleted: it is the loan's start */}
        {info.loanEntry === "personal_disbursement" && info.loanId && canEditLedger && (
          <button className="btn" onClick={() => void loanActions.personalDisbursement(info.loanId!)}><Icon name="edit" /> Edit</button>
        )}
        {info.loanEntry === "investment_entry" && info.loanId && info.investmentEntryId && canDeleteLedger && (
          <button className="btn ghost" style={{ color: "var(--red)" }} onClick={() => void loanActions.investment(info.loanId!, info.investmentEntryId!, "delete")}><Icon name="trash" /> Delete</button>
        )}
        {info.loanEntry === "investment_entry" && info.loanId && info.investmentEntryId && canEditLedger && (
          <button className="btn" onClick={() => void loanActions.investment(info.loanId!, info.investmentEntryId!, "edit")}><Icon name="edit" /> Edit</button>
        )}
        {/* an auction's sale (and its expense line) or surplus settlement is edited from the auction, recalculating the loan */}
        {(info.loanEntry === "auction_sale" || info.loanEntry === "auction_expense") && info.loanId && canDeleteLedger && (
          <button className="btn ghost" style={{ color: "var(--red)" }} onClick={() => void auctionActions.open(info.loanId!, "sale", "delete")}><Icon name="trash" /> Delete</button>
        )}
        {(info.loanEntry === "auction_sale" || info.loanEntry === "auction_expense") && info.loanId && canEditLedger && (
          <button className="btn" onClick={() => void auctionActions.open(info.loanId!, "sale", "edit")}><Icon name="edit" /> Edit</button>
        )}
        {info.loanEntry === "auction_surplus" && info.loanId && canDeleteLedger && (
          <button className="btn ghost" style={{ color: "var(--red)" }} onClick={() => void auctionActions.open(info.loanId!, "surplus", "delete")}><Icon name="trash" /> Delete</button>
        )}
        {info.loanEntry === "auction_surplus" && info.loanId && canEditLedger && (
          <button className="btn" onClick={() => void auctionActions.open(info.loanId!, "surplus", "edit")}><Icon name="edit" /> Edit</button>
        )}
        {/* derived from the loan's sanction: edited there */}
        {info.loanEntry === "service_charge" && info.loanId && canEditLedger && (
          <button className="btn" onClick={() => void loanActions.sanction(info.loanId!)}><Icon name="edit" /> Edit sanction</button>
        )}
        {info.loanEntry === "disbursement_reversal" && info.loanId && canEditLedger && (
          <button className="btn" onClick={() => void loanActions.sanction(info.loanId!)}><Icon name="edit" /> Open loan</button>
        )}
      </div>
    </>
  );
}
