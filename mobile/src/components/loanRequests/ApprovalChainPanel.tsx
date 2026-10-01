import React, { useState } from "react";
import { View } from "react-native";
import { useMutation } from "@tanstack/react-query";
import { BtnRow2, C, ConfirmSheet, PrimaryButton, ReviewWarning, SheetFooter, Stepper, TextField, Txt, toast } from "../ui";
import { useAuth } from "../../auth/AuthContext";
import { ApiError } from "../../api/client";
import { flowOf, isFinalStage, stageByPending, stageIndex, stagePerm, stepperSteps, useApprovalWorkflow, type FlowKey } from "../../api/approvalWorkflow";

/* The tenant-configured approval chain for one item — the Stepper (enabled
 * stages, plus the item's own stage if it's parked on a disabled one), whose
 * turn it is, and — when the signed-in employee holds that stage's
 * permission — decision remarks with Reject / Approve. Shared by the
 * extension, waiver/adjustment, top-up and personal-loan reviews; the
 * caller supplies the actual API call (`decide`) and what to do after.
 * Renders nothing but the rejection note when the flow has no stages. */
export function ApprovalChainPanel({
  flow,
  pending,
  status,
  rejectionRemarks,
  noun,
  rejectMessage,
  canDecide = true,
  decide,
  onSaved,
  onError,
}: {
  flow: FlowKey;
  /** The item's approvalStage — a stage's pending value while it waits. */
  pending?: string | null;
  status: "Pending" | "Approved" | "Rejected" | string;
  rejectionRemarks?: string;
  /** "Extension request", "Top-up", ... — used in toasts and the reject confirm. */
  noun: string;
  rejectMessage?: string;
  /** Extra gate on top of the stage permission (e.g. can_update_loan). */
  canDecide?: boolean;
  decide: (input: { stage: string; action: "Approved" | "Rejected"; remarks?: string }) => Promise<unknown>;
  onSaved: () => void;
  onError: (message: string) => void;
}) {
  const { can } = useAuth();
  const wf = useApprovalWorkflow();
  const [remarks, setRemarks] = useState("");
  const [confirmReject, setConfirmReject] = useState(false);

  const isPending = status === "Pending" || status === "Pending Approval";
  const stage = isPending ? stageByPending(wf, flow, pending) : undefined;
  const steps = stepperSteps(wf, flow, stage?.pending);
  const current = stage ? stageIndex(wf, flow, stage.pending) : steps.length;
  const isFinal = !!stage && isFinalStage(wf, flow, stage.pending);
  const canActOnStage = !!stage && canDecide && can(...stagePerm(stage));
  const finalAction = flowOf(wf, flow)?.finalAction;

  const run = useMutation({
    mutationFn: ({ action, note }: { action: "Approved" | "Rejected"; note: string }) =>
      decide({ stage: stage!.key, action, remarks: note.trim() || undefined }),
    onSuccess: (_d, v) => {
      setRemarks("");
      setConfirmReject(false);
      toast.success(`${noun} ${v.action === "Rejected" ? "rejected" : "approved"}`);
      onSaved();
    },
    onError: (err) => {
      setConfirmReject(false);
      onError(err instanceof ApiError ? err.message : "Could not record the decision — try again.");
    },
  });

  return (
    <View>
      {steps.length ? <Stepper steps={steps} current={current} allDone={status === "Approved"} /> : null}

      {status === "Rejected" ? (
        <ReviewWarning>Rejected{rejectionRemarks ? ` — ${rejectionRemarks}` : ""}</ReviewWarning>
      ) : stage ? (
        <Txt style={{ fontSize: 12, color: C.muted, marginBottom: 12 }}>
          {canActOnStage ? "Awaiting your" : "Awaiting"} {stage.label} approval
          {canActOnStage && isFinal && finalAction ? ` — your approval ${finalAction} it.` : ""}
        </Txt>
      ) : null}

      {stage && canActOnStage ? (
        <>
          <TextField label="Decision remarks (optional)" placeholder="Add a note" value={remarks} onChangeText={setRemarks} />
          <SheetFooter>
            <BtnRow2>
              <PrimaryButton label="Reject" variant="reject" onPress={() => setConfirmReject(true)} disabled={run.isPending} />
              <PrimaryButton
                label="Approve"
                onPress={() => run.mutate({ action: "Approved", note: remarks })}
                loading={run.isPending && run.variables?.action === "Approved"}
                disabled={run.isPending}
              />
            </BtnRow2>
          </SheetFooter>
          <ConfirmSheet
            visible={confirmReject}
            onClose={() => setConfirmReject(false)}
            title={`Reject ${noun}`}
            danger
            message={rejectMessage ?? `Reject this ${noun.toLowerCase()}?`}
            remarks={{ label: "Reason (optional)", placeholder: "Why is this being rejected?", initial: remarks }}
            confirmLabel="Reject"
            loading={run.isPending && run.variables?.action === "Rejected"}
            onConfirm={(note) => run.mutate({ action: "Rejected", note })}
          />
        </>
      ) : null}
    </View>
  );
}
