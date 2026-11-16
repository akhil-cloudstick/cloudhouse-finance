import React, { useEffect, useState } from "react";
import { C, Field, PrimaryButton, ResultBox, Sheet, Txt, toast, type SplitAmounts } from "@/common/components/ui";
import { SplitPaymentInput, type SplitPayment } from "@/common/components/SplitPaymentInput";
import { inr } from "@/common/utils/format";
import type { Loan } from "@/modules/loans/types/loan-types";
import { FieldErr } from "@/common/components/ErrorText";

type DisburseSheetProps = {
  loan: Loan;
  /** Branch balance in hand; confirming stays disabled while it's short of the payout. */
  balanceInHand?: number | null;
  visible: boolean;
  onClose: () => void;
  /** The payout split plus the branch bank account a UPI / Bank Transfer share leaves from. */
  onConfirm: (payment: SplitAmounts & { bankId?: number }) => void;
  loading?: boolean;
  error?: string | null;
  /** "Verify" when the final stage is the Loan Operator's verification. */
  verb?: "Approve" | "Verify";
};

/** The FINAL enabled sanction stage's approval disburses the loan (which stage
 * that is — Loan Operator, Branch Manager or Final Sanction — is per-tenant
 * config, see src/common/services/approvalWorkflowService.ts), so it collects how the payout
 * leaves the till first (same rule as the web: the split must add up to the
 * disbursed amount). The service charge is always paid out that much less. */
export function DisburseSheet({
  loan: l,
  visible,
  onClose,
  onConfirm,
  loading,
  error,
  verb = "Approve",
  balanceInHand,
}: DisburseSheetProps) {
  // The customer is paid the principal less the charge in both modes: a withheld charge stays with the
  // branch, an added charge is carried on the loan (the principal already includes it).
  const payout = Math.round((l.principalAmount - (l.serviceChargeAmount ?? 0)) * 100) / 100;
  const [pay, setPay] = useState<SplitPayment | null>(null);
  const insufficient = balanceInHand != null && payout > balanceInHand + 0.005;
  const [tried, setTried] = useState(false);
  // A failure from the server is not about a field: raise it as a toast.
  useEffect(() => { if (error) toast.error(error); }, [error]);
  const payErr = insufficient ? "Not enough balance in hand — add cash to disburse." : !pay?.ready ? "The payment breakdown must add up to the amount, with a bank for every UPI / Bank Transfer line." : undefined;

  return (
    <Sheet visible={visible} onClose={onClose} title={`${verb} & Disburse`}>
      <Txt style={{ fontSize: 11.5, color: C.muted, fontWeight: "600", marginVertical: 8 }}>
        {l.loanNumber} · {(l.serviceChargeAmount ?? 0) > 0 ? `${inr(l.principalAmount)} less ${inr(l.serviceChargeAmount ?? 0)} service charge` : "Principal"} paid out to the customer
      </Txt>
      <ResultBox k="Amount to disburse" v={inr(payout)} />
      <Field label="Payment breakdown">
        <SplitPaymentInput total={payout} onChange={setPay} bankLabel="Bank (account it is paid from)" />
      </Field>
      {balanceInHand != null ? (
        <Txt style={{ fontSize: 12, marginBottom: 6, color: insufficient ? C.red : C.muted }}>
          Balance in hand: <Txt style={{ fontWeight: "700", color: insufficient ? C.red : C.ink }}>{inr(balanceInHand)}</Txt>
          {insufficient ? " — add cash to disburse." : ""}
        </Txt>
      ) : null}
      <FieldErr m={tried ? payErr : undefined} />
      <PrimaryButton label={`${verb} & Disburse ${inr(payout)}`} onPress={() => (payErr || !pay ? setTried(true) : onConfirm({ ...pay.split, bankId: pay.bankId }))} loading={loading} />
    </Sheet>
  );
}
