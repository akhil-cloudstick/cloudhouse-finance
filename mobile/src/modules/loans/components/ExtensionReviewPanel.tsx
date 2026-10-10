import React from "react";
import { View } from "react-native";
import { C, FieldGrid, Txt } from "@/common/components/ui";
import { useAuth } from "@/common/providers/AuthProvider";
import { approveLoanRequest } from "@/modules/loans/services/loanService";
import { Loan, LoanRequest } from "@/modules/loans/types/loan-types";
import { dmy } from "@/common/utils/format";
import { ApprovalChainPanel } from "@/common/components/ApprovalChainPanel";

type ExtensionReviewPanelProps = {
  request: LoanRequest;
  loan?: Loan;
  onSaved: () => void;
  onError: (message: string) => void;
};

/* The review for one Pending Extension request — walks the tenant's
 * "loan_extension" approval chain (src/common/services/approvalWorkflowService.ts), mirrors
 * frontend/modules/loans/components/ExtensionReviewModalContent.tsx. Drawn as the
 * prototype's #extension-review-modal body (field grid, decision remarks,
 * Reject / Approve row). Self-contained (reads its own permissions via
 * useAuth) so it can be dropped into the loan detail screen's sheet AND the
 * standalone Requests list's review sheet. `loan` is optional — when
 * omitted, request.loan (preloaded by the list endpoint) supplies the
 * customer / due date. */
export function ExtensionReviewPanel({
  request,
  loan,
  onSaved,
  onError,
}: ExtensionReviewPanelProps) {
  const { can } = useAuth();
  const canDecide = can("Loan_Management", "can_update_loan");
  const l = loan ?? request.loan;
  const months = request.requestedExtensionMonths;

  return (
    <View>
      <FieldGrid
        style={{ marginBottom: 14 }}
        items={[
          { k: "Customer", v: l?.customer?.name ?? "—" },
          { k: "Requested by", v: request.requestedBy || "—" },
          { k: "Current due date", v: dmy(l?.dueDate) },
          { k: "Requested extension", v: months ? `+${months} month${months === 1 ? "" : "s"}` : "—" },
          ...(request.newDueDate ? [{ k: "New due date", v: dmy(request.newDueDate) }] : []),
          { k: "Requested on", v: dmy(request.requestedAt || request.createdAt) },
        ]}
      />
      {request.detail ? <Txt style={{ fontSize: 12, color: C.muted, marginBottom: 12 }}>{request.detail}</Txt> : null}

      <ApprovalChainPanel
        flow="loan_extension"
        pending={request.approvalStage}
        status={request.status}
        rejectionRemarks={request.remarks}
        noun="Extension request"
        rejectMessage="Reject this extension request? The loan keeps its current due date."
        canDecide={canDecide}
        decide={(input) => approveLoanRequest(request.id, input)}
        onSaved={onSaved}
        onError={onError}
      />
    </View>
  );
}
