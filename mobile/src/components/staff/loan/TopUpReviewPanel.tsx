import React from "react";
import { View } from "react-native";
import { FieldGrid } from "../../ui";
import { useAuth } from "../../../auth/AuthContext";
import { approveTopUp } from "../../../api/loans";
import { dmy, inr } from "../../../lib/format";
import type { Loan, LoanTopUp } from "../../../types/loan";
import { ApprovalChainPanel } from "../../loanRequests/ApprovalChainPanel";

/** Review for one Pending top-up — walks the tenant's "loan_topup" approval
 * chain; the final stage's approval pays it out with the payment split
 * captured when it was requested. */
export function TopUpReviewPanel({
  loan: l,
  topUp: t,
  onSaved,
  onError,
}: {
  loan: Loan;
  topUp: LoanTopUp;
  onSaved: () => void;
  onError: (message: string) => void;
}) {
  const { can } = useAuth();
  const modes = [
    t.cashAmount ? `Cash ${inr(t.cashAmount)}` : "",
    t.upiAmount ? `UPI ${inr(t.upiAmount)}` : "",
    t.bankTransferAmount ? `Bank ${inr(t.bankTransferAmount)}` : "",
    t.chequeAmount ? `Cheque ${inr(t.chequeAmount)}` : "",
  ].filter(Boolean);

  return (
    <View>
      <FieldGrid
        style={{ marginBottom: 14 }}
        items={[
          { k: "Top-up amount", v: inr(t.amount) },
          { k: "Requested on", v: dmy(t.occurredOn || t.createdAt) },
          { k: "Current principal", v: inr(l.principalAmount) },
          { k: "Eligible at request", v: inr(t.eligibleAmountAtTopUp) },
          { k: "Payout", v: modes.join(" · ") || "—" },
          ...(t.settleInterest === "deduct" ? [{ k: "Interest", v: "Deducted from payout" }] : []),
          ...(t.reference ? [{ k: "Reference", v: t.reference }] : []),
        ]}
      />
      <ApprovalChainPanel
        flow="loan_topup"
        pending={t.approvalStage}
        status={t.status}
        noun="Top-up"
        rejectMessage={`Reject this ${inr(t.amount)} top-up? Nothing is paid out.`}
        canDecide={can("Loan_Management", "can_update_loan")}
        decide={(input) => approveTopUp(t.id, input)}
        onSaved={onSaved}
        onError={onError}
      />
    </View>
  );
}
