import React, { useEffect, useState } from "react";
import { BRAND } from "@/common/config/brand";
import { View, StyleSheet, NativeModules } from "react-native";
import RazorpayCheckout from "react-native-razorpay";
import { BottomSheetModal } from "@/common/components/ui/BottomSheetModal";
import { ThemedText } from "@/common/components/ui/ThemedText";
import { GoldTextInput } from "@/common/components/ui/GoldTextInput";
import { GoldButton } from "@/common/components/ui/GoldButton";
import { RazorpayWebCheckout, RazorpayWebCheckoutOptions } from "./RazorpayWebCheckout";
import { colors } from "@/common/theme/colors";
import * as paymentsApi from "@/modules/payments/services/paymentService";
import { RazorpayPaymentType } from "@/modules/payments/services/paymentService";
import { Loan } from "@/modules/loans/services/loanService";
import { ApiError } from "@/common/services/httpClient";

// Detect native checkout module at runtime; falls back to WebView checkout (RazorpayWebCheckout.tsx) in Expo Go.
const RAZORPAY_NATIVE_AVAILABLE = !!NativeModules.RNRazorpayCheckout;

function money(n: number | undefined | null): string {
  return `₹${(n ?? 0).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
}

// Paise-safe equality: avoids float rounding false negatives from a direct ===.
function amountsEqual(a: number, b: number): boolean {
  return Math.round(a * 100) === Math.round(b * 100);
}

// Picks the backend allocation type by exact-match amount; the server-side waterfall decides where money actually goes.
function inferPaymentType(amount: number, interestDue: number, settlementAmount: number): RazorpayPaymentType {
  if (amountsEqual(amount, interestDue)) return "Interest";
  if (amountsEqual(amount, settlementAmount)) return "FullSettlement";
  return "Partial";
}

type PaySheetProps = {
  visible: boolean;
  onClose: () => void;
  loan: Loan;
  onPaid: () => void;
};

// Shared by Loan Detail and the Payments tab; amount is always typed by hand, no quick-select chips.
export function PaySheet({
  visible,
  onClose,
  loan,
  onPaid,
}: PaySheetProps) {
  const [amount, setAmount] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null);

  // Holds payment details to verify later, since the WebView fallback reports success via a separate callback.
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

  async function verifyAndFinish(orderId: string, paymentId: string, signature: string, paidAmount: number, type: RazorpayPaymentType) {
    await paymentsApi.verifyPayment(loan.id, { orderId, paymentId, signature, amount: paidAmount, type });
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
      // A cancelled/failed Razorpay checkout rejects with { code, description } rather than an ApiError.
      const description = err && typeof err === "object" && "description" in err ? String((err as any).description) : undefined;
      setMessage({
        text: err instanceof ApiError ? err.message : description || "Payment could not be completed.",
        error: true,
      });
    } finally {
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

type RowProps = { label: string; value: string };

function Row({ label, value }: RowProps) {
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
