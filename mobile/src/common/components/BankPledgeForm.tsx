import React, { useState } from "react";
import { AsyncSelect, ChipToggle, DateField, Field, FieldRow, Input, PrimaryButton, TextField } from "@/common/components/ui";
import { FieldErr } from "./ErrorText";
import { SplitPaymentInput, type SplitPayment } from "./SplitPaymentInput";
import { listLoansPage } from "@/modules/loans/services/loanService";
import { listBanksPage } from "@/modules/banks/services/bankService";
import { inr, todayISO } from "@/common/utils/format";
import type { Loan } from "@/modules/loans/types/loan-types";
import type { Bank } from "@/modules/banks/types/bank-types";

export type CashTreatment = "RecordOnly" | "CashIn";
const CASH = ["RecordOnly", "CashIn"] as const;
const CASH_LABELS = { RecordOnly: "Record only", CashIn: "Add to cash-in-hand" } as const;
const num = (v: string) => v.replace(/[^0-9.]/g, "");

export type BankPledgeFormValue = {
  loan: Loan | null;
  bankId?: number;
  bankName: string;
  amount: string;
  rate: string;
  pledgeDate: string;
  dueDate: string;
  reference: string;
  cash: CashTreatment;
  /** How a "CashIn" advance was received — set by the breakdown shown for that treatment. */
  payment?: SplitPayment;
};

export function bankPledgeFormInit(loan?: Loan | null): BankPledgeFormValue {
  return { loan: loan ?? null, bankId: undefined, bankName: "", amount: "", rate: "", pledgeDate: todayISO(), dueDate: "", reference: "", cash: "RecordOnly" };
}

type BankPledgeFormProps = {
  value: BankPledgeFormValue;
  onChange: (v: BankPledgeFormValue) => void;
  fixedLoan?: Loan;
  onSubmit: () => void;
  submitting: boolean;
  /** Extra gate from the caller (e.g. at least one ornament picked). */
  extraReady?: boolean;
};

// Shared re-pledge form; pass fixedLoan to hide the loan picker, otherwise AsyncSelect excludes already-pledged loans.
export function BankPledgeForm({
  value,
  onChange,
  fixedLoan,
  onSubmit,
  submitting,
  extraReady = true,
}: BankPledgeFormProps) {
  const set = <K extends keyof BankPledgeFormValue>(k: K, v: BankPledgeFormValue[K]) => onChange({ ...value, [k]: v });

  const cashIn = value.cash === "CashIn";
  const [tried, setTried] = useState(false);
  const errs: Record<string, string> = {};
  if (!(fixedLoan ?? value.loan)) errs.loan = "Select a loan.";
  if (!value.bankName) errs.bank = "Select a bank.";
  if (!(Number(value.amount) > 0)) errs.amount = "Enter the pledged amount.";
  if (!value.pledgeDate) errs.date = "Pick the pledge date.";
  if (cashIn && Number(value.amount) > 0 && !value.payment?.ready) errs.pay = "The payment breakdown must add up to the pledged amount, with a bank for every UPI / Bank Transfer line.";
  if (!extraReady) errs.ornaments = "Select at least one ornament.";
  const fe = (k: string) => (tried ? errs[k] : undefined);

  return (
    <>
      {!fixedLoan && (
        <AsyncSelect<Loan>
          label="Loan"
          placeholder="Search by customer or LN number"
          queryKey={["loans", "bank-pledge-picker"]}
          fetcher={async (q) => (await listLoansPage({ q: q || undefined, excludeBankPledged: true, limit: 20, offset: 0 })).items ?? []}
          selectedLabel={value.loan ? `${value.loan.loanNumber} · ${value.loan.customer?.name ?? ""}` : undefined}
          onClear={() => set("loan", null)}
          onSelect={(l) => set("loan", l)}
          keyOf={(l) => l.id}
          renderItem={(l) => ({
            title: `${l.loanNumber} · ${l.customer?.name ?? ""}`,
            sub: `${inr(l.principalAmount)}${l.totalNetWeight ? ` · ${+Number(l.totalNetWeight).toFixed(2)} g` : ""}`,
          })}
        />
      )}
      <FieldErr m={fe("loan")} />
      <AsyncSelect<Bank>
        label="Bank"
        placeholder="Search banks"
        queryKey={["banks", "picker"]}
        fetcher={async (q) => (await listBanksPage({ q: q || undefined, limit: 20, offset: 0 })).items ?? []}
        selectedLabel={value.bankName || undefined}
        onSelect={(b) => onChange({ ...value, bankId: b.id, bankName: b.name })}
        keyOf={(b) => b.id}
        renderItem={(b) => ({ title: b.name, sub: [b.branch, b.ifsc].filter(Boolean).join(" · ") || undefined })}
      />
      <FieldErr m={fe("bank")} />
      <FieldRow>
        <Field label="Pledged amount" style={{ flex: 1 }}>
          <Input value={value.amount} onChangeText={(v) => set("amount", num(v))} placeholder="0" keyboardType="decimal-pad" />
        </Field>
        <Field label="Interest rate %" style={{ flex: 1 }}>
          <Input value={value.rate} onChangeText={(v) => set("rate", num(v))} placeholder="0" keyboardType="decimal-pad" />
        </Field>
      </FieldRow>
      <FieldErr m={fe("amount")} />
      <FieldRow>
        <DateField label="Pledge date" value={value.pledgeDate} onChange={(v) => set("pledgeDate", v)} max={todayISO()} />
        <DateField label="Due date" value={value.dueDate} onChange={(v) => set("dueDate", v)} min={value.pledgeDate || undefined} clearable />
      </FieldRow>
      <FieldErr m={fe("date")} />
      <TextField label="Reference number" value={value.reference} onChangeText={(v) => set("reference", v)} placeholder="Optional" />
      <Field label="Cash treatment">
        <ChipToggle options={CASH} value={value.cash} onChange={(v) => set("cash", v)} labels={CASH_LABELS} />
      </Field>
      {cashIn && Number(value.amount) > 0 ? (
        <SplitPaymentInput total={Number(value.amount)} onChange={(p) => set("payment", p)} bankLabel="Bank (account it landed in)" />
      ) : null}
      <FieldErr m={fe("pay") ?? fe("ornaments")} />
      <PrimaryButton label="Repledge to Bank" onPress={() => (Object.keys(errs).length ? setTried(true) : onSubmit())} loading={submitting} style={{ marginBottom: 12 }} />
    </>
  );
}

/** The split columns and received bank sent with a "CashIn" pledge (nothing for "RecordOnly"). */
export function cashInPayload(value: BankPledgeFormValue) {
  if (value.cash !== "CashIn" || !value.payment) return {};
  const { split, bankId } = value.payment;
  return { ...split, receivedBankId: bankId };
}
