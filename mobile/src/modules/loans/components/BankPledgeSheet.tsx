import React, { useEffect, useState } from "react";
import { View } from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AccGroup, AccRow, BtnRow2, C, CheckItem, FieldGrid, NoticeBanner, PrimaryButton, Sheet, TextField, Txt, WarningBanner } from "@/common/components/ui";
import { getBankPledgeHistory, recordBankPledge, releaseBankPledge, voidBankPledge } from "@/modules/bank-pledges/services/bankPledgeService";
import { dmy, inr, todayISO } from "@/common/utils/format";
import type { Loan } from "@/modules/loans/types/loan-types";
import { apiErr, invalidateLoan } from "@/common/components/loanSheetKit";
import { ErrorText } from "@/common/components/ErrorText";
import { BankPledgeForm, bankPledgeFormInit, cashInPayload } from "@/common/components/BankPledgeForm";
import { SplitPaymentInput, type SplitPayment } from "@/common/components/SplitPaymentInput";
import { useAuth } from "@/common/providers/AuthProvider";
import { fmtW, pledgeOrnaments, pledgeOverdue } from "@/modules/loans/utils/pledgeView";
import { BankPledgeEditSheet } from "@/modules/loans/components/BankPledgeEditSheet";
import type { BankPledgeRecord } from "@/modules/loans/types/loan-types";

type BankPledgeSheetProps = {
  loan: Loan;
  packetStatus?: string;
  visible: boolean;
  onClose: () => void;
};

/** Bank pledge (repledge) for one loan, in the prototype's sheet style —
 * parity with frontend BankPledge.tsx: bank picker (bankId), interest rate +
 * due date, Release and Delete (void) for a mis-recorded pledge.
 * Also carries the locker / fully-paid warnings the web LoanDetail shows. */
export function BankPledgeSheet({
  loan: l,
  packetStatus,
  visible,
  onClose,
}: BankPledgeSheetProps) {
  const qc = useQueryClient();
  // Same statuses the backend refuses a pledge on (models.BankPledgeIneligibleStatuses).
  const isFinished = ["Closed", "Rejected", "Closure Requested", "Pending Approval", "Auctioned", "Auctioned - Balance Due"].includes(l.status ?? "");
  // A loan can carry several active pledges, each covering a subset of ornaments (web RepledgeModalContent).
  const activePledges = (l.bankPledges ?? []).filter((p) => p.status === "Active");
  const [targetId, setTargetId] = useState<number | null>(null);
  const activePledge = activePledges.find((p) => p.id === targetId) ?? activePledges[0];
  const pledgedIds = new Set(activePledges.flatMap((p) => p.ornamentIds ?? []));
  const wholeLoanPledged = activePledges.some((p) => !p.ornamentIds || p.ornamentIds.length === 0);
  // Ornaments that can still go to a bank: not handed back and not already with a bank.
  const available = (l.ornaments ?? []).filter((o) => !o.releasedAt && !wholeLoanPledged && !pledgedIds.has(o.id));
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const availableKey = available.map((o) => o.id).join(",");
  useEffect(() => { setPicked(new Set(available.map((o) => o.id))); }, [availableKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const togglePicked = (id: number) => setPicked((cur) => { const n = new Set(cur); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const pickedList = available.filter((o) => picked.has(o.id));
  const wholeLoan = activePledges.length === 0 && pickedList.length === available.length;

  const [form, setForm] = useState(() => bankPledgeFormInit(l));
  const [error, setError] = useState<string | null>(null);
  const [confirmRelease, setConfirmRelease] = useState(false);
  // How the pledged amount is paid back to the bank (a "CashIn" pledge only).
  const [releasePay, setReleasePay] = useState<SplitPayment | null>(null);
  const [voidOpen, setVoidOpen] = useState(false);
  const [voidReason, setVoidReason] = useState("");
  const { can } = useAuth();
  const canCreate = can("Bank_Pledge_Management", "can_create_bank_pledge");
  const canUpdate = can("Bank_Pledge_Management", "can_update_bank_pledge");
  // Correcting or erasing a pledge rewrites its ledger lines, so it takes the ledger edit/delete grants too (web).
  const canEditPledge = canUpdate && can("Loan_Management", "can_edit_ledger_entry");
  const canErasePledge = canUpdate && can("Loan_Management", "can_delete_ledger_entry");
  const [editing, setEditing] = useState<{ pledge: BankPledgeRecord; mode: "edit" | "delete" } | null>(null);
  const historyQ = useQuery({ queryKey: ["bankPledgeHistory", l.id], queryFn: () => getBankPledgeHistory(l.id), enabled: visible });
  const history = historyQ.data ?? [];

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
        ...cashInPayload(form),
        ...(wholeLoan ? {} : { ornamentIds: pickedList.map((o) => o.id) }),
      }),
    onSuccess: () => {
      setForm(bankPledgeFormInit(l));
      done();
    },
    onError: (e) => setError(apiErr(e)),
  });

  const release = useMutation({
    mutationFn: (pledgeId: number) =>
      releaseBankPledge(l.id, pledgeId, activePledge?.cashTreatment === "CashIn" && releasePay ? { ...releasePay.split, bankId: releasePay.bankId } : undefined),
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

        {activePledges.map((ap) => (
          <View key={ap.id}>
            <FieldGrid
              style={{ marginBottom: 14 }}
              items={[
                { k: "Bank", v: ap.bankName },
                { k: "Ornaments", v: pledgeOrnaments(ap, l) },
                { k: "Gross weight", v: fmtW(ap.pledgedGrossWeight) },
                { k: "Net weight", v: fmtW(ap.pledgedNetWeight) },
                { k: "Pledged amount", v: inr(ap.pledgedAmount) },
                { k: "Pledge date", v: dmy(ap.pledgeDate) },
                { k: "Reference", v: ap.referenceNumber || "—" },
                { k: "Interest rate", v: ap.bankInterestRate ? `${ap.bankInterestRate}% p.m.` : "—" },
                { k: "Due date", v: dmy(ap.bankPledgeDueDate) + (pledgeOverdue(ap) ? "  · Overdue" : ""), color: pledgeOverdue(ap) ? C.red : undefined },
                { k: "Cash treatment", v: ap.cashTreatment === "CashIn" ? "Added to Cash-in-Hand" : "Record only — no cash effect" },
              ]}
            />
            {canUpdate ? (
              <BtnRow2 style={{ marginBottom: 12 }}>
                <PrimaryButton label="Delete Entry" variant="reject" onPress={() => { setTargetId(ap.id); setVoidOpen(true); }} />
                <PrimaryButton label="Release from Bank" onPress={() => { setTargetId(ap.id); setConfirmRelease(true); }} />
              </BtnRow2>
            ) : null}
            {canEditPledge || canErasePledge ? (
              <BtnRow2 style={{ marginBottom: 12 }}>
                {canErasePledge ? <PrimaryButton label="Remove" variant="outline" onPress={() => setEditing({ pledge: ap, mode: "delete" })} /> : null}
                {canEditPledge ? <PrimaryButton label="Edit" variant="outline" onPress={() => setEditing({ pledge: ap, mode: "edit" })} /> : null}
              </BtnRow2>
            ) : null}
          </View>
        ))}
        {activePledges.length > 0 ? <ErrorText>{error}</ErrorText> : null}
        {!isFinished && canCreate && available.length > 0 ? (
          <>
            {l.ornaments && l.ornaments.length > 0 ? (
              <>
                <Txt style={{ fontSize: 12, fontWeight: "700", color: C.muted, marginBottom: 6 }}>{`Gold being pledged — ${pickedList.length} of ${available.length} selected`}</Txt>
                {available.map((o) => (
                  <CheckItem key={o.id} checked={picked.has(o.id)} onPress={() => togglePicked(o.id)} title={o.name} sub={`${o.quantity} pc · ${+o.netWeight.toFixed(2)} g net`} />
                ))}
                {pickedList.length === 0 ? <Txt style={{ fontSize: 12, color: C.red, marginBottom: 8 }}>Select at least one ornament to pledge.</Txt> : null}
              </>
            ) : null}
            <BankPledgeForm value={form} onChange={setForm} fixedLoan={l} error={error} onSubmit={() => record.mutate()} submitting={record.isPending} extraReady={pickedList.length > 0 || !(l.ornaments && l.ornaments.length)} />
          </>
        ) : activePledges.length > 0 ? null : (
          <Txt style={{ fontSize: 12.5, color: C.muted, marginBottom: 14 }}>
            Gold is {l.bankPledgeStatus === "Released" ? "released to customer" : "held in-house"}
            {l.bankPledgeStatus ? ` — ${l.bankPledgeStatus}` : ""}
          </Txt>
        )}
        {history.filter((r) => r.status !== "Active").length > 0 ? (
          <>
            <Txt style={{ fontSize: 12, fontWeight: "700", color: C.muted, marginBottom: 6 }}>Pledge history</Txt>
            <AccGroup>
              {history
                .filter((r) => r.status !== "Active")
                .map((r) => (
                  <AccRow
                    key={r.id}
                    id={dmy(r.pledgeDate)}
                    name={r.bankName}
                    amount={inr(r.pledgedAmount)}
                    status={r.status === "Voided" ? "Deleted" : r.status}
                    details={[
                      { k: "Ornaments", v: pledgeOrnaments(r, l) },
                      { k: "Gross weight", v: fmtW(r.pledgedGrossWeight) },
                      { k: "Net weight", v: fmtW(r.pledgedNetWeight) },
                      { k: "Interest rate", v: r.bankInterestRate ? `${r.bankInterestRate}% p.m.` : "—" },
                      { k: "Pledged", v: dmy(r.pledgeDate) },
                      { k: "Due date", v: dmy(r.bankPledgeDueDate) },
                      { k: "Released", v: dmy(r.releaseDate) },
                      ...(r.status === "Voided" && r.voidReason ? [{ k: "Delete reason", v: r.voidReason }] : []),
                    ]}
                    actions={
                      r.status !== "Voided" && (canEditPledge || canErasePledge)
                        ? [
                            ...(canEditPledge ? [{ label: "Edit", onPress: () => setEditing({ pledge: r, mode: "edit" as const }) }] : []),
                            ...(canErasePledge ? [{ label: "Remove", danger: true, onPress: () => setEditing({ pledge: r, mode: "delete" as const }) }] : []),
                          ]
                        : undefined
                    }
                  />
                ))}
            </AccGroup>
          </>
        ) : null}
      </Sheet>

      <Sheet visible={confirmRelease} onClose={() => setConfirmRelease(false)} title="Release from Bank?">
        <Txt style={{ fontSize: 12.5, color: C.muted, lineHeight: 18, marginVertical: 10 }}>
          {activePledge?.cashTreatment === "CashIn"
            ? `${inr(activePledge?.pledgedAmount)} is paid back to the bank — choose how below.`
            : "This pledge never moved cash, so releasing it has no cash effect."}
        </Txt>
        {activePledge?.cashTreatment === "CashIn" ? (
          <SplitPaymentInput total={activePledge.pledgedAmount} onChange={setReleasePay} bankLabel="Bank (account it leaves from)" />
        ) : null}
        <ErrorText>{error}</ErrorText>
        <BtnRow2>
          <PrimaryButton label="Cancel" variant="outline" onPress={() => setConfirmRelease(false)} />
          <PrimaryButton label="Release" onPress={() => activePledge && release.mutate(activePledge.id)} loading={release.isPending} disabled={activePledge?.cashTreatment === "CashIn" && !releasePay?.ready} />
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
      <BankPledgeEditSheet loanId={l.id} pledge={editing?.pledge ?? null} mode={editing?.mode ?? "edit"} onClose={() => setEditing(null)} />
    </>
  );
}
