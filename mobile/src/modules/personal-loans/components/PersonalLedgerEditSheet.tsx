import React, { useEffect, useState } from "react";
import { View } from "react-native";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { DateField, Field, FieldRow, Input } from "@/common/components/ui";
import { LedgerEditShell } from "@/common/components/LedgerEditShell";
import { SplitPaymentInput, type SplitPayment } from "@/common/components/SplitPaymentInput";
import { apiErr } from "@/common/components/loanSheetKit";
import { deletePersonalLoanPayment, editPersonalLoanDisbursement, editPersonalLoanPayment, type PersonalLedgerEditPreview } from "@/modules/personal-loans/services/personalLoanService";
import { inr, todayISO } from "@/common/utils/format";
import type { PersonalLoanPayment } from "@/modules/personal-loans/types/personal-loan-types";

type Props = {
  loanId: number;
  /** A payment row (its amount already the whole payment's), or the disbursement row. */
  entry: PersonalLoanPayment | null;
  /** The bank of the entry's UPI / Bank Transfer part (it may sit on a sibling row of a split payment). */
  bankId?: number | null;
  minDate?: string;
  mode: "edit" | "delete";
  onClose: () => void;
};

/** Edit or delete a personal-loan payment, or edit its disbursement (date + payout breakdown). Two steps like the
 * gold-loan ledger edit: the first press previews the effect on the loan, the second saves. */
export function PersonalLedgerEditSheet({ loanId, entry: p, bankId: savedBankId, minDate, mode, onClose }: Props) {
  const qc = useQueryClient();
  const isDisbursement = p?.kind === "disbursement";
  const [date, setDate] = useState(todayISO());
  const [amount, setAmount] = useState("");
  const [reference, setReference] = useState("");
  const [pay, setPay] = useState<SplitPayment | null>(null);
  const [preview, setPreview] = useState<PersonalLedgerEditPreview | null>(null);
  const [error, setError] = useState<string | null>(null);

  const splitSum = p ? (p.cashAmount ?? 0) + (p.upiAmount ?? 0) + (p.bankTransferAmount ?? 0) : 0;
  // A disbursement's amount is fixed: use the whole payout (its split), not one mode-share row.
  const fixedAmount = isDisbursement && splitSum > 0 ? splitSum : p?.amount ?? 0;

  useEffect(() => {
    if (!p) return;
    setDate((p.date || p.paidOn || todayISO()).slice(0, 10));
    setAmount(String(p.amount));
    setReference(p.reference ?? "");
    setPreview(null);
    setError(null);
  }, [p]);

  const touch = <T,>(set: (v: T) => void) => (v: T) => {
    setPreview(null);
    setError(null);
    set(v);
  };

  const total = isDisbursement ? fixedAmount : Number(amount) || 0;

  const run = useMutation({
    mutationFn: async (dry: boolean) => {
      if (!p) throw new Error("No entry");
      if (mode === "delete") return deletePersonalLoanPayment(loanId, p.id, dry);
      if (!(total > 0)) throw new Error("Enter a valid amount.");
      if (!pay?.ready) throw new Error(`The payment breakdown must add up to the amount (${inr(total)}) and every UPI / Bank Transfer line needs its bank.`);
      const breakdown = { ...pay.split, chequeAmount: 0, bankId: pay.bankId };
      return isDisbursement
        ? editPersonalLoanDisbursement(loanId, { disbursedAt: date, ...breakdown }, dry)
        : editPersonalLoanPayment(loanId, p.id, { paidOn: date, amount: total, ...breakdown, reference }, dry);
    },
    onSuccess: (res, dry) => {
      if (dry) {
        setPreview(res);
        setError(null);
        return;
      }
      qc.invalidateQueries({ queryKey: ["personalLoan", String(loanId)] });
      qc.invalidateQueries({ queryKey: ["personalLoanPayments", loanId] });
      qc.invalidateQueries({ queryKey: ["personalLoanSchedule", loanId] });
      qc.invalidateQueries({ queryKey: ["personalLoans"] });
      qc.invalidateQueries({ queryKey: ["ledger"] });
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
        <DateField label="Date" value={date} onChange={touch(setDate)} min={isDisbursement ? undefined : minDate} max={todayISO()} />
        {isDisbursement ? (
          <Field label="Amount (₹)">
            <Input value={String(fixedAmount)} editable={false} />
          </Field>
        ) : (
          <Field label="Amount (₹)">
            <Input keyboardType="decimal-pad" value={amount} onChangeText={touch(setAmount)} />
          </Field>
        )}
      </FieldRow>
      {!isDisbursement ? (
        <Field label="Reference">
          <Input value={reference} onChangeText={touch(setReference)} />
        </Field>
      ) : null}
      <View style={{ marginBottom: 12 }}>
        <SplitPaymentInput
          key={p.key ?? p.id}
          total={total}
          bankLabel={isDisbursement ? "Bank (account it was paid from)" : undefined}
          initial={{ split: { cashAmount: p.cashAmount ?? 0, upiAmount: p.upiAmount ?? 0, bankTransferAmount: p.bankTransferAmount ?? 0, chequeAmount: 0 }, bankId: savedBankId, bankName: p.bankName }}
          onChange={(v) => {
            setPreview(null);
            setPay(v);
          }}
        />
      </View>
    </>
  ) : null;

  return (
    <LedgerEditShell
      visible={!!p}
      onClose={onClose}
      title={`${mode === "delete" ? "Delete" : "Edit"} ${isDisbursement ? "disbursement" : "payment"} entry`}
      notice={
        isDisbursement
          ? "The disbursed amount is fixed; the date and how the money was paid out can be corrected. Its cash-ledger line is rewritten."
          : "The loan's balances, instalments and status are recalculated, and the cash ledger line is rewritten."
      }
      mode={mode}
      form={form}
      deleteText={`Delete the payment of ${inr(p?.amount ?? 0)} dated ${(p?.date || p?.paidOn || "").slice(0, 10)}? Its cash-ledger line is removed too.`}
      previewTitle="What changes on the loan"
      preview={
        preview
          ? [
              { label: "Outstanding", before: preview.before.outstanding, after: preview.after.outstanding, money: true },
              { label: "Total paid", before: preview.before.totalPaid, after: preview.after.totalPaid, money: true },
              { label: "Status", before: preview.before.status, after: preview.after.status },
            ]
          : null
      }
      error={error}
      busy={run.isPending}
      onSubmit={() => {
        setError(null);
        run.mutate(preview == null);
      }}
    />
  );
}
