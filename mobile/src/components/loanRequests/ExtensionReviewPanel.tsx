import React, { useState } from "react";
import { View } from "react-native";
import { useMutation } from "@tanstack/react-query";
import { BtnRow2, C, FieldGrid, PrimaryButton, ReviewWarning, Stepper, TextField, Txt } from "../ui";
import { useAuth } from "../../auth/AuthContext";
import {
  approveExtensionRequest,
  extensionStageKeyFor,
  EXTENSION_STAGES,
  EXTENSION_STAGE_LABELS,
  EXTENSION_STAGE_ROLES,
  EXTENSION_STAGE_PERMISSIONS,
} from "../../api/loans";
import { Loan, LoanRequest } from "../../types/loan";
import { ApiError } from "../../api/client";
import { dmy } from "../../lib/format";

/* The 3-stage Loan Officer -> Branch Manager -> Management review for one
 * Pending Extension request — mirrors frontend/common/components/modals/
 * ExtensionReviewModal.tsx. Drawn as the prototype's #extension-review-modal
 * body (field grid, decision remarks, Reject / Approve row). Self-contained
 * (reads its own permissions via useAuth) so it can be dropped into the loan
 * detail screen's sheet AND the standalone Requests list's review sheet.
 * `loan` is optional — when omitted, request.loan (preloaded by the list
 * endpoint) supplies the customer / due date. */
export function ExtensionReviewPanel({
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
  const [remarks, setRemarks] = useState("");

  const stageKey = extensionStageKeyFor(request.approvalStage || "");
  const requiredRole = stageKey ? EXTENSION_STAGE_ROLES[stageKey] : null;
  const canActOnStage = !!stageKey && can("Loan_Extension_Approval", EXTENSION_STAGE_PERMISSIONS[stageKey]);
  const l = loan ?? request.loan;

  const decide = useMutation({
    mutationFn: (action: "Approved" | "Rejected") =>
      approveExtensionRequest(request.id, { stage: stageKey!, action, remarks: remarks.trim() || undefined }),
    onSuccess: () => {
      setRemarks("");
      onSaved();
    },
    onError: (err) => onError(err instanceof ApiError ? err.message : "Could not record the decision — try again."),
  });

  const currentIdx = stageKey ? EXTENSION_STAGES.indexOf(stageKey) : EXTENSION_STAGES.length;
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

      <Stepper steps={EXTENSION_STAGES.map((s) => EXTENSION_STAGE_LABELS[s])} current={currentIdx} allDone={request.status === "Approved"} />

      {request.status === "Rejected" ? (
        <ReviewWarning>Rejected{request.remarks ? ` — ${request.remarks}` : ""}</ReviewWarning>
      ) : stageKey ? (
        <Txt style={{ fontSize: 12, color: C.muted, marginBottom: 12 }}>
          {canActOnStage ? "Awaiting your" : "Awaiting"} {requiredRole} approval
        </Txt>
      ) : null}

      {request.status === "Pending" && stageKey && canActOnStage && canDecide ? (
        <>
          <TextField label="Decision remarks (optional)" placeholder="Add a note" value={remarks} onChangeText={setRemarks} />
          <BtnRow2>
            <PrimaryButton label="Reject" variant="reject" onPress={() => decide.mutate("Rejected")} loading={decide.isPending && decide.variables === "Rejected"} disabled={decide.isPending} />
            <PrimaryButton
              label={`Approve (${EXTENSION_STAGE_LABELS[stageKey]})`}
              onPress={() => decide.mutate("Approved")}
              loading={decide.isPending && decide.variables === "Approved"}
              disabled={decide.isPending}
            />
          </BtnRow2>
        </>
      ) : null}
    </View>
  );
}
