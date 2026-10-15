import React, { useEffect, useRef, useState } from "react";
import { View } from "react-native";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { C, DateField, Field, FieldRow, Input, PrimaryButton, Sheet, ThemeDropdown, Txt } from "@/common/components/ui";
import { SplitPaymentInput, type SplitPayment } from "@/common/components/SplitPaymentInput";
import { recordPayment } from "@/modules/loans/services/paymentService";
import { inr, todayISO } from "@/common/utils/format";
import type { Loan } from "@/modules/loans/types/loan-types";
import { PAYMENT_TYPES, PAYMENT_TYPE_LABELS, apiErr, invalidateLoan, type PaymentType } from "./loanSheetKit";
import { ErrorText } from "./ErrorText";

// Interest / amount prefills are accrued figures with long decimals — show
// them to the paisa.
const money = (v: number) => (v > 0 ? String(Math.round(v * 100) / 100) : "");

// Amount a payment type normally settles. "Both" (Partial) prefills interest + principal.
function autoAmount(l: Loan, t: PaymentType) {
  const v =
    t === "Partial"
      ? (l.outstandingInterest ?? 0) + (l.outstandingAmount ?? 0)
      : t === "Interest"
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

type CollectPaymentSheetProps = { loan: Loan; visible: boolean; onClose: () => void };

/** Prototype #act-collect — record an EMI / part payment with a mode split. */
export function CollectPaymentSheet({ loan: l, visible, onClose }: CollectPaymentSheetProps) {
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
  const [breakdown, setBreakdown] = useState<SplitPayment | null>(null);
  // Bumped on each open so the breakdown rows start fresh.
  const [openKey, setOpenKey] = useState(0);
  const [error, setError] = useState<string | null>(null);

  // Fresh form each time the sheet opens.
  useEffect(() => {
    if (!visible) return;
    const a = autoAmount(l, "Interest");
    setType("Interest");
    setAmount(a);
    setOpenKey((k) => k + 1);
    setDate(todayISO());
    setCharge("");
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
        ...(breakdown?.split ?? {}),
        bankId: breakdown?.bankId,
        interestOverride: interest.trim() ? Number(interest) : undefined,
      }),
    onSuccess: () => {
      invalidateLoan(qc, l.id);
      onClose();
    },
    onError: (e) => setError(apiErr(e, "Could not record the payment — try again.")),
  });

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
            setAmount(autoAmount(l, t));
          }}
        />
      </Field>
      <FieldRow>
        <Field label="Amount">
          <Input keyboardType="decimal-pad" value={amount} onChangeText={setAmount} placeholder="0" />
        </Field>
        <DateField label="Payment date" value={date} onChange={setDate} max={todayISO()} />
      </FieldRow>
      <FieldRow>
        <Field label="Additional Charges (₹)">
          <Input keyboardType="decimal-pad" value={charge} onChangeText={setCharge} placeholder="e.g. late fee" />
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
        </Field>
      </FieldRow>
      <Txt style={{ fontSize: 11, color: C.muted, marginBottom: 12 }}>
        {chargeAmt > 0 ? `Customer pays ${inr(amt)} (${inr(typedAmt)} + ${inr(chargeAmt)} charges). ` : "Charges are added on top of Amount. "}
        Leave interest blank to use the system figure{(l.outstandingPenalInterest ?? 0) > 0 ? ` (penal ${inr(l.outstandingPenalInterest)} outstanding)` : ""}.
      </Txt>
      <View style={{ marginBottom: 12 }}>
        <SplitPaymentInput key={openKey} total={amt} onChange={setBreakdown} />
      </View>
      <ErrorText>{overSettle ? `More than the full settlement — only ${inr(settleOwed)} is owed.` : error}</ErrorText>
      <PrimaryButton
        label="Confirm Payment"
        onPress={() => {
          setError(null);
          pay.mutate();
        }}
        loading={pay.isPending}
        disabled={!(amt > 0) || overSettle || !date || !breakdown?.ready}
      />
    </Sheet>
  );
}
