import React, { useEffect, useRef, useState } from "react";
import { View } from "react-native";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { DateField, Field, FieldRow, Input } from "@/common/components/ui";
import { LedgerEditShell, loanPreviewRows } from "@/common/components/LedgerEditShell";
import { SplitPaymentInput, type SplitPayment } from "@/common/components/SplitPaymentInput";
import { apiErr, invalidateLoan } from "@/common/components/loanSheetKit";
import { FollowingEntriesInputs, PartialReleaseToggle, followingDefaults } from "@/modules/loans/components/LedgerEditExtras";
import { deleteLoanTopUp, editLoanTopUp, type LedgerEditPreview } from "@/modules/loans/services/paymentService";
import { inr, todayISO } from "@/common/utils/format";
import type { LoanTopUp } from "@/modules/loans/types/loan-types";

type Props = { loanId: number; loanStart?: string | null; topUp: LoanTopUp | null; mode: "edit" | "delete"; onClose: () => void };

/** Edit or delete one top-up on the loan ledger — same two-step preview / confirm as a payment edit. */
export function TopUpEditSheet({ loanId, loanStart, topUp: t, mode, onClose }: Props) {
  const qc = useQueryClient();
  const [date, setDate] = useState(todayISO());
  const [amount, setAmount] = useState("");
  const [reference, setReference] = useState("");
  const [pay, setPay] = useState<SplitPayment | null>(null);
  const [preview, setPreview] = useState<LedgerEditPreview | null>(null);
  const [restorePartial, setRestorePartial] = useState(true);
  const [follow, setFollow] = useState<Record<number, string>>({});
  const [error, setError] = useState<string | null>(null);
  // Form version: a dry-run answer is only shown if the form has not changed since it was sent.
  const ver = useRef(0);
  const sentVer = useRef(0);
  const previewVer = useRef(-1);

  useEffect(() => {
    if (!t) return;
    ver.current += 1;
    setRestorePartial(true);
    setFollow({});
    setDate((t.occurredOn || todayISO()).slice(0, 10));
    setAmount(String(t.amount));
    setReference(t.reference ?? "");
    setPreview(null);
    setError(null);
  }, [t]);

  const touch = <T,>(set: (v: T) => void) => (v: T) => {
    ver.current += 1;
    setPreview(null);
    setError(null);
    set(v);
  };

  const run = useMutation({
    mutationFn: async (dry: boolean) => {
      if (!t) throw new Error("No entry");
      const restore = !dry && !!preview?.dependents?.some((d) => d.kind === "partial_release") && restorePartial;
      if (mode === "delete") return deleteLoanTopUp(loanId, t.id, dry, undefined, restore);
      const adjust = !dry && preview?.following?.length ? { adjustFollowing: preview.following.map((f) => ({ id: f.id, amount: Number(follow[f.id] ?? f.current) || 0 })) } : {};
      const amt = Number(amount);
      if (!(amt > 0)) throw new Error("Enter a valid amount.");
      if (!pay?.ready) throw new Error("Check breakdown and banks.");
      return editLoanTopUp(loanId, t.id, { occurredOn: date, amount: amt, reference, cashAmount: pay.split.cashAmount, upiAmount: pay.split.upiAmount, bankTransferAmount: pay.split.bankTransferAmount, bankId: pay.bankId, ...(restore ? { restorePartialRelease: true } : {}), ...adjust }, dry);
    },
    onSuccess: (res, dry) => {
      if (dry) {
        if (sentVer.current !== ver.current) return; // the form changed while this was running
        previewVer.current = ver.current;
        setPreview(res);
        setFollow(followingDefaults(res));
        setRestorePartial(true);
        setError(null);
        return;
      }
      invalidateLoan(qc, loanId);
      qc.invalidateQueries({ queryKey: ["loanLedgerCharges"] });
      qc.invalidateQueries({ queryKey: ["ledger"] });
      onClose();
    },
    onError: (e, dry) => {
      if (dry && sentVer.current !== ver.current) return;
      const msg = e instanceof Error && !("status" in e) ? e.message : apiErr(e, "Could not save the change — try again.");
      // a later payment that still does not fit leaves the list on screen to be corrected
      if (!(mode === "edit" && preview?.following?.length && /can be at most|can only be lowered/.test(msg))) setPreview(null);
      setError(msg);
    },
  });

  const form = t ? (
    <>
      <FieldRow>
        <DateField label="Date" value={date} onChange={touch(setDate)} min={loanStart?.slice(0, 10) || undefined} max={todayISO()} />
        <Field label="Top-up amount (₹)">
          <Input keyboardType="decimal-pad" value={amount} onChangeText={touch(setAmount)} />
        </Field>
      </FieldRow>
      <Field label="Reference">
        <Input value={reference} onChangeText={touch(setReference)} />
      </Field>
      <View style={{ marginBottom: 12 }}>
        <SplitPaymentInput
          key={t.id}
          total={Number(amount) || 0}
          bankLabel="Bank (account it was paid from)"
          initial={{ split: { cashAmount: t.cashAmount, upiAmount: t.upiAmount, bankTransferAmount: t.bankTransferAmount, chequeAmount: 0 }, bankId: t.bankId }}
          onChange={(v) => {
            ver.current += 1;
            setPreview(null);
            setPay(v);
          }}
        />
      </View>
    </>
  ) : null;

  return (
    <LedgerEditShell
      visible={!!t}
      onClose={onClose}
      title={`${mode === "delete" ? "Delete" : "Edit"} top-up`}
      mode={mode}
      form={form}
      deleteText={`Delete the top-up of ${inr(t?.amount ?? 0)} dated ${(t?.occurredOn ?? "").slice(0, 10)}? Its cash-ledger lines are removed, the loan's principal goes back down by that amount, and any interest settled from its payout is removed too.`}
      previewTitle="What changes on the loan (as of its last entry)"
      preview={preview ? loanPreviewRows(preview) : null}
      extra={
        <>
          <PartialReleaseToggle preview={preview} value={restorePartial} onChange={setRestorePartial} />
          {mode === "edit" && preview?.following?.length ? <FollowingEntriesInputs entries={preview.following} values={follow} onChange={(id, v) => setFollow((cur) => ({ ...cur, [id]: v }))} /> : null}
        </>
      }
      error={error}
      busy={run.isPending}
      onSubmit={() => {
        setError(null);
        const confirm = preview != null && previewVer.current === ver.current;
        if (preview != null && !confirm) setPreview(null);
        sentVer.current = ver.current;
        run.mutate(!confirm);
      }}
    />
  );
}
