import React from "react";
import { View } from "react-native";
import { C, FieldGrid, Txt } from "../ui";
import { useAuth } from "../../auth/AuthContext";
import { approveLoanRequest } from "../../api/loans";
import { Loan, LoanRequest } from "../../types/loan";
import { dmy, inr } from "../../lib/format";
import { ApprovalChainPanel } from "./ApprovalChainPanel";

/* Review for one Waiver / Adjustment request — walks the tenant's
 * "loan_waiver" approval chain; the final stage's approval posts it to the
 * loan. Same shape as ExtensionReviewPanel, used by the loan detail screen
 * and the Requests list's review sheet. */
export function WaiverReviewPanel({
  request,
  loan,
  onSaved,
  onError,
}: {
  request: LoanRequest;
  loan?: Loan;
  onSaved: () => void;
  onError: (message: string) => void;
}) {
  const { can } = useAuth();
  const canDecide = can("Loan_Management", "can_update_loan");
  const l = loan ?? request.loan;
  const isWaiver = request.type === "Waiver";

  return (
    <View>
      <FieldGrid
        style={{ marginBottom: 14 }}
        items={[
          { k: "Customer", v: l?.customer?.name ?? "—" },
          { k: "Requested by", v: request.requestedBy || "—" },
          { k: "Type", v: isWaiver ? "Waiver (interest)" : "Adjustment (principal)" },
          { k: "Amount", v: inr(request.amount ?? 0) },
          ...(l
            ? [
                isWaiver
                  ? { k: "Interest owed now", v: inr((l.outstandingInterest ?? 0) + (l.outstandingPenalInterest ?? 0)) }
                  : { k: "Principal outstanding", v: inr(l.outstandingAmount ?? 0) },
              ]
            : []),
          { k: "Requested on", v: dmy(request.requestedAt || request.createdAt) },
        ]}
      />
      {request.detail ? <Txt style={{ fontSize: 12, color: C.muted, marginBottom: 12 }}>{request.detail}</Txt> : null}

      <ApprovalChainPanel
        flow="loan_waiver"
        pending={request.approvalStage}
        status={request.status}
        rejectionRemarks={request.remarks}
        noun={request.type}
        rejectMessage={`Reject this ${request.type.toLowerCase()} request? Nothing is posted to the loan.`}
        canDecide={canDecide}
        decide={(input) => approveLoanRequest(request.id, input)}
        onSaved={onSaved}
        onError={onError}
      />
    </View>
  );
}
