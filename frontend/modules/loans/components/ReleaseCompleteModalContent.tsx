"use client";

import { useModal } from "@/common/components/ModalProvider";
import { useAuth } from "@/common/providers/AuthProvider";
import { Icon } from "@/common/components/Icon";
import { fmt, fmtW, fmtDate } from "@/common/utils/format";
import { linkedDiscountOf } from "@/modules/loans/services/loanService";
import { type LoanView, type RequestView } from "@/modules/loans/types/loan-types";
import { LedgerPaymentEditModalContent } from "@/modules/loans/components/LedgerPaymentEditModalContent";
import { TableCols } from "@/common/components/ui/TableCols";

type ReleaseCompleteModalContentProps = { request: RequestView; loan: LoanView; onSaved: () => void };

/* The one screen staff see once a release is done in a single step — no
 * approver configured, or just one, so recording the release payment also
 * approves it (backend RecordReleaseRequestPayment → advanceReleaseRequestStage).
 * Replaces ReleaseReviewModalContent at that point instead of leaving it
 * sitting in its approved state: the loan, what was paid and how, and the
 * ornaments handed back. */
export function ReleaseCompleteModalContent({ request: req, loan, onSaved }: ReleaseCompleteModalContentProps) {
  const { closeModal, openModal } = useModal();
  const { can } = useAuth();
  const canEditLedger = can("Loan_Management", "can_edit_ledger_entry");

  // A partial release names its ornaments; a full one hands back everything not already released earlier.
  const ornaments = req.isPartial
    ? loan.ornaments.filter((o) => req.ornamentIds.includes(o.id))
    : loan.ornaments.filter((o) => !o.releasedAt);
  const totalNet = ornaments.reduce((s, o) => s + o.netWeight, 0);
  const totalValue = ornaments.reduce((s, o) => s + o.goldValue, 0);

  // The payment recorded for this release — same lookup ReleaseReviewModalContent uses for its Edit button.
  const payment = [...loan.payments].reverse().find((p) => p.description === "Release payment" && p.type !== "Discount")
    ?? [...loan.payments].reverse().find((p) => Math.abs(p.amount - req.recordedPayment) < 0.005 && p.type !== "Disbursement" && p.type !== "Discount");
  const paidBy = payment
    ? ([["Cash", payment.cashAmount], ["UPI", payment.upiAmount], ["Bank transfer", payment.bankTransferAmount], ["Cheque", payment.chequeAmount]] as const).filter(([, v]) => v > 0.001)
    : [];
  const applied = payment
    ? ([["Penal interest", payment.penalInterestApplied], ["Interest", payment.interestApplied], ["Charges", payment.processingFeeApplied], ["Principal", payment.principalApplied]] as const).filter(([, v]) => v > 0.001)
    : [];

  return (
    <>
      <div className="hd">
        <h3>
          Release Complete — {req.loanNumber}
          {req.isPartial && <span className="chip brand" style={{ marginLeft: 8, fontSize: 11 }}>Partial</span>}
        </h3>
        <button className="x" onClick={closeModal}>×</button>
      </div>
      <div className="bd bd-scroll rel-done-bd">
        <div className="pay-receipt rel-done-hero">
          <div className="pay-r-cap">Amount paid</div>
          <div className="pay-r-big">{fmt(req.recordedPayment)}</div>
          <div className="pay-r-cap">{payment ? fmtDate(payment.paidOn) : fmtDate(req.requestedAt)}{paidBy.length ? ` · ${paidBy.map(([l]) => l).join(" + ")}` : ""}</div>
          <div className="pay-r-ok"><Icon name="check" /> {req.isPartial ? "Selected ornaments released — loan stays open" : "Gold released — loan closed"}</div>
        </div>

        <div className="kv" style={{ gridTemplateColumns: "1fr 1fr", margin: "16px 0" }}>
          <div className="i"><div className="k">Loan Number</div><div className="v">{req.loanNumber}</div></div>
          <div className="i"><div className="k">Customer</div><div className="v">{req.customerName}</div></div>
          {paidBy.map(([label, v]) => (
            <div className="i" key={label}><div className="k">Paid by {label}</div><div className="v">{fmt(v)}</div></div>
          ))}
          {req.recordedDiscount > 0.001 && <div className="i"><div className="k">Discount</div><div className="v">{fmt(req.recordedDiscount)}</div></div>}
          {applied.map(([label, v]) => (
            <div className="i" key={label}><div className="k">Towards {label}</div><div className="v">{fmt(v)}</div></div>
          ))}
        </div>

        <label className="f">Ornaments Released — {ornaments.length}</label>
        <div className="tbl-wrap rel-orn-wrap"><table className="tbl tbl-tight"><TableCols widths={[34, 16, 10, 18, 22]} />
          <thead><tr><th>Ornament</th><th>Purity</th><th className="num">Qty</th><th className="num">Net Wt</th><th className="num">Gold Value</th></tr></thead>
          <tbody>
            {ornaments.map((o) => (
              <tr key={o.id}><td>{o.name}</td><td><span className="chip brand">{o.purity}</span></td><td className="num">{o.quantity}</td><td className="num">{fmtW(o.netWeight)}</td><td className="num">{fmt(o.goldValue)}</td></tr>
            ))}
          </tbody>
          {ornaments.length > 1 && (
            <tfoot><tr><td colSpan={3}>Total</td><td className="num">{fmtW(totalNet)}</td><td className="num">{fmt(totalValue)}</td></tr></tfoot>
          )}
        </table></div>
      </div>
      {/* the × in the header closes the popup; the footer is only for Edit */}
      {canEditLedger && payment && (
        <div className="ft">
          <button className="btn ghost"
            onClick={() => openModal(<LedgerPaymentEditModalContent loanId={loan.numericId} payment={payment} linkedDiscount={linkedDiscountOf(loan.payments, payment)} mode="edit" minDate={loan.opened?.slice(0, 10) || undefined} onSaved={() => { onSaved(); closeModal(); }} />, true)}>
            <Icon name="edit" /> Edit
          </button>
        </div>
      )}
    </>
  );
}
