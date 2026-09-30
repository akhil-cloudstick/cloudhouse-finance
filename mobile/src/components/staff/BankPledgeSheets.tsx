import React, { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { C, Field, Input, PrimaryButton, Sheet, Txt } from "../ui";
import { ApiError } from "../../api/client";
import { createBank } from "../../api/banks";
import { recordBankPledge } from "../../api/bankPledges";
import { todayISO } from "../../lib/format";
import { BankPledgeForm, bankPledgeFormInit } from "./loan/BankPledgeForm";

// Add to Bank Pledge (prototype #add-bank-pledge-modal) and Add Bank
// (#add-bank-modal). Add to Bank Pledge shares BankPledgeForm with the loan
// detail's own Bank Pledge sheet (BankPledgeSheet.tsx) — same fields, same
// payload, previously duplicated across both.

const errText = (msg: string | null) => (msg ? <Txt style={{ fontSize: 12, color: C.red, marginBottom: 10 }}>{msg}</Txt> : null);

/** Every screen that shows a pledge, the loan's packet or the till. */
export function invalidateBankPledgeViews(qc: ReturnType<typeof useQueryClient>) {
  for (const key of ["bankPledges", "bankPledgeHistory", "loan", "loans", "loanPacket", "packet", "packets", "cash-summary", "cash-movements"]) {
    qc.invalidateQueries({ queryKey: [key] });
  }
}

export function AddBankPledgeSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState(() => bankPledgeFormInit());
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    setForm(bankPledgeFormInit());
    setError(null);
  }, [visible]);

  const save = useMutation({
    mutationFn: () =>
      recordBankPledge(form.loan!.id, {
        bankId: form.bankId,
        bankName: form.bankName,
        pledgedAmount: Number(form.amount),
        pledgeDate: form.pledgeDate || todayISO(),
        bankInterestRate: form.rate ? Number(form.rate) : undefined,
        referenceNumber: form.reference.trim() || undefined,
        bankPledgeDueDate: form.dueDate || undefined,
        cashTreatment: form.cash,
      }),
    onSuccess: () => {
      invalidateBankPledgeViews(qc);
      onClose();
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Could not add the bank pledge."),
  });

  return (
    <Sheet visible={visible} onClose={onClose} title="Add to Bank Pledge" maxHeightPct={88}>
      <BankPledgeForm value={form} onChange={setForm} error={error} onSubmit={() => save.mutate()} submitting={save.isPending} />
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
