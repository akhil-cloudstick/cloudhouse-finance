import React, { useEffect, useState } from "react";
import { View } from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AccBtn,
  AsyncSelect,
  BtnRow2,
  Buffering,
  C,
  ChipToggle,
  DateField,
  EmptyText,
  Field,
  FieldGrid,
  FieldRow,
  Input,
  NoticeBanner,
  PledgeItem,
  PrimaryButton,
  Sheet,
  TextField,
  Txt,
  WarningBanner,
} from "../../ui";
import { getBankPledgeHistory, recordBankPledge, releaseBankPledge, voidBankPledge } from "../../../api/bankPledges";
import { listBanks } from "../../../api/banks";
import { dmy, inr, todayISO } from "../../../lib/format";
import type { Loan } from "../../../types/loan";
import { ErrorText, apiErr, invalidateLoan } from "./common";

type CashTreatment = "RecordOnly" | "CashIn";

/** Bank pledge (repledge) for one loan, in the prototype's sheet style —
 * parity with frontend BankPledge.tsx: bank picker (bankId), interest rate +
 * due date, Release, Delete (void) for a mis-recorded pledge, and History.
 * Also carries the locker / fully-paid warnings the web LoanDetail shows. */
export function BankPledgeSheet({
  loan: l,
  packetStatus,
  visible,
  onClose,
}: {
  loan: Loan;
  packetStatus?: string;
  visible: boolean;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const isFinished = l.status === "Closed" || l.status === "Rejected";
  const activePledge = l.bankPledges?.find((p) => p.status === "Active");

  const [bankId, setBankId] = useState<number | undefined>();
  const [bankName, setBankName] = useState("");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(todayISO());
  const [rate, setRate] = useState("");
  const [due, setDue] = useState("");
  const [reference, setReference] = useState("");
  const [cash, setCash] = useState<CashTreatment>("RecordOnly");
  const [error, setError] = useState<string | null>(null);
  const [confirmRelease, setConfirmRelease] = useState(false);
  const [voidOpen, setVoidOpen] = useState(false);
  const [voidReason, setVoidReason] = useState("");
  const [historyOpen, setHistoryOpen] = useState(false);

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
        bankId,
        bankName,
        pledgedAmount: Number(amount),
        pledgeDate: date || todayISO(),
        bankInterestRate: rate ? Number(rate) : undefined,
        referenceNumber: reference.trim() || undefined,
        bankPledgeDueDate: due || undefined,
        cashTreatment: cash,
      }),
    onSuccess: () => {
      setBankId(undefined);
      setBankName("");
      setAmount("");
      setDate(todayISO());
      setRate("");
      setDue("");
      setReference("");
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
            <BtnRow2 style={{ marginBottom: 12 }}>
              <PrimaryButton label="Delete Entry" variant="reject" onPress={() => setVoidOpen(true)} />
              <PrimaryButton label="Release from Bank" onPress={() => setConfirmRelease(true)} />
            </BtnRow2>
          </>
        ) : !isFinished ? (
          <>
            <AsyncSelect
              label="Bank"
              placeholder="Search banks"
              queryKey={["banks-picker"]}
              fetcher={(q) => listBanks(q || undefined)}
              selectedLabel={bankName || undefined}
              keyOf={(b) => b.id}
              renderItem={(b) => ({ title: b.name })}
              onSelect={(b) => {
                setBankId(b.id);
                setBankName(b.name);
              }}
            />
            <TextField label="Pledged amount" keyboardType="decimal-pad" value={amount} onChangeText={setAmount} placeholder="0" />
            <FieldRow>
              <DateField label="Pledge date" value={date} onChange={setDate} max={todayISO()} />
              <Field label="Interest rate %">
                <Input keyboardType="decimal-pad" value={rate} onChangeText={setRate} placeholder="0" />
              </Field>
            </FieldRow>
            <DateField label="Due date" value={due} onChange={setDue} min={date || undefined} clearable />
            <TextField label="Reference number" value={reference} onChangeText={setReference} placeholder="Optional" />
            <Field label="Cash treatment">
              <ChipToggle options={["RecordOnly", "CashIn"] as const} value={cash} onChange={setCash} labels={{ RecordOnly: "Record only", CashIn: "Add to cash-in-hand" }} />
            </Field>
            <ErrorText>{error}</ErrorText>
            <PrimaryButton label="Repledge to Bank" onPress={() => record.mutate()} loading={record.isPending} disabled={!bankName || !(Number(amount) > 0)} style={{ marginBottom: 12 }} />
          </>
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
