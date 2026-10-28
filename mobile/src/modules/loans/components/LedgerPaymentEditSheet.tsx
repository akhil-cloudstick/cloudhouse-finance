import React, { useEffect, useState } from "react";
import { Switch, View } from "react-native";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { C, DateField, Field, FieldRow, Input, ThemeDropdown, Txt } from "@/common/components/ui";
import { LedgerEditShell, loanPreviewRows } from "@/common/components/LedgerEditShell";
import { SplitPaymentInput, type SplitPayment } from "@/common/components/SplitPaymentInput";
import { apiErr, invalidateLoan } from "@/common/components/loanSheetKit";
import { deleteLedgerPayment, editLedgerPayment, type LedgerEditPreview } from "@/modules/loans/services/paymentService";
import { inr, todayISO } from "@/common/utils/format";
import type { Loan } from "@/modules/loans/types/loan-types";

type Payment = NonNullable<Loan["payments"]>[number];

const CASH_TYPES = ["Interest", "Penal Interest", "Principal", "Partial", "Full Settlement"];
const DISCOUNT_MODES = ["Cash", "UPI", "Bank Transfer", "Cheque"];

type Props = { loanId: number; loanStart?: string | null; payment: Payment | null; mode: "edit" | "delete"; onClose: () => void };

/** Edit or delete one payment / discount on the loan ledger. The server recalculates the whole loan from its
 * first day, so the first press only previews what would change (nothing is saved); the second press saves. When the
 * change reopens a closed loan the preview also asks whether the packet goes back to its previous status. */
export function LedgerPaymentEditSheet({ loanId, loanStart, payment: p, mode, onClose }: Props) {
  const qc = useQueryClient();
  const isDiscount = p?.type === "Discount";
  const [date, setDate] = useState(todayISO());
  const [type, setType] = useState("Interest");
  const [amount, setAmount] = useState("");
  const [reference, setReference] = useState("");
  const [discountReason, setDiscountReason] = useState("");
  const [discountMode, setDiscountMode] = useState("Cash");
  const [discountKind, setDiscountKind] = useState<"customer" | "interest" | "penal_interest">("customer");
  const [pay, setPay] = useState<SplitPayment | null>(null);
  const [reversePacket, setReversePacket] = useState(true);
  const [preview, setPreview] = useState<LedgerEditPreview | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Fresh form for whichever entry is opened.
  useEffect(() => {
    if (!p) return;
    setDate((p.paidOn || todayISO()).slice(0, 10));
    setType(p.type);
    setAmount(String(p.amount));
    setReference(p.reference ?? "");
    setDiscountReason((p.description ?? "").replace(/^Discount:\s*/, ""));
    setDiscountMode(DISCOUNT_MODES.includes(p.method ?? "") ? (p.method as string) : "Cash");
    setDiscountKind((p.discountKind as "customer" | "interest" | "penal_interest") || "customer");
    setReversePacket(true);
    setPreview(null);
    setError(null);
  }, [p]);

  // Any change makes the shown preview stale.
  const touch = <T,>(set: (v: T) => void) => (v: T) => {
    setPreview(null);
    setError(null);
    set(v);
  };

  const run = useMutation({
    mutationFn: async (dry: boolean) => {
      if (!p) throw new Error("No entry");
      const reverse = !dry && !!preview?.packet && reversePacket;
      if (mode === "delete") return deleteLedgerPayment(loanId, p.id, dry, undefined, reverse);
      const amt = Number(amount);
      if (!(amt > 0)) throw new Error("Enter a valid amount.");
      if (isDiscount) {
        if (!discountReason.trim()) throw new Error("A discount needs a reason.");
        return editLedgerPayment(loanId, p.id, { paidOn: date, amount: amt, discountReason: discountReason.trim(), discountMode, discountKind, ...(reverse ? { reversePacket: true } : {}) }, dry);
      }
      if (!pay?.ready) throw new Error(`The payment breakdown must add up to the amount (${inr(amt)}) and every UPI / Bank Transfer line needs its bank.`);
      return editLedgerPayment(
        loanId,
        p.id,
        { paidOn: date, amount: amt, type, cashAmount: pay.split.cashAmount, upiAmount: pay.split.upiAmount, bankTransferAmount: pay.split.bankTransferAmount, chequeAmount: 0, bankId: pay.bankId, reference, ...(reverse ? { reversePacket: true } : {}) },
        dry
      );
    },
    onSuccess: (res, dry) => {
      if (dry) {
        setPreview(res);
        setError(null);
        return;
      }
      invalidateLoan(qc, loanId);
      qc.invalidateQueries({ queryKey: ["loanLedgerCharges"] });
      qc.invalidateQueries({ queryKey: ["ledger"] });
      qc.invalidateQueries({ queryKey: ["packets"] });
      onClose();
    },
    onError: (e) => {
      setPreview(null);
      setError(e instanceof Error && !("status" in e) ? e.message : apiErr(e, "Could not save the change — try again."));
    },
  });

  const form = p ? (
    <>
      <FieldRow>
        <DateField label="Date" value={date} onChange={touch(setDate)} min={loanStart?.slice(0, 10) || undefined} max={todayISO()} />
        <Field label="Amount (₹)">
          <Input keyboardType="decimal-pad" value={amount} onChangeText={touch(setAmount)} />
        </Field>
      </FieldRow>
      {isDiscount ? (
        <>
          <Field label="Discount reason *">
            <Input value={discountReason} onChangeText={touch(setDiscountReason)} maxLength={200} />
          </Field>
          <Field label="Discount mode">
            <ThemeDropdown value={discountMode} options={DISCOUNT_MODES} labelOf={(m) => m} onChange={touch(setDiscountMode)} />
          </Field>
          <Field label="Discount type">
            <ThemeDropdown value={discountKind} options={["customer", "interest", "penal_interest"] as const} labelOf={(k) => (k === "customer" ? "Custom discount" : k === "interest" ? "Interest" : "Penal interest")} onChange={touch(setDiscountKind)} />
          </Field>
        </>
      ) : (
        <>
          <Field label="Apply payment to">
            <ThemeDropdown value={type} options={CASH_TYPES} labelOf={(t) => t} onChange={touch(setType)} />
          </Field>
          <Field label="Reference">
            <Input value={reference} onChangeText={touch(setReference)} />
          </Field>
          <View style={{ marginBottom: 12 }}>
            <SplitPaymentInput
              key={p.id}
              total={Number(amount) || 0}
              initial={{ split: { cashAmount: p.cashAmount ?? 0, upiAmount: p.upiAmount ?? 0, bankTransferAmount: p.bankTransferAmount ?? 0, chequeAmount: 0 }, bankId: p.bankId ?? undefined }}
              onChange={(v) => {
                setPreview(null);
                setPay(v);
              }}
            />
          </View>
        </>
      )}
    </>
  ) : null;

  const packetQuestion = preview?.packet ? (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 12 }}>
      <Switch value={reversePacket} onValueChange={setReversePacket} />
      <View style={{ flex: 1 }}>
        <Txt style={{ fontSize: 12.5 }}>
          This reopens the loan. Move packet <Txt style={{ fontWeight: "700" }}>{preview.packet.code}</Txt> back from{" "}
          <Txt style={{ fontWeight: "700" }}>{preview.packet.currentStatus}</Txt> to <Txt style={{ fontWeight: "700" }}>{preview.packet.previousStatus}</Txt>?
        </Txt>
        <Txt style={{ fontSize: 11.5, color: C.muted }}>Turn off to leave the packet as it is.</Txt>
      </View>
    </View>
  ) : null;

  return (
    <LedgerEditShell
      visible={!!p}
      onClose={onClose}
      title={`${mode === "delete" ? "Delete" : "Edit"} ${p?.type ?? ""} entry`}
      notice="The loan is recalculated from its first day, so interest, later payments, balances and the cash ledger update to match."
      mode={mode}
      form={form}
      deleteText={
        <>
          Delete the {p?.type} of {inr(p?.amount ?? 0)} dated {(p?.paidOn ?? "").slice(0, 10)}? Its cash-ledger line is removed too.
          {!isDiscount ? " A discount given with this payment is its own entry and has to be deleted separately." : ""}
        </>
      }
      previewTitle="What changes on the loan (as of its last entry)"
      preview={preview ? loanPreviewRows(preview) : null}
      extra={packetQuestion}
      error={error}
      busy={run.isPending}
      onSubmit={() => {
        setError(null);
        run.mutate(preview == null);
      }}
    />
  );
}
