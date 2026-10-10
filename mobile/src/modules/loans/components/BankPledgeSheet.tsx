import React, { useEffect, useState } from "react";
import { View } from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AccBtn, BtnRow2, Buffering, C, EmptyText, FieldGrid, NoticeBanner, PledgeItem, PrimaryButton, Sheet, TextField, Txt, WarningBanner } from "@/common/components/ui";
import { getBankPledgeHistory, recordBankPledge, releaseBankPledge, voidBankPledge } from "@/modules/bank-pledges/services/bankPledgeService";
import { dmy, inr, todayISO } from "@/common/utils/format";
import type { Loan } from "@/modules/loans/types/loan-types";
import { apiErr, invalidateLoan } from "@/common/components/loanSheetKit";
import { ErrorText } from "@/common/components/ErrorText";
import { BankPledgeForm, bankPledgeFormInit } from "@/common/components/BankPledgeForm";
import { useAuth } from "@/common/providers/AuthProvider";

type BankPledgeSheetProps = {
  loan: Loan;
  packetStatus?: string;
  visible: boolean;
  onClose: () => void;
};

/** Bank pledge (repledge) for one loan, in the prototype's sheet style —
 * parity with frontend BankPledge.tsx: bank picker (bankId), interest rate +
 * due date, Release, Delete (void) for a mis-recorded pledge, and History.
 * Also carries the locker / fully-paid warnings the web LoanDetail shows. */
export function BankPledgeSheet({
  loan: l,
  packetStatus,
  visible,
  onClose,
}: BankPledgeSheetProps) {
  const qc = useQueryClient();
  const isFinished = l.status === "Closed" || l.status === "Rejected";
  const activePledge = l.bankPledges?.find((p) => p.status === "Active");

  const [form, setForm] = useState(() => bankPledgeFormInit(l));
  const [error, setError] = useState<string | null>(null);
  const [confirmRelease, setConfirmRelease] = useState(false);
  const [voidOpen, setVoidOpen] = useState(false);
  const [voidReason, setVoidReason] = useState("");
  const [historyOpen, setHistoryOpen] = useState(false);
  const { can } = useAuth();
  const canCreate = can("Bank_Pledge_Management", "can_create_bank_pledge");
  const canUpdate = can("Bank_Pledge_Management", "can_update_bank_pledge");

  useEffect(() => {
    if (visible) setError(null);
  }, [visible]);

  const done = () => {
    setError(null);
    invalidateLoan(qc, l.id);
  };

  const record = useMutation({
    mutationFn: () =>
      recordBankPledge(l.id, {
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
      setForm(bankPledgeFormInit(l));
      done();
    },
    onError: (e) => setError(apiErr(e)),
  });

  const release = useMutation({
    mutationFn: (pledgeId: number) => releaseBankPledge(l.id, pledgeId),
    onSuccess: () => {
      setConfirmRelease(false);
      done();
    },
    onError: (e) => setError(apiErr(e)),
  });

  const voidIt = useMutation({
    mutationFn: (pledgeId: number) => voidBankPledge(l.id, pledgeId, voidReason.trim()),
    onSuccess: () => {
      setVoidOpen(false);
      setVoidReason("");
      done();
    },
    onError: (e) => setError(apiErr(e)),
  });

  const history = useQuery({
    queryKey: ["bankPledgeHistory", String(l.id)],
    queryFn: () => getBankPledgeHistory(l.id),
    enabled: historyOpen,
  });

  const fullyPaid = (l.totalOutstandingBalance ?? 0) <= 0.01;
  const bankPledged = l.bankPledgeStatus === "Bank Pledged";
  const inLocker = packetStatus === "Locker Stored";

  return (
    <>
      <Sheet visible={visible} onClose={onClose} title="Bank Pledge" maxHeightPct={90}>
        <View style={{ height: 8 }} />
        {(bankPledged || inLocker) && fullyPaid ? (
          <WarningBanner>
            {bankPledged
              ? "This loan is fully paid, but its gold is still pledged to a bank — release it from the bank pledge before this loan can be closed."
              : "This loan is fully paid, but its gold is still checked into a locker — check it out before this loan can be closed."}
          </WarningBanner>
        ) : inLocker && !bankPledged ? (
          <NoticeBanner>Gold is currently held in a locker.</NoticeBanner>
        ) : bankPledged && !activePledge ? (
          <NoticeBanner>Gold is currently pledged to a bank.</NoticeBanner>
        ) : null}

        {activePledge ? (
          <>
            <FieldGrid
              style={{ marginBottom: 14 }}
              items={[
                { k: "Bank", v: activePledge.bankName },
                { k: "Pledged amount", v: inr(activePledge.pledgedAmount) },
                { k: "Pledge date", v: dmy(activePledge.pledgeDate) },
                { k: "Reference", v: activePledge.referenceNumber || "—" },
                { k: "Bank interest", v: activePledge.bankInterestRate != null ? `${activePledge.bankInterestRate}% p.a.` : "—" },
                { k: "Due date", v: dmy(activePledge.bankPledgeDueDate) },
                { k: "Cash treatment", v: activePledge.cashTreatment === "CashIn" ? "Added to Cash-in-Hand" : "Record only — no cash effect" },
              ]}
            />
            <ErrorText>{error}</ErrorText>
            {canUpdate ? (
              <BtnRow2 style={{ marginBottom: 12 }}>
                <PrimaryButton label="Delete Entry" variant="reject" onPress={() => setVoidOpen(true)} />
                <PrimaryButton label="Release from Bank" onPress={() => setConfirmRelease(true)} />
              </BtnRow2>
            ) : null}
          </>
        ) : !isFinished && canCreate ? (
          <BankPledgeForm value={form} onChange={setForm} fixedLoan={l} error={error} onSubmit={() => record.mutate()} submitting={record.isPending} />
        ) : (
          <Txt style={{ fontSize: 12.5, color: C.muted, marginBottom: 14 }}>
            Gold is {l.bankPledgeStatus === "Released" ? "released to customer" : "held in-house"}
            {l.bankPledgeStatus ? ` — ${l.bankPledgeStatus}` : ""}
          </Txt>
        )}
        <AccBtn label="View Pledge History" onPress={() => setHistoryOpen(true)} />
      </Sheet>

      <Sheet visible={confirmRelease} onClose={() => setConfirmRelease(false)} title="Release from Bank?">
        <Txt style={{ fontSize: 12.5, color: C.muted, lineHeight: 18, marginVertical: 10 }}>
          {activePledge?.cashTreatment === "CashIn"
            ? `This books ${inr(activePledge?.pledgedAmount)} back OUT of Cash-in-Hand — the amount this pledge originally brought in.`
            : "This pledge never moved cash, so releasing it has no cash effect."}
        </Txt>
        <ErrorText>{error}</ErrorText>
        <BtnRow2>
          <PrimaryButton label="Cancel" variant="outline" onPress={() => setConfirmRelease(false)} />
          <PrimaryButton label="Release" onPress={() => activePledge && release.mutate(activePledge.id)} loading={release.isPending} />
        </BtnRow2>
      </Sheet>

      <Sheet visible={voidOpen} onClose={() => setVoidOpen(false)} title="Delete Repledge Record">
        <View style={{ height: 8 }} />
        <NoticeBanner>
          Cancel Pledge Entry — for a pledge recorded in error, not an actual gold return (use Release for that). Reverses any cash movement the original pledge made; the record stays visible in history for audit.
        </NoticeBanner>
        <TextField label="Reason *" value={voidReason} onChangeText={setVoidReason} placeholder="e.g. wrong cash treatment entered" />
        <ErrorText>{error}</ErrorText>
        <PrimaryButton label="Delete Entry" variant="danger" onPress={() => activePledge && voidIt.mutate(activePledge.id)} loading={voidIt.isPending} disabled={!voidReason.trim()} />
      </Sheet>

      <Sheet visible={historyOpen} onClose={() => setHistoryOpen(false)} title="Bank Pledge History">
        {history.isLoading ? (
          <Buffering block />
        ) : (history.data ?? []).length === 0 ? (
          <EmptyText>No bank pledge history for this loan yet.</EmptyText>
        ) : (
          (history.data ?? []).map((p, i) => (
            <PledgeItem
              key={p.id}
              first={i === 0}
              icon={p.status === "Voided" ? "close" : p.status === "Active" ? "shield" : "check"}
              iconBg={p.status === "Active" ? C.greenBg : p.status === "Voided" ? C.redBg : undefined}
              iconColor={p.status === "Active" ? C.green : p.status === "Voided" ? C.red : undefined}
              // Wire value stays "Voided"; only the displayed label is "Deleted".
              title={`${p.bankName} · ${p.status === "Voided" ? "Deleted" : p.status}`}
              sub={`${inr(p.pledgedAmount)}${p.referenceNumber ? ` · Ref ${p.referenceNumber}` : ""}${p.releaseDate ? ` · released ${dmy(p.releaseDate)}` : ""}${
                p.status === "Voided" && p.voidReason ? ` · ${p.voidReason}` : ""
              }`}
              date={dmy(p.pledgeDate)}
            />
          ))
        )}
      </Sheet>
    </>
  );
}
