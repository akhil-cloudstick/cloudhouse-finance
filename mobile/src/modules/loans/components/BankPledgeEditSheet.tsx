import React, { useEffect, useState } from "react";
import { View } from "react-native";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AsyncSelect, C, ChipToggle, DateField, Field, FieldRow, Input, TextField, Txt } from "@/common/components/ui";
import { LedgerEditShell, type PreviewRow } from "@/common/components/LedgerEditShell";
import { SplitPaymentInput, type SplitPayment } from "@/common/components/SplitPaymentInput";
import { apiErr } from "@/common/components/loanSheetKit";
import { invalidateBankPledgeViews } from "@/modules/bank-pledges/components/bankPledgeViews";
import { listBanksPage } from "@/modules/banks/services/bankService";
import { deleteBankPledge, editBankPledge, type BankPledgeEditPreview } from "@/modules/loans/services/loanService";
import { dmy, inr, todayISO } from "@/common/utils/format";
import type { BankPledgeRecord } from "@/modules/loans/types/loan-types";
import type { Bank } from "@/modules/banks/types/bank-types";

type Treatment = "RecordOnly" | "CashIn";
const CASH = ["RecordOnly", "CashIn"] as const;
const CASH_LABELS = { RecordOnly: "Record only", CashIn: "Add to cash-in-hand" } as const;
const treatmentLabel = (t?: string) => (t === "CashIn" ? "Added to Cash-in-Hand" : "Record only");
const received = (r?: BankPledgeRecord | null) => (r ? (r.cashAmount ?? 0) + (r.upiAmount ?? 0) + (r.bankTransferAmount ?? 0) : 0);

type Props = { loanId: number; pledge: BankPledgeRecord | null; mode: "edit" | "delete"; onClose: () => void };

function previewRows(p: BankPledgeEditPreview): PreviewRow[] {
  const b = p.before;
  const a = p.after;
  const rows: PreviewRow[] = [
    { label: "Bank", before: b.bankName, after: a ? a.bankName : "—" },
    { label: "Pledged amount", before: b.pledgedAmount, after: a ? a.pledgedAmount : "—", money: true },
    { label: "Pledge date", before: (b.pledgeDate ?? "").slice(0, 10), after: a ? (a.pledgeDate ?? "").slice(0, 10) : "—" },
    { label: "Cash treatment", before: treatmentLabel(b.cashTreatment), after: a ? treatmentLabel(a.cashTreatment) : "—" },
    { label: "Cash received", before: received(b), after: a ? received(a) : "—", money: true },
  ];
  if (b.releaseDate) rows.push({ label: "Release date", before: b.releaseDate.slice(0, 10), after: a?.releaseDate ? a.releaseDate.slice(0, 10) : "—" });
  return rows;
}

/** Edit or delete one bank pledge record — same two-step preview (before / after) then confirm as the web editor. */
export function BankPledgeEditSheet({ loanId, pledge: p, mode, onClose }: Props) {
  const qc = useQueryClient();
  const released = p?.status === "Released";
  const [bank, setBank] = useState("");
  const [bankId, setBankId] = useState<number | undefined>();
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(todayISO());
  const [dueDate, setDueDate] = useState("");
  const [rate, setRate] = useState("");
  const [reference, setReference] = useState("");
  const [treatment, setTreatment] = useState<Treatment>("RecordOnly");
  const [pay, setPay] = useState<SplitPayment | null>(null);
  const [releaseDate, setReleaseDate] = useState("");
  const [relPay, setRelPay] = useState<SplitPayment | null>(null);
  const [preview, setPreview] = useState<BankPledgeEditPreview | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!p) return;
    setBank(p.bankName);
    setBankId(p.bankId ?? undefined);
    setAmount(String(p.pledgedAmount));
    setDate((p.pledgeDate || todayISO()).slice(0, 10));
    setDueDate(p.bankPledgeDueDate?.slice(0, 10) ?? "");
    setRate(String(p.bankInterestRate ?? 0));
    setReference(p.referenceNumber ?? "");
    setTreatment(p.cashTreatment === "CashIn" ? "CashIn" : "RecordOnly");
    setReleaseDate(p.releaseDate?.slice(0, 10) ?? "");
    setPreview(null);
    setError(null);
  }, [p]);

  const touch = <T,>(set: (v: T) => void) => (v: T) => {
    setPreview(null);
    setError(null);
    set(v);
  };

  const run = useMutation({
    mutationFn: async (dry: boolean) => {
      if (!p) throw new Error("No entry");
      if (mode === "delete") return deleteBankPledge(loanId, p.id, dry);
      const amt = Number(amount);
      if (!bank.trim()) throw new Error("Select the bank.");
      if (!(amt > 0)) throw new Error("Enter a valid amount.");
      if (treatment === "CashIn") {
        if (!pay?.ready) throw new Error("Check the payment breakdown and banks.");
        if (released && !relPay?.ready) throw new Error("Check the release payment breakdown and banks.");
      }
      return editBankPledge(
        loanId,
        p.id,
        {
          bankId,
          bankName: bank.trim(),
          pledgedAmount: amt,
          pledgeDate: date,
          bankPledgeDueDate: dueDate,
          bankInterestRate: Number(rate) || 0,
          referenceNumber: reference,
          cashTreatment: treatment,
          ...(treatment === "CashIn" && pay ? { cashAmount: pay.split.cashAmount, upiAmount: pay.split.upiAmount, bankTransferAmount: pay.split.bankTransferAmount, receivedBankId: pay.bankId } : {}),
          ...(released ? { releaseDate } : {}),
          ...(released && treatment === "CashIn" && relPay ? { releaseCashAmount: relPay.split.cashAmount, releaseUpiAmount: relPay.split.upiAmount, releaseBankTransferAmount: relPay.split.bankTransferAmount, releaseBankId: relPay.bankId } : {}),
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
      invalidateBankPledgeViews(qc);
      onClose();
    },
    onError: (e) => {
      setPreview(null);
      setError(e instanceof Error && !("status" in e) ? e.message : apiErr(e, "Could not save the change — try again."));
    },
  });

  const cashInitial = p ? { split: { cashAmount: p.cashAmount ?? 0, upiAmount: p.upiAmount ?? 0, bankTransferAmount: p.bankTransferAmount ?? 0, chequeAmount: 0 }, bankId: p.receivedBankId } : undefined;
  const relHas = p ? (p.releaseCashAmount ?? 0) + (p.releaseUpiAmount ?? 0) + (p.releaseBankTransferAmount ?? 0) > 0 : false;
  const relInitial = p && relHas ? { split: { cashAmount: p.releaseCashAmount ?? 0, upiAmount: p.releaseUpiAmount ?? 0, bankTransferAmount: p.releaseBankTransferAmount ?? 0, chequeAmount: 0 }, bankId: p.releaseBankId } : undefined;

  const form = p ? (
    <>
      <AsyncSelect<Bank>
        label="Bank"
        placeholder="Search banks"
        queryKey={["banks", "picker"]}
        fetcher={async (q) => (await listBanksPage({ q: q || undefined, limit: 20, offset: 0 })).items ?? []}
        selectedLabel={bank || undefined}
        onSelect={(b) => {
          touch(setBank)(b.name);
          setBankId(b.id);
        }}
        keyOf={(b) => b.id}
        renderItem={(b) => ({ title: b.name, sub: [b.branch, b.ifsc].filter(Boolean).join(" · ") || undefined })}
      />
      <FieldRow>
        <Field label="Pledged amount (₹) *" style={{ flex: 1 }}>
          <Input keyboardType="decimal-pad" value={amount} onChangeText={touch(setAmount)} />
        </Field>
        <Field label="Interest rate %" style={{ flex: 1 }}>
          <Input keyboardType="decimal-pad" value={rate} onChangeText={touch(setRate)} />
        </Field>
      </FieldRow>
      <FieldRow>
        <DateField label="Pledge date" value={date} onChange={touch(setDate)} max={todayISO()} />
        <DateField label="Due date" value={dueDate} onChange={touch(setDueDate)} min={date || undefined} clearable />
      </FieldRow>
      <TextField label="Reference number" value={reference} onChangeText={touch(setReference)} />
      <Field label="Cash treatment">
        <ChipToggle options={CASH} value={treatment} onChange={touch(setTreatment)} labels={CASH_LABELS} />
      </Field>
      {treatment === "CashIn" ? (
        <View style={{ marginBottom: 12 }}>
          <Txt style={{ fontSize: 12, fontWeight: "700", color: C.muted, marginBottom: 4 }}>How the advance was received</Txt>
          <SplitPaymentInput
            key={`in-${p.id}`}
            total={Number(amount) || 0}
            bankLabel="Bank (account it landed in)"
            initial={cashInitial}
            onChange={(v) => {
              setPreview(null);
              setPay(v);
            }}
          />
        </View>
      ) : null}
      {released ? (
        <>
          <DateField label="Release date" value={releaseDate} onChange={touch(setReleaseDate)} min={date || undefined} max={todayISO()} />
          {treatment === "CashIn" ? (
            <View style={{ marginBottom: 12 }}>
              <Txt style={{ fontSize: 12, fontWeight: "700", color: C.muted, marginBottom: 4 }}>How the bank was repaid</Txt>
              <SplitPaymentInput
                key={`out-${p.id}`}
                total={Number(amount) || 0}
                bankLabel="Bank (account it left from)"
                initial={relInitial}
                onChange={(v) => {
                  setPreview(null);
                  setRelPay(v);
                }}
              />
            </View>
          ) : null}
        </>
      ) : null}
    </>
  ) : null;

  return (
    <LedgerEditShell
      visible={!!p}
      onClose={onClose}
      title={`${mode === "delete" ? "Delete" : "Edit"} Bank Pledge`}
      mode={mode}
      form={form}
      deleteText={`Delete the ${inr(p?.pledgedAmount ?? 0)} pledge to ${p?.bankName ?? ""} (${dmy(p?.pledgeDate)})? Its cash-ledger lines are removed too.`}
      previewTitle={mode === "delete" ? "This record will be removed" : "What changes"}
      preview={preview ? previewRows(preview) : null}
      error={error}
      busy={run.isPending}
      onSubmit={() => {
        setError(null);
        run.mutate(preview == null);
      }}
    />
  );
}
