import React, { useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { C, DateField, Field, FieldRow, Input, PaymentSplit, PrimaryButton, Sheet, TextField, ThemeDropdown, Txt, ZERO_SPLIT, isBalanced, type SplitAmounts } from "../../ui";
import { recordPayment } from "../../../api/payments";
import { inr, todayISO } from "../../../lib/format";
import type { Loan } from "../../../types/loan";
import { ErrorText, PAYMENT_TYPES, apiErr, invalidateLoan, type PaymentType } from "./common";

// Amount a payment type normally settles; undefined for types with no
// natural figure (Partial / Adjustment / Waiver).
function autoAmount(l: Loan, t: PaymentType) {
  const v =
    t === "Interest" ? l.outstandingInterest : t === "Principal" ? l.outstandingAmount : t === "Full Settlement" ? l.settlementAmount ?? l.totalOutstandingBalance : undefined;
  return v != null && v > 0 ? String(Math.round(v * 100) / 100) : "";
}

/** Prototype #act-collect — record an EMI / part payment with a mode split. */
export function CollectPaymentSheet({ loan: l, visible, onClose }: { loan: Loan; visible: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const [type, setType] = useState<PaymentType>("Interest");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(todayISO());
  // Prefilled with the live-calculated outstanding interest (matching the web
  // PaymentModal) — editable to charge a different amount, or cleared to fall
  // back to the system-calculated figure.
  const [interest, setInterest] = useState("");
  const interestTouched = useRef(false);
  const [reference, setReference] = useState("");
  const [description, setDescription] = useState("");
  const [split, setSplit] = useState<SplitAmounts>(ZERO_SPLIT);
  const [error, setError] = useState<string | null>(null);

  // Fresh form each time the sheet opens.
  useEffect(() => {
    if (!visible) return;
    const a = autoAmount(l, "Interest");
    setType("Interest");
    setAmount(a);
    setSplit({ ...ZERO_SPLIT, cashAmount: +a || 0 });
    setDate(todayISO());
    setReference("");
    setDescription("");
    setError(null);
    interestTouched.current = false;
    setInterest((l.outstandingInterest ?? 0) > 0 ? String(l.outstandingInterest) : "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  // Keep the interest prefill in sync with a refetched loan until staff type their own.
  useEffect(() => {
    const oi = l.outstandingInterest;
    if (oi != null && !interestTouched.current) setInterest(oi > 0 ? String(oi) : "");
  }, [l.outstandingInterest]);

  const amt = Number(amount) || 0;
  const pay = useMutation({
    mutationFn: () =>
      recordPayment(l.id, {
        amount: amt,
        type,
        paidOn: date,
        ...split,
        reference: reference.trim() || undefined,
        description: description.trim() || undefined,
        interestOverride: interest.trim() ? Number(interest) : undefined,
      }),
    onSuccess: () => {
      invalidateLoan(qc, l.id);
      onClose();
    },
    onError: (e) => setError(apiErr(e, "Could not record the payment — try again.")),
  });

  function changeAmount(v: string) {
    setAmount(v);
    setSplit({ ...ZERO_SPLIT, cashAmount: Number(v) || 0 });
  }

  return (
    <Sheet visible={visible} onClose={onClose} title="Collect Payment">
      <Txt style={{ fontSize: 11.5, color: C.muted, fontWeight: "600", marginVertical: 8 }}>
        {l.loanNumber} · Outstanding {inr(l.totalOutstandingBalance ?? l.outstandingAmount)}
      </Txt>
      <Field label="Type">
        <ThemeDropdown
          value={type}
          options={[...PAYMENT_TYPES]}
          labelOf={(t) => t}
          onChange={(t) => {
            setType(t);
            changeAmount(autoAmount(l, t));
          }}
        />
      </Field>
      <FieldRow>
        <Field label="Amount">
          <Input keyboardType="decimal-pad" value={amount} onChangeText={changeAmount} placeholder="0" />
        </Field>
        <DateField label="Payment date" value={date} onChange={setDate} max={todayISO()} />
      </FieldRow>
      <Field label="Interest (₹)">
        <Input
          keyboardType="decimal-pad"
          value={interest}
          onChangeText={(v) => {
            interestTouched.current = true;
            setInterest(v);
          }}
        />
        <Txt style={{ fontSize: 11, color: C.muted, marginTop: 4 }}>
          Outstanding interest {inr(l.outstandingInterest ?? 0)}
          {(l.outstandingPenalInterest ?? 0) > 0 ? ` · penal ${inr(l.outstandingPenalInterest)}` : ""} — leave blank to use the system figure.
        </Txt>
      </Field>
      <Field label="Payment breakdown">
        <PaymentSplit amount={amt} value={split} onChange={setSplit} />
      </Field>
      <TextField label="Reference" placeholder="Transaction / cheque reference (optional)" value={reference} onChangeText={setReference} />
      <TextField label="Description" placeholder="Add a note (optional)" value={description} onChangeText={setDescription} />
      <ErrorText>{error}</ErrorText>
      <PrimaryButton
        label="Confirm Payment"
        onPress={() => {
          setError(null);
          pay.mutate();
        }}
        loading={pay.isPending}
        disabled={!(amt > 0) || !date || !isBalanced(split, amt)}
      />
    </Sheet>
  );
}
