import React, { useEffect, useState } from "react";
import { View } from "react-native";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { C, CheckItem, DateField, Field, FieldRow, Input, Txt } from "@/common/components/ui";
import { LedgerEditShell, loanPreviewRows } from "@/common/components/LedgerEditShell";
import { SplitPaymentInput, type SplitPayment } from "@/common/components/SplitPaymentInput";
import { apiErr, invalidateLoan } from "@/common/components/loanSheetKit";
import { editLoanDisbursement, type SanctionEditPreview } from "@/modules/loans/services/loanService";
import { dmy, inr, todayISO } from "@/common/utils/format";
import type { Loan } from "@/modules/loans/types/loan-types";

type Props = { loan: Loan | null; visible: boolean; onClose: () => void };

/** Edit Loan Sanction (web SanctionEditModalContent): date, due date, sanctioned amount, service charge and the payout
 * breakdown. First press previews what it does to the loan (nothing saved); the second saves and recalculates the loan. */
export function SanctionEditSheet({ loan: l, visible, onClose }: Props) {
  const qc = useQueryClient();
  const payment = [...(l?.payments ?? [])].reverse().find((p) => p.type === "Disbursement") ?? null;
  const [date, setDate] = useState(todayISO());
  const [due, setDue] = useState("");
  const [amount, setAmount] = useState("");
  const [charge, setCharge] = useState("0");
  const [pay, setPay] = useState<SplitPayment | null>(null);
  const [preview, setPreview] = useState<SanctionEditPreview | null>(null);
  const [follow, setFollow] = useState<Record<number, string>>({});
  const [chosen, setChosen] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!l || !visible) return;
    setDate((l.disbursementDate || todayISO()).slice(0, 10));
    setDue((l.dueDate || "").slice(0, 10));
    setAmount(String(l.sanctionedAmount ?? l.principalAmount));
    setCharge(String(l.serviceChargeAmount ?? 0));
    setPreview(null);
    setError(null);
  }, [l, visible]);

  const amt = Number(amount) || 0;
  const chg = Number(charge) || 0;
  const payout = Math.max(0, amt - chg);
  const startPayout = Math.max(0, (l?.sanctionedAmount ?? 0) - (l?.serviceChargeAmount ?? 0));

  const touch = <T,>(set: (v: T) => void) => (v: T) => {
    setPreview(null);
    setError(null);
    set(v);
  };

  const run = useMutation({
    mutationFn: async (dry: boolean) => {
      if (!l) throw new Error("No loan");
      if (!(amt > 0)) throw new Error("Enter a valid sanctioned amount.");
      if (chg < 0 || chg >= amt) throw new Error("The service charge must be less than the sanctioned amount.");
      if (!pay?.ready) throw new Error("Check the payout breakdown and banks.");
      const gold = dry
        ? {}
        : {
            ...(preview?.dependents?.some((d) => d.kind === "packet") && chosen.packet ? { reversePacket: true } : {}),
            ...(preview?.dependents?.some((d) => d.kind === "partial_release") && chosen.partial_release ? { restorePartialRelease: true } : {}),
            ...(preview?.following?.length ? { adjustFollowing: preview.following.map((f) => ({ id: f.id, amount: Number(follow[f.id] ?? f.current) || 0 })) } : {}),
          };
      return editLoanDisbursement(
        l.id,
        { disbursedOn: date, dueDate: due, sanctionedAmount: amt, serviceCharge: chg, cashAmount: pay.split.cashAmount, upiAmount: pay.split.upiAmount, bankTransferAmount: pay.split.bankTransferAmount, bankId: pay.bankId, ...gold },
        dry
      );
    },
    onSuccess: (res, dry) => {
      if (dry) {
        setPreview(res);
        setFollow(Object.fromEntries((res.following ?? []).map((f) => [f.id, String(f.current)])));
        setChosen(Object.fromEntries((res.dependents ?? []).map((d) => [d.kind, true])));
        setError(null);
        return;
      }
      if (l) invalidateLoan(qc, l.id);
      qc.invalidateQueries({ queryKey: ["loanLedgerCharges"] });
      qc.invalidateQueries({ queryKey: ["ledger"] });
      qc.invalidateQueries({ queryKey: ["packets"] });
      onClose();
    },
    onError: (e) => {
      const msg = e instanceof Error && !("status" in e) ? e.message : apiErr(e, "Could not save the change — try again.");
      setError(msg);
      // A later payment that still does not fit leaves the list on screen to be corrected.
      if (!/can be at most|can only be lowered/.test(msg)) setPreview(null);
    },
  });

  const form = l ? (
    <>
      <FieldRow>
        <DateField label="Disbursement date *" value={date} onChange={touch(setDate)} max={todayISO()} />
        <DateField label="Due date *" value={due} onChange={touch(setDue)} />
      </FieldRow>
      <FieldRow>
        <Field label="Sanctioned amount (₹) *" style={{ flex: 1 }}>
          <Input keyboardType="decimal-pad" value={amount} onChangeText={touch(setAmount)} />
        </Field>
        <Field label="Service charge (₹)" style={{ flex: 1 }}>
          <Input keyboardType="decimal-pad" value={charge} onChangeText={touch(setCharge)} />
        </Field>
      </FieldRow>
      <Txt style={{ fontSize: 12, fontWeight: "700", color: C.muted, marginBottom: 4 }}>Payout breakdown · paid to the customer: {inr(payout)}</Txt>
      <View style={{ marginBottom: 12 }}>
        <SplitPaymentInput
          key={`sanction-${l.id}-${visible}`}
          total={payout}
          bankLabel="Bank (account it was paid from)"
          initial={{
            split: payment ? { cashAmount: payment.cashAmount ?? 0, upiAmount: payment.upiAmount ?? 0, bankTransferAmount: payment.bankTransferAmount ?? 0, chequeAmount: 0 } : { cashAmount: startPayout, upiAmount: 0, bankTransferAmount: 0, chequeAmount: 0 },
            bankId: payment?.bankId ?? undefined,
          }}
          onChange={(v) => {
            setPreview(null);
            setPay(v);
          }}
        />
      </View>
    </>
  ) : null;

  const extra = preview ? (
    <View style={{ marginBottom: 12 }}>
      {(preview.following ?? []).length > 0 ? (
        <>
          <Txt style={{ fontSize: 11.5, color: C.muted, fontWeight: "600", marginBottom: 4 }}>Later payments that no longer fit — set what each becomes (0 removes it)</Txt>
          {(preview.following ?? []).map((f) => (
            <Field key={f.id} label={`${dmy(f.paidOn)} · ${f.type ?? "Payment"} · now ${inr(f.current)} (up to ${inr(f.suggested)})`}>
              <Input keyboardType="decimal-pad" value={follow[f.id] ?? String(f.current)} onChangeText={(v) => setFollow((c) => ({ ...c, [f.id]: v }))} />
            </Field>
          ))}
        </>
      ) : null}
      {(preview.dependents ?? []).length > 0 ? (
        <>
          <Txt style={{ fontSize: 11.5, color: C.muted, fontWeight: "600", marginVertical: 4 }}>This also affects the gold released for this loan</Txt>
          {(preview.dependents ?? []).map((d) => (
            <CheckItem
              key={d.kind}
              checked={!!chosen[d.kind]}
              onPress={() => setChosen((c) => ({ ...c, [d.kind]: !c[d.kind] }))}
              title={`Also update: ${d.description}`}
              sub={`${d.current} → ${d.suggested}${d.warning && chosen[d.kind] ? ` — ${d.warning}` : ""}`}
            />
          ))}
        </>
      ) : null}
    </View>
  ) : null;

  return (
    <LedgerEditShell
      visible={visible && !!l}
      onClose={onClose}
      title="Edit Loan Sanction"
      mode="edit"
      form={form}
      deleteText=""
      previewTitle="What changes on the loan (as of its last entry)"
      preview={preview ? loanPreviewRows(preview) : null}
      extra={extra}
      error={error}
      busy={run.isPending}
      onSubmit={() => {
        setError(null);
        run.mutate(preview == null);
      }}
    />
  );
}
