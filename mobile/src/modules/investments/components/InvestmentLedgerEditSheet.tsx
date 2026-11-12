import React, { useEffect, useState } from "react";
import { View } from "react-native";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { DateField, Field, FieldRow, Input, Txt, C } from "@/common/components/ui";
import { LedgerEditShell, type PreviewRow } from "@/common/components/LedgerEditShell";
import { SplitPaymentInput, type SplitPayment } from "@/common/components/SplitPaymentInput";
import { apiErr } from "@/common/components/loanSheetKit";
import { deleteInvestmentLedgerEntry, editInvestmentLedgerEntry, type InvestmentLedgerEditPreview } from "@/modules/investments/services/investmentService";
import { inr, todayISO } from "@/common/utils/format";
import type { InvestmentLedgerRow } from "@/modules/investments/types/investment-types";

type Props = {
  investmentId: number;
  row: InvestmentLedgerRow | null;
  mode: "edit" | "delete";
  /** Live-accrual engine: shows the principal / interest outstanding rows in the preview. */
  live: boolean;
  /** The investment's start — an entry cannot be dated before it. */
  minDate?: string;
  onClose: () => void;
};

const KIND_LABEL: Record<string, string> = { opening: "opening deposit", deposit: "deposit", withdrawal: "withdrawal", payout: "payout" };

/** Edit or delete one investment ledger entry (opening deposit, deposit, withdrawal or payout). Two steps like the
 * gold-loan ledger edit: the first press previews the effect on the investment, the second saves. */
export function InvestmentLedgerEditSheet({ investmentId, row: r, mode, live, minDate, onClose }: Props) {
  const qc = useQueryClient();
  const kind = r?.entryKind || "deposit";
  const isWithdrawal = kind === "withdrawal";
  const isPayout = kind === "payout";
  const [date, setDate] = useState(todayISO());
  const [amount, setAmount] = useState("");
  const [principal, setPrincipal] = useState("");
  const [interest, setInterest] = useState("");
  const [reference, setReference] = useState("");
  const [pay, setPay] = useState<SplitPayment | null>(null);
  const [preview, setPreview] = useState<InvestmentLedgerEditPreview | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!r) return;
    setDate((r.date || todayISO()).slice(0, 10));
    setAmount(String(r.entryAmount ?? r.amount));
    setPrincipal(String(r.principalAmount ?? 0));
    setInterest(String(r.interestAmount ?? 0));
    setReference(r.reference ?? "");
    setPreview(null);
    setError(null);
  }, [r]);

  const touch = <T,>(set: (v: T) => void) => (v: T) => {
    setPreview(null);
    setError(null);
    set(v);
  };

  const fixedAmount = r?.entryAmount ?? r?.amount ?? 0;
  const total = isWithdrawal ? (Number(principal) || 0) + (Number(interest) || 0) : isPayout ? fixedAmount : Number(amount) || 0;

  const run = useMutation({
    mutationFn: async (dry: boolean) => {
      if (!r) throw new Error("No entry");
      if (mode === "delete") return deleteInvestmentLedgerEntry(investmentId, r.id, dry);
      if (!(total > 0)) throw new Error("Enter a valid amount.");
      if (!pay?.ready) throw new Error("Check breakdown and banks.");
      return editInvestmentLedgerEntry(
        investmentId,
        r.id,
        {
          occurredOn: new Date(date).toISOString(),
          ...(isWithdrawal ? { principalAmount: Number(principal) || 0, interestAmount: Number(interest) || 0 } : isPayout ? {} : { amount: Number(amount) }),
          ...(isPayout || kind === "opening" ? {} : { reference: reference.trim() }),
          ...pay.split,
          chequeAmount: 0,
          bankId: pay.bankId,
        },
        dry
      );
    },
    onSuccess: (res, dry) => {
      if (dry) {
        setPreview(res);
        setError(null);
        return;
      }
      qc.invalidateQueries({ queryKey: ["investment", String(investmentId)] });
      qc.invalidateQueries({ queryKey: ["investmentLedger", investmentId] });
      qc.invalidateQueries({ queryKey: ["investmentTransactions", investmentId] });
      qc.invalidateQueries({ queryKey: ["investmentSchedule", investmentId] });
      qc.invalidateQueries({ queryKey: ["investments"] });
      qc.invalidateQueries({ queryKey: ["ledger"] });
      onClose();
    },
    onError: (e) => {
      setPreview(null);
      setError(e instanceof Error && !("status" in e) ? e.message : apiErr(e, "Could not save the change — try again."));
    },
  });

  const rows = (p: InvestmentLedgerEditPreview): PreviewRow[] => [
    { label: "Principal invested", before: p.before.invested, after: p.after.invested, money: true },
    ...(live
      ? [
          { label: "Principal outstanding", before: p.before.outstandingPrincipal, after: p.after.outstandingPrincipal, money: true },
          { label: "Interest outstanding", before: p.before.outstandingInterest, after: p.after.outstandingInterest, money: true },
        ]
      : []),
    { label: "Interest paid", before: p.before.totalInterestPaid, after: p.after.totalInterestPaid, money: true },
    { label: "Payouts paid", before: p.before.paidPayouts, after: p.after.paidPayouts },
    { label: "Start date", before: (p.before.startDate ?? "").slice(0, 10), after: (p.after.startDate ?? "").slice(0, 10) },
    { label: "Maturity date", before: (p.before.maturityDate ?? "").slice(0, 10), after: (p.after.maturityDate ?? "").slice(0, 10) },
    { label: "Status", before: p.before.status, after: p.after.status },
  ];

  const form = r ? (
    <>
      <FieldRow>
        <DateField label="Date" value={date} onChange={touch(setDate)} min={kind === "opening" ? undefined : minDate} max={todayISO()} />
        {isWithdrawal ? null : isPayout ? (
          <Field label="Amount (₹)">
            <Input value={String(fixedAmount)} editable={false} />
          </Field>
        ) : (
          <Field label="Amount (₹)">
            <Input keyboardType="decimal-pad" value={amount} onChangeText={touch(setAmount)} />
          </Field>
        )}
      </FieldRow>
      {isWithdrawal ? (
        <FieldRow>
          <Field label="Principal (₹)">
            <Input keyboardType="decimal-pad" value={principal} onChangeText={touch(setPrincipal)} />
          </Field>
          <Field label="Interest (₹)">
            <Input keyboardType="decimal-pad" value={interest} onChangeText={touch(setInterest)} />
          </Field>
        </FieldRow>
      ) : null}
      {isPayout ? <Txt style={{ fontSize: 11.5, color: C.muted, marginBottom: 10 }}>The amount of a payout is fixed by the schedule. To change it, delete this entry and pay the payout again.</Txt> : null}
      {!isPayout && kind !== "opening" ? (
        <Field label="Reference">
          <Input value={reference} onChangeText={touch(setReference)} />
        </Field>
      ) : null}
      <View style={{ marginBottom: 12 }}>
        <SplitPaymentInput
          key={r.id}
          total={total}
          initial={{ split: { cashAmount: r.cashAmount ?? 0, upiAmount: r.upiAmount ?? 0, bankTransferAmount: r.bankTransferAmount ?? 0, chequeAmount: 0 }, bankId: r.bankId }}
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
      visible={!!r}
      onClose={onClose}
      title={`${mode === "delete" ? "Delete" : "Edit"} ${KIND_LABEL[kind] || "entry"}`}
      mode={mode}
      form={form}
      deleteText={`Delete the ${KIND_LABEL[kind] || "entry"} of ${inr(fixedAmount)} dated ${(r?.date ?? "").slice(0, 10)}? Its cash-ledger line is removed too.${isPayout ? " The payout goes back to Pending." : ""}`}
      previewTitle="What changes on the investment"
      preview={preview ? rows(preview) : null}
      error={error}
      busy={run.isPending}
      onSubmit={() => {
        setError(null);
        run.mutate(preview == null);
      }}
    />
  );
}
