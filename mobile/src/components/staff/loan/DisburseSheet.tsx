import React, { useEffect, useState } from "react";
import { C, Field, PaymentSplit, PrimaryButton, ResultBox, Sheet, Txt, ZERO_SPLIT, isBalanced, type SplitAmounts } from "../../ui";
import { inr } from "../../../lib/format";
import type { Loan } from "../../../types/loan";
import { ErrorText } from "./common";

/** The FINAL enabled sanction stage's approval disburses the loan (which stage
 * that is — Loan Operator, Branch Manager or Final Sanction — is per-tenant
 * config, see src/api/approvalWorkflow.ts), so it collects how the payout
 * leaves the till first (same rule as the web: the split must add up to the
 * disbursed amount). A WithheldFromPayout service charge is paid out that much less. */
export function DisburseSheet({
  loan: l,
  visible,
  onClose,
  onConfirm,
  loading,
  error,
  verb = "Approve",
}: {
  loan: Loan;
  visible: boolean;
  onClose: () => void;
  onConfirm: (split: SplitAmounts) => void;
  loading?: boolean;
  error?: string | null;
  /** "Verify" when the final stage is the Loan Operator's verification. */
  verb?: "Approve" | "Verify";
}) {
  const withheld = l.serviceChargeMode === "WithheldFromPayout" ? l.serviceChargeAmount ?? 0 : 0;
  const payout = Math.round((l.principalAmount - withheld) * 100) / 100;
  const [split, setSplit] = useState<SplitAmounts>({ ...ZERO_SPLIT, cashAmount: payout });

  useEffect(() => {
    if (visible) setSplit({ ...ZERO_SPLIT, cashAmount: payout });
  }, [visible, payout]);

  return (
    <Sheet visible={visible} onClose={onClose} title={`${verb} & Disburse`}>
      <Txt style={{ fontSize: 11.5, color: C.muted, fontWeight: "600", marginVertical: 8 }}>
        {l.loanNumber} · {withheld > 0 ? `${inr(l.principalAmount)} less ${inr(withheld)} service charge` : "Principal"} paid out to the customer
      </Txt>
      <ResultBox k="Amount to disburse" v={inr(payout)} />
      <Field label="Payment breakdown">
        <PaymentSplit amount={payout} value={split} onChange={setSplit} />
      </Field>
      <ErrorText>{error}</ErrorText>
      <PrimaryButton label={`${verb} & Disburse ${inr(payout)}`} onPress={() => onConfirm(split)} loading={loading} disabled={!isBalanced(split, payout)} />
    </Sheet>
  );
}
