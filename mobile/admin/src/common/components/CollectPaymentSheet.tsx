import React, { useEffect, useRef, useState } from "react";
import { View } from "react-native";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { C, ConfirmSheet, DateField, Field, FieldRow, Input, PrimaryButton, Sheet, ThemeDropdown, Txt, toast } from "@/common/components/ui";
import { SplitPaymentInput, type SplitPayment } from "@/common/components/SplitPaymentInput";
import { recordPayment } from "@/modules/loans/services/paymentService";
import { getLoan } from "@/modules/loans/services/loanService";
import { useAuth } from "@/common/providers/AuthProvider";
import { dmy, inr, todayISO } from "@/common/utils/format";
import type { Loan } from "@/modules/loans/types/loan-types";
import { PAYMENT_TYPES, PAYMENT_TYPE_LABELS, apiErr, invalidateLoan, type PaymentType } from "./loanSheetKit";

type DiscountKind = "customer" | "interest" | "penal_interest";
const DISCOUNT_KINDS: DiscountKind[] = ["customer", "interest", "penal_interest"];
const DISCOUNT_KIND_LABELS: Record<DiscountKind, string> = { customer: "Custom discount", interest: "Interest", penal_interest: "Penal interest" };
import { FieldErr } from "./ErrorText";

// Interest / amount prefills are accrued figures with long decimals — show
// them to the paisa.
const money = (v: number) => (v > 0 ? String(Math.round(v * 100) / 100) : "");

// Amount a payment type normally settles. The server pays fee, penal, interest, then principal, so each type
// prefills everything that sits ahead of its own bucket (same as the web PaymentModal's amountForMode).
function autoAmount(l: Loan, t: PaymentType) {
  const fee = l.outstandingProcessingFee ?? 0;
  const penal = l.outstandingPenalInterest ?? 0;
  const interest = l.outstandingInterest ?? 0;
  const principal = l.outstandingAmount ?? 0;
  const v =
    t === "Partial"
      ? l.settlementAmount ?? fee + penal + interest + principal
      : t === "Interest"
        ? fee + penal + interest
        : t === "Penal Interest"
          ? fee + penal
          : t === "Principal"
            ? fee + principal
            : t === "Full Settlement"
              ? l.settlementAmount ?? l.totalOutstandingBalance
              : undefined;
  return v != null ? money(v) : "";
}

// Where an amount lands, fee first then penal, interest, principal; mirrors the web PaymentModal's previewAllocation
// (the server stays the authority). Shown on the confirm step so staff see the split before it is recorded.
function previewAllocation(l: Loan, t: PaymentType, feeOwed: number, amount: number) {
  if (t === "Full Settlement") {
    return { fee: feeOwed, penal: l.outstandingPenalInterest ?? 0, interest: l.outstandingInterest ?? 0, principal: l.outstandingAmount ?? 0 };
  }
  let left = amount;
  const take = (owed: number, allowed: boolean) => {
    if (!allowed) return 0;
    const n = Math.min(left, Math.max(0, owed));
    left -= n;
    return n;
  };
  const fee = take(feeOwed, true);
  const penal = take(l.outstandingPenalInterest ?? 0, t !== "Principal");
  const interest = take(l.outstandingInterest ?? 0, t === "Partial" || t === "Interest");
  const principal = take(l.outstandingAmount ?? 0, t === "Partial" || t === "Principal");
  return { fee, penal, interest, principal };
}

type CollectPaymentSheetProps = { loan: Loan; visible: boolean; onClose: () => void };

/** Prototype #act-collect — record an EMI / part payment with a mode split. */
export function CollectPaymentSheet({ loan: l, visible, onClose }: CollectPaymentSheetProps) {
  const qc = useQueryClient();
  const canDiscount = useAuth().can("Loan_Management", "can_give_discount");
  // A negotiated reduction with no cash movement, saved as its own Discount ledger entry. Amount stays what the
  // customer actually pays; Amount + Discount clears the loan.
  const [discount, setDiscount] = useState("");
  const [discountReason, setDiscountReason] = useState("");
  const discountMode = "Cash"; // a discount moves no money; the ledger shows it under Cash
  // what the discount is given against: a customer discount, or interest / penal interest only
  const [discountKind, setDiscountKind] = useState<DiscountKind>("customer");
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
  const [tried, setTried] = useState(false);
  // Record Payment never posts straight away: Review opens a summary and only its Confirm records the payment.
  const [confirming, setConfirming] = useState(false);

  // Fresh form each time the sheet opens.
  useEffect(() => {
    if (!visible) return;
    const a = autoAmount(l, "Interest");
    setType("Interest");
    setAmount(a);
    setOpenKey((k) => k + 1);
    setDate(todayISO());
    setCharge("");
    setDiscount("");
    amountTouched.current = false;
    setDiscountReason("");
    setDiscountKind("customer");
    setTried(false);
    setConfirming(false);
    interestTouched.current = false;
    setInterest(money(l.outstandingInterest ?? 0));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  // The loan handed in can be a whole accrual cycle old (opened from a list). Refetch on open so the prefilled
  // interest and amount are what is owed now; skipped for any field staff have already typed in.
  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    getLoan(l.id)
      .then((fresh) => {
        if (cancelled) return;
        if (!interestTouched.current) setInterest(money(fresh.outstandingInterest ?? 0));
        if (!amountTouched.current) setAmount(autoAmount(fresh, "Interest"));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
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
  const discountAmt = canDiscount && Number(discount) > 0 ? Number(discount) : 0;
  const discountMissingReason = discountAmt > 0 && !discountReason.trim();
  const errs: Record<string, string> = {};
  if (!(amt > 0)) errs.amount = "Enter an amount greater than zero.";
  else if (overSettle) errs.amount = `More than the full settlement — only ${inr(settleOwed)} is owed.`;
  if (!date) errs.date = "Pick the payment date.";
  if (discountMissingReason) errs.reason = "Enter the discount reason.";
  if (amt > 0 && !breakdown?.ready) errs.pay = "The payment breakdown must add up to the amount, with a bank for every UPI / Bank Transfer line.";
  const fe = (k: string) => (tried ? errs[k] : undefined);
  // The Amount field is prefilled with what the type clears minus the discount, until staff type their own.
  const amountTouched = useRef(false);
  const refillAmount = (t: PaymentType, d: number) => {
    const base = Number(autoAmount(l, t));
    if (!(base > 0)) return;
    setAmount(money(Math.max(0, Math.round((base - d) * 100) / 100)));
  };
  const pay = useMutation({
    mutationFn: () =>
      recordPayment(l.id, {
        amount: amt,
        type,
        processingFee: chargeAmt || undefined,
        paidOn: date,
        ...(discountAmt > 0 ? { discount: discountAmt, discountReason: discountReason.trim(), discountMode, discountKind } : {}),
        ...(breakdown?.split ?? {}),
        bankId: breakdown?.bankId,
        // Only a hand-edited interest is sent as an override. The untouched prefill may be stale (and is
        // pre-discount), so the server works the interest out itself.
        interestOverride: interest.trim() && interestTouched.current ? Number(interest) : undefined,
      }),
    onSuccess: () => {
      setConfirming(false);
      invalidateLoan(qc, l.id);
      onClose();
    },
    onError: (e) => {
      setConfirming(false);
      toast.error(apiErr(e, "Could not record the payment — try again."));
    },
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
            amountTouched.current = false;
            setAmount(autoAmount(l, t));
            if (discountAmt > 0) refillAmount(t, discountAmt);
          }}
        />
      </Field>
      <FieldRow>
        <Field label="Amount">
          <Input
            keyboardType="decimal-pad"
            value={amount}
            onChangeText={(v) => {
              amountTouched.current = true;
              setAmount(v);
            }}
            placeholder="0"
          />
        </Field>
        <DateField label="Payment date" value={date} onChange={setDate} min={l.openedDate?.slice(0, 10) || undefined} max={todayISO()} />
      </FieldRow>
      <FieldErr m={fe("amount") ?? fe("date")} />
      {canDiscount ? (
        <>
          <FieldRow>
            <Field label="Discount type">
              <ThemeDropdown
                value={discountKind}
                options={DISCOUNT_KINDS}
                labelOf={(k) => DISCOUNT_KIND_LABELS[k]}
                onChange={(k) => {
                  // choosing what the discount is for fills it with what is still owed of that part
                  setDiscountKind(k);
                  const owed = k === "interest" ? (l.outstandingInterest ?? 0) : k === "penal_interest" ? (l.outstandingPenalInterest ?? 0) : 0;
                  const next = owed > 0 ? String(Math.round(owed * 100) / 100) : "";
                  setDiscount(next);
                  if (!amountTouched.current) refillAmount(type, Number(next) > 0 ? Number(next) : 0);
                }}
              />
            </Field>
            <Field label="Discount (₹)">
              <Input
                keyboardType="decimal-pad"
                value={discount}
                onChangeText={(v) => {
                  setDiscount(v);
                  if (!amountTouched.current) refillAmount(type, Number(v) > 0 ? Number(v) : 0);
                }}
                placeholder="optional"
              />
            </Field>
          </FieldRow>
          {discountAmt > 0 ? (
            <>
              <Field label="Discount reason *">
                <Input value={discountReason} onChangeText={setDiscountReason} placeholder="e.g. loyal customer, hardship, rounding off" maxLength={200} />
              </Field>
              <FieldErr m={fe("reason")} />
              <Txt style={{ fontSize: 11, color: C.muted, marginBottom: 12 }}>
                Pays {inr(typedAmt)} + Discount {inr(discountAmt)} = {inr(typedAmt + discountAmt)} cleared on the loan.
              </Txt>
            </>
          ) : null}
        </>
      ) : null}
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
      {/* Payment summary: what is owed, what this payment clears and what is left. Charges settle the fee bucket, not the loan. */}
      {(() => {
        const owed = l.totalOutstandingBalance ?? l.outstandingAmount ?? 0;
        const after = Math.max(0, Math.round((owed - typedAmt - discountAmt) * 100) / 100);
        const rows: [string, string, boolean?][] = [
          ["Outstanding", inr(owed)],
          ["This payment", inr(typedAmt)],
          ...(discountAmt > 0 ? ([["Discount", inr(discountAmt)]] as [string, string][]) : []),
          ["Balance after payment", inr(after), true],
        ];
        return (
          <View style={{ backgroundColor: C.card, borderColor: C.line, borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 8, marginBottom: 12 }}>
            {rows.map(([k, v, strong]) => (
              <View key={k} style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 3 }}>
                <Txt style={{ flex: 1, flexShrink: 1, paddingRight: 12, fontSize: 12.5, color: strong ? C.ink : C.muted, fontWeight: strong ? "700" : "500" }}>{k}</Txt>
                <Txt style={{ flexShrink: 0, textAlign: "right", fontSize: 12.5, fontWeight: strong ? "700" : "600" }}>{v}</Txt>
              </View>
            ))}
          </View>
        );
      })()}
      <View style={{ marginBottom: 12 }}>
        <SplitPaymentInput key={openKey} total={amt} onChange={setBreakdown} />
      </View>
      <FieldErr m={fe("pay")} />
      <PrimaryButton
        label={amt > 0 ? `Review ${inr(amt)}` : "Review Payment"}
        onPress={() => {
          if (Object.keys(errs).length) return setTried(true);
          setConfirming(true);
        }}
      />
      {(() => {
        const alloc = previewAllocation(l, type, (l.outstandingProcessingFee ?? 0) + chargeAmt, amt + discountAmt);
        const applied: [string, number][] = [
          ["Penal interest", alloc.penal],
          ["Interest", alloc.interest],
          ["Additional charges", alloc.fee],
          ["Principal", alloc.principal],
        ];
        const paidBy: [string, number][] = breakdown
          ? [
              ["Cash", breakdown.split.cashAmount],
              ["UPI", breakdown.split.upiAmount],
              ["Bank Transfer", breakdown.split.bankTransferAmount],
            ]
          : [];
        const row = (k: string, v: string, strong?: boolean) => (
          <View key={k} style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 3 }}>
            <Txt style={{ flex: 1, flexShrink: 1, paddingRight: 12, fontSize: 12.5, color: strong ? C.ink : C.muted, fontWeight: strong ? "700" : "500" }}>{k}</Txt>
            <Txt style={{ flexShrink: 0, textAlign: "right", fontSize: 12.5, fontWeight: strong ? "700" : "600" }}>{v}</Txt>
          </View>
        );
        return (
          <ConfirmSheet
            visible={confirming}
            onClose={() => !pay.isPending && setConfirming(false)}
            title="Confirm Payment"
            confirmLabel="Confirm Payment"
            loading={pay.isPending}
            onConfirm={() => pay.mutate()}
            message={
              <View>
                <Txt style={{ fontSize: 12.5, color: C.muted, textAlign: "center" }}>Amount to be paid</Txt>
                <Txt style={{ fontSize: 24, fontWeight: "700", textAlign: "center" }}>{inr(amt)}</Txt>
                <Txt style={{ fontSize: 12, color: C.muted, textAlign: "center", marginBottom: 10 }}>{l.loanNumber}</Txt>
                {row("Apply payment to", PAYMENT_TYPE_LABELS[type])}
                {row("Payment date", dmy(date))}
                {paidBy.filter(([, v]) => v > 0.001).map(([k, v]) => row(`Paid by ${k}`, inr(v)))}
                <Txt style={{ fontSize: 12, color: C.muted, marginTop: 8 }}>Applied as</Txt>
                {applied.filter(([, v]) => v > 0.001).map(([k, v]) => row(k, inr(v)))}
                {discountAmt > 0 ? row("Discount", inr(discountAmt)) : null}
                {row("Amount paying", inr(amt), true)}
                {discountAmt > 0 ? row("Total cleared on the loan", inr(amt + discountAmt)) : null}
              </View>
            }
          />
        );
      })()}
    </Sheet>
  );
}
