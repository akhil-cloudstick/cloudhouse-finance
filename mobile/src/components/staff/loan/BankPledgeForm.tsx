import React from "react";
import { AsyncSelect, ChipToggle, DateField, Field, FieldRow, Input, PrimaryButton, TextField, Txt, C } from "../../ui";
import { ErrorText } from "./common";
import { listLoansPage } from "../../../api/loans";
import { listBanksPage } from "../../../api/banks";
import { inr, todayISO } from "../../../lib/format";
import type { Loan } from "../../../types/loan";
import type { Bank } from "../../../types/bank";

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
};

export function bankPledgeFormInit(loan?: Loan | null): BankPledgeFormValue {
  return { loan: loan ?? null, bankId: undefined, bankName: "", amount: "", rate: "", pledgeDate: todayISO(), dueDate: "", reference: "", cash: "RecordOnly" };
}

/** One re-pledge form, shared by the loan detail's Bank Pledge sheet
 * (BankPledgeSheet.tsx, loan fixed) and the standalone Bank Pledges
 * screen's Add to Bank Pledge sheet (BankPledgeSheets.tsx, loan picked
 * here) — same fields, same payload shape, previously duplicated across
 * both call sites. Pass `fixedLoan` to hide the loan picker (already on
 * that loan's own detail page); omit it to show one (AsyncSelect, excludes
 * already-pledged loans so a loan can't be double-pledged from here). */
export function BankPledgeForm({
  value,
  onChange,
  fixedLoan,
  error,
  onSubmit,
  submitting,
}: {
  value: BankPledgeFormValue;
  onChange: (v: BankPledgeFormValue) => void;
  fixedLoan?: Loan;
  error: string | null;
  onSubmit: () => void;
  submitting: boolean;
}) {
  const set = <K extends keyof BankPledgeFormValue>(k: K, v: BankPledgeFormValue[K]) => onChange({ ...value, [k]: v });

  const canSave = !!(fixedLoan ?? value.loan) && !!value.bankName && Number(value.amount) > 0 && !!value.pledgeDate;

  return (
    <>
      {!fixedLoan && (
        <AsyncSelect<Loan>
          label="Loan"
          placeholder="Search by customer or LN number"
          queryKey={["loans", "bank-pledge-picker"]}
          // Already-pledged loans are excluded here — the same guard the
          // loan detail sheet gets for free by only showing this form when
          // there's no activePledge (see BankPledgeSheet.tsx).
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
      <FieldRow>
        <Field label="Pledged amount" style={{ flex: 1 }}>
          <Input value={value.amount} onChangeText={(v) => set("amount", num(v))} placeholder="0" keyboardType="decimal-pad" />
        </Field>
        <Field label="Interest rate %" style={{ flex: 1 }}>
          <Input value={value.rate} onChangeText={(v) => set("rate", num(v))} placeholder="0" keyboardType="decimal-pad" />
        </Field>
      </FieldRow>
      <FieldRow>
        <DateField label="Pledge date" value={value.pledgeDate} onChange={(v) => set("pledgeDate", v)} max={todayISO()} />
        <DateField label="Due date" value={value.dueDate} onChange={(v) => set("dueDate", v)} min={value.pledgeDate || undefined} clearable />
      </FieldRow>
      <TextField label="Reference number" value={value.reference} onChangeText={(v) => set("reference", v)} placeholder="Optional" />
      <Field label="Cash treatment">
        <ChipToggle options={CASH} value={value.cash} onChange={(v) => set("cash", v)} labels={CASH_LABELS} />
      </Field>
      {value.cash === "CashIn" && Number(value.amount) > 0 ? (
        <Txt style={{ fontSize: 11.5, color: C.muted, marginTop: -4, marginBottom: 12 }}>{inr(Number(value.amount))} will be added to Cash-in-Hand.</Txt>
      ) : null}
      <ErrorText>{error}</ErrorText>
      <PrimaryButton label="Repledge to Bank" onPress={onSubmit} loading={submitting} disabled={!canSave} style={{ marginBottom: 12 }} />
    </>
  );
}
