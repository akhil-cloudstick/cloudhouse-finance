import React, { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AccBtn, DateField, Field, Input, NoticeBanner, PaymentSplit, PrimaryButton, ResultBox, Sheet, TextField, Txt, C, ZERO_SPLIT, isBalanced, toast, type SplitAmounts } from "../../ui";
import { topUpLoan } from "../../../api/loans";
import { inr, todayISO } from "../../../lib/format";
import type { Loan } from "../../../types/loan";
import { ErrorText, apiErr, invalidateLoan } from "./common";

/** Loans that can take a top-up — mirrors the backend's TopUpLoan guard. */
export const TOP_UP_STATUSES = ["Active", "Due Soon", "Overdue"];

/** Top Up Loan — same fields and rules as the web TopUpLoanModal: the
 * available headroom (eligible − outstanding), the top-up amount (capped at
 * the headroom), a payment breakdown that must add up, an optional
 * reference, plus the entry date the backend accepts (occurredOn). A
 * shortfall points staff to Edit Loan to add ornaments. */
export function TopUpSheet({ loan: l, visible, onClose, onAddOrnaments }: { loan: Loan; visible: boolean; onClose: () => void; onAddOrnaments?: () => void }) {
  const qc = useQueryClient();
  const [amount, setAmount] = useState("");
  const [split, setSplit] = useState<SplitAmounts>(ZERO_SPLIT);
  const [date, setDate] = useState(todayISO());
  const [reference, setReference] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [shortfall, setShortfall] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setAmount("");
    setSplit(ZERO_SPLIT);
    setDate(todayISO());
    setReference("");
    setError(null);
    setShortfall(false);
  }, [visible]);

  const eligible = l.eligibleLoanAmount ?? 0;
  const outstanding = l.outstandingAmount ?? 0;
  const headroom = Math.max(0, Math.round((eligible - outstanding) * 100) / 100);
  const amt = Number(amount) || 0;
  const over = amt > headroom + 0.01;

  const save = useMutation({
    mutationFn: () =>
      topUpLoan(l.id, {
        amount: amt,
        ...split,
        occurredOn: date || undefined,
        reference: reference.trim() || undefined,
      }),
    onSuccess: () => {
      invalidateLoan(qc, l.id);
      toast.success("Loan topped up", `${inr(amt)} added to ${l.loanNumber}`);
      onClose();
    },
    onError: (e) => {
      const msg = apiErr(e, "Could not record the top-up — try again.");
      setShortfall(/headroom/i.test(msg));
      setError(msg);
    },
  });

  function changeAmount(v: string) {
    setAmount(v);
    setSplit({ ...ZERO_SPLIT, cashAmount: Number(v) || 0 });
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
      <Field label="Top-up amount (₹) *">
        <Input keyboardType="decimal-pad" value={amount} onChangeText={changeAmount} placeholder="e.g. 5000" style={over ? { borderColor: C.red } : undefined} />
        {over ? <Txt style={{ fontSize: 11, color: C.red, marginTop: 4 }}>Can&apos;t exceed the headroom of {inr(headroom)}.</Txt> : null}
      </Field>
      <DateField label="Top-up date" value={date} onChange={setDate} max={todayISO()} />
      <Field label="Payment breakdown">
        <PaymentSplit amount={amt} value={split} onChange={setSplit} />
      </Field>
      <TextField label="Reference" placeholder="Transaction / cheque reference (optional)" value={reference} onChangeText={(v) => setReference(v.slice(0, 80))} />
      {shortfall && onAddOrnaments ? <AccBtn label="Add ornaments to raise the eligible amount" onPress={onAddOrnaments} style={{ marginBottom: 12 }} /> : null}
      <ErrorText>{error}</ErrorText>
      <PrimaryButton
        label="Top Up"
        onPress={() => {
          setError(null);
          save.mutate();
        }}
        loading={save.isPending}
        disabled={!(amt > 0) || over || !isBalanced(split, amt)}
      />
    </Sheet>
  );
}
