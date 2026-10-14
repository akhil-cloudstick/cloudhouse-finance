import React, { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AccBtn, CheckItem, DateField, Field, Input, NoticeBanner, PrimaryButton, ResultBox, Sheet, TextField, Txt, C, toast } from "@/common/components/ui";
import { SplitPaymentInput, type SplitPayment } from "@/common/components/SplitPaymentInput";
import { topUpLoan } from "@/modules/loans/services/loanService";
import { isFlowOff, useApprovalWorkflow } from "@/common/services/approvalWorkflowService";
import { inr, todayISO } from "@/common/utils/format";
import type { Loan } from "@/modules/loans/types/loan-types";
import { apiErr, invalidateLoan } from "@/common/components/loanSheetKit";
import { ErrorText } from "@/common/components/ErrorText";

/** Loans that can take a top-up — mirrors the backend's TopUpLoan guard. */
export const TOP_UP_STATUSES = ["Active", "Due Soon", "Overdue"];

type TopUpSheetProps = {
  loan: Loan;
  visible: boolean;
  onClose: () => void;
  onAddOrnaments?: () => void;
  onRecordPayment?: () => void;
};

/** Top Up Loan — same fields and rules as the web TopUpLoanModal: the
 * available headroom (eligible − outstanding), the top-up amount (capped at
 * the headroom), a payment breakdown that must add up, an optional
 * reference, plus the entry date the backend accepts (occurredOn). When the
 * loan has outstanding interest/penal interest, staff choose whether the
 * customer pays it first (onRecordPayment opens the parent's
 * CollectPaymentSheet) or it's deducted from this top-up's own payout. A
 * shortfall points staff to Edit Loan to add ornaments. */
export function TopUpSheet({
  loan: l,
  visible,
  onClose,
  onAddOrnaments,
  onRecordPayment,
}: TopUpSheetProps) {
  const qc = useQueryClient();
  // Tenant's "loan_topup" flow: off → paid out right away (unchanged);
  // on → saved as a Pending top-up that walks the approval chain, and only
  // its final stage pays it out.
  const needsApproval = !isFlowOff(useApprovalWorkflow(), "loan_topup");
  const [amount, setAmount] = useState("");
  const [pay, setPay] = useState<SplitPayment | null>(null);
  const [date, setDate] = useState(todayISO());
  const [reference, setReference] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [shortfall, setShortfall] = useState(false);
  const [needsPayment, setNeedsPayment] = useState(false);
  // Staff's choice for the loan's outstanding interest/penal interest, if
  // any (see TopUpInput.settleInterest on the backend) — only shown/sent
  // when arrears actually exist.
  const [settleMode, setSettleMode] = useState<"require" | "deduct">("require");

  useEffect(() => {
    if (!visible) return;
    setAmount("");
    setDate(todayISO());
    setReference("");
    setError(null);
    setShortfall(false);
    setNeedsPayment(false);
    setSettleMode("require");
  }, [visible]);

  const eligible = l.eligibleLoanAmount ?? 0;
  const outstanding = l.outstandingAmount ?? 0;
  const headroom = Math.max(0, Math.round((eligible - outstanding) * 100) / 100);
  const amt = Number(amount) || 0;
  const over = amt > headroom + 0.01;
  const arrears = (l.outstandingInterest ?? 0) + (l.outstandingPenalInterest ?? 0);
  const hasArrears = arrears > 0.01;

  const save = useMutation({
    mutationFn: () =>
      topUpLoan(l.id, {
        amount: amt,
        ...(pay?.split ?? {}),
        bankId: pay?.bankId,
        occurredOn: date || undefined,
        reference: reference.trim() || undefined,
        settleInterest: hasArrears ? settleMode : undefined,
      }),
    onSuccess: () => {
      invalidateLoan(qc, l.id);
      if (needsApproval) {
        toast.success("Top-up submitted for approval", `${inr(amt)} on ${l.loanNumber} — paid out once approved`);
        onClose();
        return;
      }
      toast.success(
        "Loan topped up",
        settleMode === "deduct" && hasArrears
          ? `${inr(amt)} added to ${l.loanNumber} — ${inr(arrears)} interest deducted from the payout`
          : `${inr(amt)} added to ${l.loanNumber}`
      );
      onClose();
    },
    onError: (e) => {
      const msg = apiErr(e, "Could not record the top-up — try again.");
      setShortfall(/headroom/i.test(msg));
      setNeedsPayment(/outstanding interest/i.test(msg));
      setError(msg);
    },
  });

  function changeAmount(v: string) {
    setAmount(v);
  }

  return (
    <Sheet visible={visible} onClose={onClose} title="Top Up Loan">
      <Txt style={{ fontSize: 11.5, color: C.muted, fontWeight: "600", marginVertical: 8 }}>
        {l.loanNumber} · Principal {inr(l.principalAmount)}
      </Txt>
      <ResultBox k="Available headroom" v={inr(headroom)} tone={headroom > 0 ? "brand" : "red"} />
      <Txt style={{ fontSize: 11, color: C.muted, marginTop: -8, marginBottom: 12 }}>
        Eligible {inr(eligible)} − Outstanding {inr(outstanding)}
      </Txt>
      {headroom <= 0 ? <NoticeBanner>No headroom left on this loan — add ornaments to raise the eligible amount.</NoticeBanner> : null}
      {hasArrears ? (
        <Field label={`Outstanding interest ${inr(arrears)} — how should it be handled?`}>
          <CheckItem
            checked={settleMode === "require"}
            onPress={() => setSettleMode("require")}
            title="Customer pays it first, separately"
          />
          <CheckItem
            checked={settleMode === "deduct"}
            onPress={() => setSettleMode("deduct")}
            title="Deduct it from this top-up's payout"
            sub="Less cash handed out"
          />
        </Field>
      ) : null}
      <Field label="Top-up amount (₹) *">
        <Input keyboardType="decimal-pad" value={amount} onChangeText={changeAmount} placeholder="e.g. 5000" style={over ? { borderColor: C.red } : undefined} />
        {over ? <Txt style={{ fontSize: 11, color: C.red, marginTop: 4 }}>Can&apos;t exceed the headroom of {inr(headroom)}.</Txt> : null}
      </Field>
      <DateField label="Top-up date" value={date} onChange={setDate} max={todayISO()} />
      <Field label="Payment breakdown">
        <SplitPaymentInput total={amt} onChange={setPay} bankLabel="Bank (account it is paid from)" />
      </Field>
      <TextField label="Reference" placeholder="Transaction / cheque reference (optional)" value={reference} onChangeText={(v) => setReference(v.slice(0, 80))} />
      {shortfall && onAddOrnaments ? <AccBtn label="Add ornaments to raise the eligible amount" onPress={onAddOrnaments} style={{ marginBottom: 12 }} /> : null}
      {needsPayment && onRecordPayment ? <AccBtn label="Record Payment to clear the arrears" onPress={onRecordPayment} style={{ marginBottom: 12 }} /> : null}
      {needsPayment && !onRecordPayment ? (
        <Txt style={{ fontSize: 12, color: C.muted, marginBottom: 12 }}>Ask someone who can record loan payments to clear the arrears first.</Txt>
      ) : null}
      <ErrorText>{error}</ErrorText>
      <PrimaryButton
        label={needsApproval ? "Submit for Approval" : "Top Up"}
        onPress={() => {
          setError(null);
          save.mutate();
        }}
        loading={save.isPending}
        disabled={!(amt > 0) || over || !pay?.ready}
      />
    </Sheet>
  );
}
