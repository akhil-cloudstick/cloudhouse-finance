import React, { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { C, Field, Input, PillTabs, PrimaryButton, ResultBox, Sheet, TextField, Txt, toast } from "../../ui";
import { createWaiverRequest } from "../../../api/loans";
import { isFlowOff, useApprovalWorkflow } from "../../../api/approvalWorkflow";
import { inr } from "../../../lib/format";
import type { Loan } from "../../../types/loan";
import { ErrorText, apiErr, invalidateLoan } from "./common";

const TYPES = ["Waiver", "Adjustment"] as const;
type WaiverType = (typeof TYPES)[number];
const TYPE_LABELS: Record<WaiverType, string> = { Waiver: "Waive interest", Adjustment: "Adjust principal" };

/** Request a waiver (forgive interest + penal interest owed) or an
 * adjustment (reduce the principal outstanding) — POST /loans/:id/
 * waiver-request. With the tenant's "loan_waiver" flow off it posts to the
 * loan immediately; otherwise it waits in that approval chain and shows up
 * under the loan's pending requests and on the Requests screen. The caps
 * mirror the backend's checkWaiverCap. */
export function WaiverSheet({ loan: l, visible, onClose }: { loan: Loan; visible: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const needsApproval = !isFlowOff(useApprovalWorkflow(), "loan_waiver");
  const [type, setType] = useState<WaiverType>("Waiver");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    setType("Waiver");
    setAmount("");
    setReason("");
    setError(null);
  }, [visible]);

  const cap = Math.round((type === "Waiver" ? (l.outstandingInterest ?? 0) + (l.outstandingPenalInterest ?? 0) : l.outstandingAmount ?? 0) * 100) / 100;
  const amt = Number(amount) || 0;
  const over = amt > cap + 0.01;

  const save = useMutation({
    mutationFn: () => createWaiverRequest(l.id, { type, amount: amt, reason: reason.trim() }),
    onSuccess: (r) => {
      invalidateLoan(qc, l.id);
      if (r?.status === "Pending") toast.success(`${type} submitted for approval`, `${inr(amt)} on ${l.loanNumber}`);
      else toast.success(type === "Waiver" ? "Waiver posted" : "Adjustment posted", `${inr(amt)} on ${l.loanNumber}`);
      onClose();
    },
    onError: (e) => setError(apiErr(e, "Could not save the request — try again.")),
  });

  return (
    <Sheet visible={visible} onClose={onClose} title="Waiver / Adjustment">
      <Txt style={{ fontSize: 11.5, color: C.muted, fontWeight: "600", marginVertical: 8 }}>
        {l.loanNumber} · {needsApproval ? "Needs approval before it is posted" : "Posted to the loan immediately"}
      </Txt>
      <PillTabs tabs={TYPES} value={type} onChange={setType} labels={TYPE_LABELS} inSheet />
      <ResultBox
        k={type === "Waiver" ? "Interest + penal interest owed" : "Principal outstanding"}
        v={inr(cap)}
        tone={cap > 0 ? "brand" : "red"}
        style={{ marginTop: 12 }}
      />
      <Field label="Amount (₹) *">
        <Input keyboardType="decimal-pad" value={amount} onChangeText={setAmount} placeholder="e.g. 500" style={over ? { borderColor: C.red } : undefined} />
        {over ? <Txt style={{ fontSize: 11, color: C.red, marginTop: 4 }}>Can&apos;t exceed {inr(cap)}.</Txt> : null}
      </Field>
      <TextField label="Reason *" placeholder="Why is this being waived / adjusted?" value={reason} onChangeText={setReason} multiline />
      <ErrorText>{error}</ErrorText>
      <PrimaryButton
        label={needsApproval ? "Submit for Approval" : type === "Waiver" ? "Post Waiver" : "Post Adjustment"}
        onPress={() => {
          setError(null);
          save.mutate();
        }}
        loading={save.isPending}
        disabled={!(amt > 0) || over || !reason.trim()}
      />
    </Sheet>
  );
}
