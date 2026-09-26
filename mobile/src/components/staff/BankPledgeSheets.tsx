import React, { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AsyncSelect, C, ChipToggle, DateField, Field, FieldRow, Input, PrimaryButton, Sheet, Txt } from "../ui";
import { ApiError } from "../../api/client";
import { listLoansPage } from "../../api/loans";
import { createBank, listBanksPage } from "../../api/banks";
import { recordBankPledge } from "../../api/bankPledges";
import { inr, todayISO } from "../../lib/format";
import type { Loan } from "../../types/loan";
import type { Bank } from "../../types/bank";

// Add to Bank Pledge (prototype #add-bank-pledge-modal) and Add Bank
// (#add-bank-modal). Same payloads as the loan detail's pledge form and the
// old Bank Pledges screen's Add Bank sheet.

const errText = (msg: string | null) => (msg ? <Txt style={{ fontSize: 12, color: C.red, marginBottom: 10 }}>{msg}</Txt> : null);
const FINISHED = ["Closed", "Rejected", "Auctioned", "Auctioned - Balance Due", "Pending Approval"];
const CASH = ["CashIn", "RecordOnly"] as const;
const CASH_LABELS = { CashIn: "Cash Added", RecordOnly: "Record Only" } as const;
const num = (v: string) => v.replace(/[^0-9.]/g, "");

/** Every screen that shows a pledge, the loan's packet or the till. */
export function invalidateBankPledgeViews(qc: ReturnType<typeof useQueryClient>) {
  for (const key of ["bankPledges", "bankPledgeHistory", "loan", "loans", "loanPacket", "packet", "packets", "cash-summary", "cash-movements"]) {
    qc.invalidateQueries({ queryKey: [key] });
  }
}

export function AddBankPledgeSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const [loan, setLoan] = useState<Loan | null>(null);
  const [bank, setBank] = useState<Bank | null>(null);
  const [amount, setAmount] = useState("");
  const [rate, setRate] = useState("");
  const [pledgeDate, setPledgeDate] = useState(todayISO());
  const [dueDate, setDueDate] = useState("");
  const [cash, setCash] = useState<(typeof CASH)[number]>("CashIn");
  const [reference, setReference] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    setLoan(null);
    setBank(null);
    setAmount("");
    setRate("");
    setPledgeDate(todayISO());
    setDueDate("");
    setCash("CashIn");
    setReference("");
    setError(null);
  }, [visible]);

  const save = useMutation({
    mutationFn: () =>
      recordBankPledge(loan!.id, {
        bankId: bank!.id,
        bankName: bank!.name,
        pledgedAmount: Number(amount),
        pledgeDate: pledgeDate || todayISO(),
        bankInterestRate: rate ? Number(rate) : undefined,
        referenceNumber: reference.trim() || undefined,
        bankPledgeDueDate: dueDate || undefined,
        cashTreatment: cash,
      }),
    onSuccess: () => {
      invalidateBankPledgeViews(qc);
      onClose();
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Could not add the bank pledge."),
  });

  const canSave = !!loan && !!bank && Number(amount) > 0 && !!pledgeDate;

  return (
    <Sheet visible={visible} onClose={onClose} title="Add to Bank Pledge" maxHeightPct={88}>
      <AsyncSelect<Loan>
        label="Loan"
        placeholder="Search by customer or LN number"
        queryKey={["loans", "bank-pledge-picker"]}
        // Only loans not already with a bank; finished loans can't be pledged.
        fetcher={async (q) => ((await listLoansPage({ q: q || undefined, excludeBankPledged: true, limit: 20, offset: 0 })).items ?? []).filter((l) => !FINISHED.includes(l.status))}
        selectedLabel={loan ? `${loan.loanNumber} · ${loan.customer?.name ?? ""}` : undefined}
        onClear={() => setLoan(null)}
        onSelect={setLoan}
        keyOf={(l) => l.id}
        renderItem={(l) => ({
          title: `${l.loanNumber} · ${l.customer?.name ?? ""}`,
          sub: `${inr(l.principalAmount)}${l.totalNetWeight ? ` · ${+Number(l.totalNetWeight).toFixed(2)} g` : ""}`,
        })}
      />
      <AsyncSelect<Bank>
        label="Bank"
        placeholder="Search bank"
        queryKey={["banks", "picker"]}
        fetcher={async (q) => (await listBanksPage({ q: q || undefined, limit: 20, offset: 0 })).items ?? []}
        selectedLabel={bank?.name}
        onSelect={setBank}
        keyOf={(b) => b.id}
        renderItem={(b) => ({ title: b.name, sub: [b.branch, b.ifsc].filter(Boolean).join(" · ") || undefined })}
      />
      <FieldRow>
        <Field label="Pledged amount" style={{ flex: 1 }}>
          <Input value={amount} onChangeText={(v) => setAmount(num(v))} placeholder="₹" keyboardType="decimal-pad" />
        </Field>
        <Field label="Interest rate %" style={{ flex: 1 }}>
          <Input value={rate} onChangeText={(v) => setRate(num(v))} placeholder="e.g. 9.5" keyboardType="decimal-pad" />
        </Field>
      </FieldRow>
      <FieldRow>
        <DateField label="Pledge date" value={pledgeDate} onChange={setPledgeDate} max={todayISO()} />
        <DateField label="Due date" value={dueDate} onChange={setDueDate} min={pledgeDate || undefined} clearable />
      </FieldRow>
      <Field label="Cash treatment">
        <ChipToggle options={CASH} value={cash} onChange={setCash} labels={CASH_LABELS} />
      </Field>
      {cash === "CashIn" && Number(amount) > 0 ? (
        <Txt style={{ fontSize: 11.5, color: C.muted, marginTop: -4, marginBottom: 12 }}>{inr(Number(amount))} will be added to Cash-in-Hand.</Txt>
      ) : null}
      <Field label="Reference number">
        <Input value={reference} onChangeText={setReference} placeholder="Bank reference no." />
      </Field>
      {errText(error)}
      <PrimaryButton label="Add to Bank Pledge" onPress={() => save.mutate()} loading={save.isPending} disabled={!canSave} />
    </Sheet>
  );
}

export function AddBankSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [ifsc, setIfsc] = useState("");
  const [accountNo, setAccountNo] = useState("");
  const [phone, setPhone] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    setName("");
    setIfsc("");
    setAccountNo("");
    setPhone("");
    setError(null);
  }, [visible]);

  const create = useMutation({
    mutationFn: () => createBank({ name: name.trim(), ifsc: ifsc.trim() || undefined, accountNo: accountNo.trim() || undefined, phone: phone.trim() || undefined }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["banks"] });
      qc.invalidateQueries({ queryKey: ["banks-all"] });
      onClose();
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Could not save."),
  });

  return (
    <Sheet visible={visible} onClose={onClose} title="Add Bank" maxHeightPct={65}>
      <Field label="Bank name">
        <Input value={name} onChangeText={setName} placeholder="e.g. HDFC Bank" />
      </Field>
      <Field label="IFSC code">
        <Input value={ifsc} onChangeText={(v) => setIfsc(v.toUpperCase())} autoCapitalize="characters" placeholder="e.g. HDFC0001234" />
      </Field>
      <Field label="Account number">
        <Input value={accountNo} onChangeText={setAccountNo} placeholder="Branch account number" keyboardType="number-pad" />
      </Field>
      <Field label="Phone">
        <Input value={phone} onChangeText={setPhone} placeholder="Bank contact number" keyboardType="phone-pad" />
      </Field>
      {errText(error)}
      <PrimaryButton label="Add Bank" onPress={() => create.mutate()} loading={create.isPending} disabled={!name.trim()} />
    </Sheet>
  );
}
