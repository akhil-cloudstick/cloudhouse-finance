import React, { useEffect, useState } from "react";
import { BRAND } from "../config/brand";
import { View, StyleSheet, NativeModules } from "react-native";
import RazorpayCheckout from "react-native-razorpay";
import { BottomSheetModal } from "./BottomSheetModal";
import { ThemedText } from "./ThemedText";
import { GoldTextInput } from "./GoldTextInput";
import { GoldButton } from "./GoldButton";
import { RazorpayWebCheckout, RazorpayWebCheckoutOptions } from "./RazorpayWebCheckout";
import { colors } from "../theme/colors";
import * as paymentsApi from "../api/payments";
import { RazorpayPaymentType } from "../api/payments";
import { Loan } from "../api/loans";
import { ApiError } from "../api/client";

// `react-native-razorpay` needs a native module (RNRazorpayCheckout) that
// plain Expo Go doesn't have — it's only present in a custom dev-client
// build (`npx expo run:android`/`eas build --profile development`).
// Detecting it at runtime lets this screen work in BOTH environments
// without the customer needing to know which one they're running:
// Solution B (native checkout) when the module is linked, Solution A
// (Razorpay's own Web Checkout loaded in a WebView — see
// RazorpayWebCheckout.tsx, no native module required) as the Expo Go
// fallback.
const RAZORPAY_NATIVE_AVAILABLE = !!NativeModules.RNRazorpayCheckout;

function money(n: number | undefined | null): string {
  return `₹${(n ?? 0).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
}

// paise-safe equality check — amounts come from floats on both sides, so a
// direct === risks false negatives from rounding.
function amountsEqual(a: number, b: number): boolean {
  return Math.round(a * 100) === Math.round(b * 100);
}

// Infers the payment `type` sent to the backend purely to pick the right
// server-side waterfall (see backend/internal/loan/service.go's
// allocatePayment) — per the plan's exact-match rules: an amount exactly
// equal to outstanding interest+penal -> Interest; exactly equal to the
// settlement quote -> FullSettlement; anything else -> Partial. The
// allocation waterfall itself decides where the money actually goes.
function inferPaymentType(amount: number, interestDue: number, settlementAmount: number): RazorpayPaymentType {
  if (amountsEqual(amount, interestDue)) return "Interest";
  if (amountsEqual(amount, settlementAmount)) return "FullSettlement";
  return "Partial";
}

// Shared "Pay" bottom sheet used by both Loan Detail (app/(tabs)/loans/[id].tsx) and
// the Payments tab (app/(tabs)/payments.tsx) — per the plan's DRY note. The
// customer always types the amount by hand (no quick-select chips); the
// outstanding-interest/total-outstanding lines are informational only.
export function PaySheet({
  visible,
  onClose,
  loan,
  onPaid,
}: {
  visible: boolean;
  onClose: () => void;
  loan: Loan;
  onPaid: () => void;
}) {
  const [amount, setAmount] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null);

  // Solution A's pending state — set only when falling back to the WebView
  // checkout (native module unavailable). Holds what's needed to verify
  // once the WebView reports success, since that happens on a later,
  // separate turn (a modal callback), not inline in submit()'s try block
  // the way the native path's awaited RazorpayCheckout.open() does.
  const [webCheckoutOptions, setWebCheckoutOptions] = useState<RazorpayWebCheckoutOptions | null>(null);
  const [pendingPayment, setPendingPayment] = useState<{ orderId: string; amount: number; type: RazorpayPaymentType } | null>(null);

  useEffect(() => {
    if (visible) {
      setAmount("");
      setMessage(null);
      setWebCheckoutOptions(null);
      setPendingPayment(null);
    }
  }, [visible]);

  const interestDue = (loan.outstandingInterest ?? 0) + (loan.outstandingPenalInterest ?? 0);
  const totalOutstanding = loan.totalOutstandingBalance ?? loan.outstandingAmount;
  const settlementAmount = loan.settlementAmount ?? totalOutstanding;
  const parsedAmount = Number(amount);
  const isValid = amount !== "" && parsedAmount > 0 && parsedAmount <= totalOutstanding;

  // Shared by both paths: verifies the checkout signature server-side and,
  // only on success, shows the confirmation and closes the sheet.
  async function verifyAndFinish(orderId: string, paymentId: string, signature: string, paidAmount: number, type: RazorpayPaymentType) {
    await paymentsApi.verifyPayment(loan.id, { orderId, paymentId, signature, amount: paidAmount, type });
    // Closes immediately rather than showing "Payment successful." for a
    // beat first (was a 900ms, then a 400ms, artificial delay on top of the
    // verifyPayment() await above, which is already a real network round
    // trip) — by the time this line runs the payment is genuinely confirmed
    // server-side, so there's nothing left to wait on. onPaid() refreshes
    // the underlying screen, which is where the customer sees the result.
    onClose();
    onPaid();
  }

  async function submit() {
    if (!isValid) return;
    setSubmitting(true);
    setMessage(null);
    try {
      const type = inferPaymentType(parsedAmount, interestDue, settlementAmount);
      const order = await paymentsApi.createOrder(loan.id, { amount: parsedAmount, type });

      if (!RAZORPAY_NATIVE_AVAILABLE) {
        // Solution A: hand off to the WebView checkout modal — it takes
        // over from here and calls back via handleWebCheckout*() below, not
        // this function.
        setPendingPayment({ orderId: order.orderId, amount: parsedAmount, type });
        setWebCheckoutOptions({
          key: order.keyId,
          order_id: order.orderId,
          amount: order.amount,
          currency: order.currency,
          name: BRAND.legalName,
          description: `Loan ${loan.loanNumber}`,
        });
        return;
      }

      // Solution B: native checkout (dev-client build only).
      const result = await RazorpayCheckout.open({
        key: order.keyId,
        order_id: order.orderId,
        amount: order.amount,
        currency: order.currency,
        name: BRAND.legalName,
        description: `Loan ${loan.loanNumber}`,
      });
      await verifyAndFinish(order.orderId, result.razorpay_payment_id, result.razorpay_signature, parsedAmount, type);
    } catch (err) {
      // A cancelled/failed Razorpay checkout rejects with { code,
      // description } rather than an ApiError.
      const description = err && typeof err === "object" && "description" in err ? String((err as any).description) : undefined;
      setMessage({
        text: err instanceof ApiError ? err.message : description || "Payment could not be completed.",
        error: true,
      });
    } finally {
      // Solution A's spinner is released by its own handlers below instead
      // (submit() returns early before this point in that branch, but the
      // finally still runs — setSubmitting(false) here is harmless since
      // the WebView modal, not the button, owns the UI at that point).
      setSubmitting(false);
    }
  }

  async function handleWebCheckoutSuccess(result: { razorpay_payment_id: string; razorpay_signature: string }) {
    setWebCheckoutOptions(null);
    if (!pendingPayment) return;
    setSubmitting(true);
    try {
      await verifyAndFinish(pendingPayment.orderId, result.razorpay_payment_id, result.razorpay_signature, pendingPayment.amount, pendingPayment.type);
    } catch (err) {
      setMessage({ text: err instanceof ApiError ? err.message : "Payment could not be verified.", error: true });
    } finally {
      setSubmitting(false);
      setPendingPayment(null);
    }
  }

  function handleWebCheckoutCancel() {
    setWebCheckoutOptions(null);
    setPendingPayment(null);
    // Previously silent — the customer just saw this same amount screen
    // reappear with no explanation at all, indistinguishable from the
    // payment having silently failed. Now explicit either way.
    setMessage({ text: "Payment cancelled.", error: true });
  }

  function handleWebCheckoutFailed(description: string) {
    setWebCheckoutOptions(null);
    setPendingPayment(null);
    setMessage({ text: description, error: true });
  }

  function handleWebCheckoutError(errorMessage: string) {
    setWebCheckoutOptions(null);
    setPendingPayment(null);
    setMessage({ text: errorMessage, error: true });
  }

  return (
    <BottomSheetModal visible={visible} onClose={onClose}>
      <ThemedText variant="h3" style={{ marginBottom: 12 }}>
        Pay
      </ThemedText>

      <View style={{ marginBottom: 14 }}>
        <Row label="Outstanding interest" value={money(interestDue)} />
        <Row label="Total outstanding" value={money(totalOutstanding)} />
      </View>

      <GoldTextInput
        label="Amount"
        value={amount}
        onChangeText={setAmount}
        keyboardType="number-pad"
        placeholder="₹"
      />
      <ThemedText variant="small" color={colors.muted} style={{ marginTop: -8, marginBottom: 14 }}>
        Max payable: {money(totalOutstanding)}
      </ThemedText>

      {message ? (
        <ThemedText variant="small" color={message.error ? colors.red : colors.green} style={{ marginBottom: 10 }}>
          {message.text}
        </ThemedText>
      ) : null}

      <GoldButton
        title={`Pay ${amount ? money(parsedAmount) : "₹—"}`}
        onPress={submit}
        loading={submitting}
        disabled={!isValid}
      />

      <RazorpayWebCheckout
        options={webCheckoutOptions}
        onSuccess={handleWebCheckoutSuccess}
        onCancel={handleWebCheckoutCancel}
        onFailed={handleWebCheckoutFailed}
        onError={handleWebCheckoutError}
      />
    </BottomSheetModal>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <ThemedText variant="small" color={colors.muted}>
        {label}
      </ThemedText>
      <ThemedText variant="body">{value}</ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 4,
  },
});
