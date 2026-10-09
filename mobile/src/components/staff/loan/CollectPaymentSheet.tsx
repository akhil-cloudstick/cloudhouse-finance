import React, { useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AsyncSelect, C, DateField, Field, FieldRow, Input, PaymentSplit, PrimaryButton, Sheet, TextField, ThemeDropdown, Txt, ZERO_SPLIT, isBalanced, type SplitAmounts } from "../../ui";
import { recordPayment } from "../../../api/payments";
import { createBank, listBanksPage } from "../../../api/banks";
import type { Bank } from "../../../types/bank";
import { inr, todayISO } from "../../../lib/format";
import type { Loan } from "../../../types/loan";
import { useAuth } from "../../../auth/AuthContext";
import { ErrorText, PAYMENT_TYPES, PAYMENT_TYPE_LABELS, apiErr, invalidateLoan, type PaymentType } from "./common";

// Interest / amount prefills are accrued figures with long decimals — show
// them to the paisa.
const money = (v: number) => (v > 0 ? String(Math.round(v * 100) / 100) : "");

// Amount a payment type normally settles; undefined for types with no
// natural figure (Partial).
function autoAmount(l: Loan, t: PaymentType) {
  const v =
    t === "Interest"
      ? l.outstandingInterest
      : t === "Penal Interest"
        ? l.outstandingPenalInterest
        : t === "Principal"
          ? l.outstandingAmount
          : t === "Full Settlement"
            ? l.settlementAmount ?? l.totalOutstandingBalance
            : undefined;
  return v != null ? money(v) : "";
}

/** Prototype #act-collect — record an EMI / part payment with a mode split. */
export function CollectPaymentSheet({ loan: l, visible, onClose }: { loan: Loan; visible: boolean; onClose: () => void }) {
  const canCreateBank = useAuth().can("Bank_Management", "can_create_bank");
  const qc = useQueryClient();
  const [type, setType] = useState<PaymentType>("Interest");
  const [amount, setAmount] = useState("");
  // Additional Charges are collected ON TOP of Amount (the charge settles the
  // fee bucket instead of eating into the principal), same as web.
  const [charge, setCharge] = useState("");
  const [date, setDate] = useState(todayISO());
  // Prefilled with the live-calculated outstanding interest (matching the web
  // PaymentModal) — editable to charge a different amount, or cleared to fall
  // back to the system-calculated figure.
  const [interest, setInterest] = useState("");
  const interestTouched = useRef(false);
  const [reference, setReference] = useState("");
  const [description, setDescription] = useState("");
  const [split, setSplit] = useState<SplitAmounts>(ZERO_SPLIT);
  const [bank, setBank] = useState<Bank | null>(null);
  const [error, setError] = useState<string | null>(null);
  const bankRequired = split.upiAmount > 0 || split.bankTransferAmount > 0 || split.chequeAmount > 0;

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
    setCharge("");
    setBank(null);
    setError(null);
    interestTouched.current = false;
    setInterest(money(l.outstandingInterest ?? 0));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  // Keep the interest prefill in sync with a refetched loan until staff type their own.
  useEffect(() => {
    const oi = l.outstandingInterest;
    if (oi != null && !interestTouched.current) setInterest(money(oi));
  }, [l.outstandingInterest]);

  const typedAmt = Number(amount) || 0;
  const chargeAmt = Number(charge) > 0 ? Number(charge) : 0;
  // Total cash handed over: the loan amount plus the charge.
  const amt = typedAmt > 0 ? typedAmt + chargeAmt : 0;
  // Full Settlement is exactly what is owed — no more, no less.
  const settleOwed = (l.settlementAmount ?? l.totalOutstandingBalance ?? 0);
  const overSettle = type === "Full Settlement" && settleOwed > 0 && typedAmt > settleOwed + 0.01;
  const pay = useMutation({
    mutationFn: () =>
      recordPayment(l.id, {
        amount: amt,
        type,
        processingFee: chargeAmt || undefined,
        paidOn: date,
        ...split,
        bankId: bankRequired ? bank?.id : undefined,
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

  function changeAmount(v: string, c: string = charge) {
    setAmount(v);
    setSplit({ ...ZERO_SPLIT, cashAmount: (Number(v) > 0 ? Number(v) + (Number(c) > 0 ? Number(c) : 0) : 0) });
  }

  return (
    <Sheet visible={visible} onClose={onClose} title="Collect Payment">
      <Txt style={{ fontSize: 11.5, color: C.muted, fontWeight: "600", marginVertical: 8 }}>
        {l.loanNumber} · Outstanding {inr(l.totalOutstandingBalance ?? l.outstandingAmount)}
      </Txt>
      <Field label="Apply payment to">
        <ThemeDropdown
          value={type}
          options={[...PAYMENT_TYPES]}
          labelOf={(t) => PAYMENT_TYPE_LABELS[t]}
          onChange={(t) => {
            setType(t);
            changeAmount(autoAmount(l, t));
          }}
        />
      </Field>
      <FieldRow>
        <Field label="Amount">
          <Input keyboardType="decimal-pad" value={amount} onChangeText={(v) => changeAmount(v)} placeholder="0" />
        </Field>
        <DateField label="Payment date" value={date} onChange={setDate} max={todayISO()} />
      </FieldRow>
      <Field label="Additional Charges (₹)">
        <Input
          keyboardType="decimal-pad"
          value={charge}
          onChangeText={(v) => {
            setCharge(v);
            changeAmount(amount, v);
          }}
          placeholder="e.g. late fee — added on top of Amount"
        />
        {chargeAmt > 0 ? (
          <Txt style={{ fontSize: 11, color: C.muted, marginTop: 4 }}>Customer pays {inr(amt)} ({inr(typedAmt)} + {inr(chargeAmt)} charges)</Txt>
        ) : null}
      </Field>
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
      {bankRequired ? (
        <AsyncSelect<Bank>
          label="Bank"
          placeholder="Search or add a bank"
          queryKey={["banks", "picker"]}
          fetcher={async (q) => (await listBanksPage({ q: q || undefined, limit: 20, offset: 0 })).items ?? []}
          selectedLabel={bank?.name}
          onSelect={setBank}
          onClear={() => setBank(null)}
          keyOf={(b) => b.id}
          renderItem={(b) => ({ title: b.name })}
          onCreateNew={canCreateBank ? (name) => createBank({ name }) : undefined}
        />
      ) : null}
      <TextField label="Reference" placeholder="Transaction / cheque reference (optional)" value={reference} onChangeText={setReference} />
      <TextField label="Description" placeholder="Add a note (optional)" value={description} onChangeText={setDescription} />
      <ErrorText>{overSettle ? `More than the full settlement — only ${inr(settleOwed)} is owed.` : error}</ErrorText>
      <PrimaryButton
        label="Confirm Payment"
        onPress={() => {
          setError(null);
          pay.mutate();
        }}
        loading={pay.isPending}
        disabled={!(amt > 0) || overSettle || !date || !isBalanced(split, amt) || (bankRequired && !bank)}
      />
    </Sheet>
  );
}
