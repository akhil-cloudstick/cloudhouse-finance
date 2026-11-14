import React, { useState } from "react";
import { View } from "react-native";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Buffering, toast, C, ChipToggle, DateField, FieldGrid, Field, NoticeBanner, PrimaryButton, ResultBox, Sheet, TextField, Txt, WarningBanner } from "@/common/components/ui";
import {
  issueAuctionNotice,
  markAuctionEligible,
  recordAuctionSale,
  resolveAuctionDecision,
  scheduleAuction,
  settleAuction,
} from "@/modules/auctions/services/auctionService";
import {
  AUCTION_OUTCOME_LABELS,
  hasUndisposedSurplus,
  pendingDecision,
  type AuctionDecisionStatus,
  type AuctionRecord,
  type AuctionSurplusDisposition,
} from "@/modules/auctions/types/auction-types";
import { useAuth } from "@/common/providers/AuthProvider";
import { isFlowOff, stageByKey, canActAtStage, useApprovalWorkflow } from "@/common/services/approvalWorkflowService";
import { dmy, inr, todayISO } from "@/common/utils/format";
import type { Loan } from "@/modules/loans/types/loan-types";
import { apiErr, invalidateLoan } from "@/common/components/loanSheetKit";
import { SplitPaymentInput, type SplitPayment } from "@/common/components/SplitPaymentInput";
import { ErrorText } from "@/common/components/ErrorText";
import { GoldAtBankBlock } from "@/modules/auctions/components/GoldAtBankBlock";
import { getLoan } from "@/modules/loans/services/loanService";
import { printAuctionLetter } from "@/modules/loans/utils/loanPrint";

const DECISION_LABELS: Record<string, string> = {
  PursueBalance: "Pursue balance",
  WriteOff: "Write off",
  RemovedFromAuction: "Remove from auction",
  KeepInAuction: "Keep in auction",
};

type AuctionSheetProps = {
  loan: Loan;
  auction?: AuctionRecord | null;
  loading?: boolean;
  visible: boolean;
  onClose: () => void;
};

/** Auction (7-stage workflow) for one loan in the prototype's sheet style:
 * mark eligible → notice → schedule → sale → settle, plus the frozen-pipeline
 * escalation decisions (partial repayment / shortfall). */
export function AuctionSheet({
  loan: l,
  auction: rec,
  loading,
  visible,
  onClose,
}: AuctionSheetProps) {
  const qc = useQueryClient();
  const wf = useApprovalWorkflow();
  const { can, employee } = useAuth();
  const canAct = can("Loan_Management", "can_update_loan");
  // Gold sitting with a bank cannot be noticed, scheduled or sold (the server rejects it too); settling is unaffected.
  const goldAtBank = l.bankPledgeStatus === "Bank Pledged";
  const aw = (k: string) => canAct && !(goldAtBank && k !== "can_settle_auction") && can("Auction_Workflow", k);
  const [error, setError] = useState<string | null>(null);
  const [auctionDate, setAuctionDate] = useState(todayISO());
  const [printing, setPrinting] = useState(false);
  const [referenceNumber, setReferenceNumber] = useState("");
  const [saleAmount, setSaleAmount] = useState("");
  const [expenses, setExpenses] = useState("");
  const [disposition, setDisposition] = useState<AuctionSurplusDisposition | "">("");
  const [dispositionRemarks, setDispositionRemarks] = useState("");
  const [decision, setDecision] = useState<Exclude<AuctionDecisionStatus, "Pending"> | "">("");
  const [decisionRemarks, setDecisionRemarks] = useState("");

  const ok = () => {
    setError(null);
    invalidateLoan(qc, l.id);
    qc.invalidateQueries({ queryKey: ["auctionHistory"] });
  };
  const onError = (e: unknown) => setError(apiErr(e));
  const id = l.id;

  const eligible = useMutation({ mutationFn: () => markAuctionEligible(id), onSuccess: ok, onError });
  const notice = useMutation({ mutationFn: () => issueAuctionNotice(id), onSuccess: ok, onError });
  const schedule = useMutation({ mutationFn: () => scheduleAuction(id, auctionDate, referenceNumber.trim() || undefined), onSuccess: ok, onError });
  // Sale proceeds land in the modes/bank staff pick; a surplus refund goes out in ONE mode (the backend stores a
  // single mode and bank for it). Without these the server books everything as cash.
  const [salePay, setSalePay] = useState<SplitPayment | null>(null);
  const [refundPay, setRefundPay] = useState<SplitPayment | null>(null);
  const sale = useMutation({
    mutationFn: () =>
      recordAuctionSale(
        id,
        Number(saleAmount),
        expenses ? Number(expenses) : undefined,
        salePay ? { cashAmount: salePay.split.cashAmount, upiAmount: salePay.split.upiAmount, bankTransferAmount: salePay.split.bankTransferAmount, bankId: salePay.bankId } : undefined
      ),
    onSuccess: ok,
    onError,
  });
  const refundModes = refundPay
    ? ([refundPay.split.cashAmount > 0 && "Cash", refundPay.split.upiAmount > 0 && "UPI", refundPay.split.bankTransferAmount > 0 && "Bank Transfer"].filter(Boolean) as string[])
    : [];
  const refundMode = disposition === "RefundedToCustomer" && refundModes.length === 1 ? refundModes[0] : undefined;
  const refundOk = disposition !== "RefundedToCustomer" || (!!refundPay?.ready && !!refundMode && (refundMode === "Cash" || !!refundPay.bankId));
  const settle = useMutation({
    mutationFn: () => settleAuction(id, disposition as AuctionSurplusDisposition, dispositionRemarks.trim() || undefined, refundMode, refundMode ? refundPay?.bankId : undefined),
    onSuccess: () => {
      setDisposition("");
      setDispositionRemarks("");
      ok();
    },
    onError,
  });
  const decide = useMutation({
    mutationFn: (requestId: number) => resolveAuctionDecision(id, requestId, decision as Exclude<AuctionDecisionStatus, "Pending">, decisionRemarks.trim() || undefined),
    onSuccess: () => {
      setDecision("");
      setDecisionRemarks("");
      ok();
    },
    onError,
  });

  const decisionReq = pendingDecision(rec);
  // While an escalation is open the pipeline is frozen server-side.
  const frozen = !!decisionReq;
  // Who may decide is the flow's own "Auction Workflow" permission; with the
  // tenant's decision flow switched off no human decision is taken (the
  // backend applies the flow's automatic outcome instead).
  const decisionFlow = decisionReq?.kind === "Shortfall" ? "auction_shortfall" : "auction_partial_repayment";
  const decisionFlowOff = isFlowOff(wf, decisionFlow);
  const decisionStage = stageByKey(wf, decisionFlow, "Decision");
  const canDecideThis = canAct && !!decisionStage && canActAtStage(employee, decisionStage);
  const balanceDue = l.status === "Auctioned - Balance Due";
  // getAuction only returns the ACTIVE case — a null record with an Auctioned
  // status means the pipeline already concluded, not "never started".
  const alreadyAuctioned = l.status === "Auctioned" || balanceDue;
  const preSale = !!rec && (rec.stage === "AuctionEligible" || rec.stage === "NoticeIssued" || rec.stage === "AuctionScheduled");
  const lastAuto = rec ? [...(rec.decisionRequests ?? [])].reverse().find((d) => d.decidedByRole === "System") : undefined;
  const partialAuto = isFlowOff(wf, "auction_partial_repayment");
  async function printNotice() {
    if (printing) return;
    setPrinting(true);
    try {
      await printAuctionLetter(await getLoan(id), rec?.auctionDate);
    } catch {
      toast.error("Could not print", "Could not print the notice — try again.");
    } finally {
      setPrinting(false);
    }
  }

  return (
    <Sheet visible={visible} onClose={onClose} title="Auction" maxHeightPct={90}>
      <View style={{ height: 8 }} />
      {loading ? (
        <Buffering block />
      ) : !rec ? (
        alreadyAuctioned ? (
          <Txt style={{ fontSize: 12.5, color: C.muted }}>This loan&apos;s gold was already sold at auction — see Auction History for the outcome.</Txt>
        ) : l.isDefaulted ? (
          goldAtBank ? (
            <GoldAtBankBlock loanId={id} />
          ) : aw("can_mark_loan_auction_eligible") ? (
            <>
              <NoticeBanner>This loan has defaulted and can be moved into the auction pipeline.</NoticeBanner>
              <ErrorText>{error}</ErrorText>
              <PrimaryButton label="Mark Auction Eligible" onPress={() => eligible.mutate()} loading={eligible.isPending} />
            </>
          ) : (
            <Txt style={{ fontSize: 12.5, color: C.muted }}>Eligible for auction — your role can&apos;t mark it, though.</Txt>
          )
        ) : (
          null
        )
      ) : (
        <>
          <FieldGrid
            style={{ marginBottom: 14 }}
            items={[
              { k: "Stage", v: rec.stage },
              { k: "Eligible since", v: dmy(rec.auctionEligibleDate) },
              { k: "Auction date", v: dmy(rec.auctionDate) },
              { k: "Reference", v: rec.auctionReferenceNumber || "—" },
            ]}
          />

          {decisionReq ? (
            <>
              <WarningBanner>
                {decisionReq.kind === "Shortfall"
                  ? `Shortfall — awaiting authority. The sale realised ${inr(decisionReq.amountPaid)} and left ${inr(decisionReq.outstandingAtRequest)} owing.`
                  : `Decision pending. ${inr(decisionReq.amountPaid)} was paid, leaving ${inr(decisionReq.outstandingAtRequest)} owing. No notice, schedule, or sale can proceed until this is resolved.`}
                {!canDecideThis ? " View only." : ""}
              </WarningBanner>
              {decisionFlowOff ? <NoticeBanner>Older case needs decision.</NoticeBanner> : null}
              {canDecideThis ? (
                <>
                  <Field label="Decision">
                    <ChipToggle
                      options={decisionReq.kind === "Shortfall" ? (["PursueBalance", "WriteOff"] as const) : (["RemovedFromAuction", "KeepInAuction"] as const)}
                      value={decision as never}
                      onChange={(v) => setDecision(v)}
                      labels={DECISION_LABELS}
                    />
                  </Field>
                  <TextField
                    label={`Remarks${decisionReq.kind === "Shortfall" ? " *" : ""}`}
                    value={decisionRemarks}
                    onChangeText={setDecisionRemarks}
                    placeholder="Reason for this decision"
                  />
                  <ErrorText>{error}</ErrorText>
                  <PrimaryButton
                    label="Record Decision"
                    onPress={() => decide.mutate(decisionReq.id)}
                    loading={decide.isPending}
                    disabled={!decision || (decisionReq.kind === "Shortfall" && !decisionRemarks.trim())}
                    style={{ marginBottom: 12 }}
                  />
                </>
              ) : null}
            </>
          ) : null}

          {balanceDue && !decisionReq ? <NoticeBanner>Balance due after auction — collect it as a normal payment.</NoticeBanner> : null}
          {hasUndisposedSurplus(rec) && !frozen ? <NoticeBanner>{`${inr(rec.surplusPayableAmount)} surplus pending. Settle to refund.`}</NoticeBanner> : null}
          {!decisionReq && (lastAuto || (preSale && partialAuto)) ? (
            <NoticeBanner>{lastAuto?.kind === "Shortfall" ? "Balance pursued automatically." : "No decision needed. Auction continues."}</NoticeBanner>
          ) : null}
          {goldAtBank && !frozen && preSale ? <GoldAtBankBlock loanId={id} /> : null}

          {!frozen && aw("can_issue_auction_notice") && (rec.stage === "AuctionEligible" || rec.stage === "NoticeIssued") ? (
            <>
              <Field label="Channel">
                <Txt style={{ fontSize: 13.5 }}>WhatsApp — sent automatically</Txt>
              </Field>
              <ErrorText>{error}</ErrorText>
              <PrimaryButton label="Issue Notice" onPress={() => notice.mutate()} loading={notice.isPending} />
            </>
          ) : null}
          {rec.stage === "NoticeIssued" ? <PrimaryButton label={printing ? "Preparing…" : "Print Notice"} variant="outline" onPress={printNotice} disabled={printing} style={{ marginBottom: 8 }} /> : null}

          {!frozen && aw("can_schedule_auction") && rec.stage === "NoticeIssued" ? (
            <>
              <DateField label="Auction date" value={auctionDate} onChange={setAuctionDate} min={todayISO()} />
              <TextField label="Reference number" value={referenceNumber} onChangeText={setReferenceNumber} placeholder="Optional" />
              {/* same fields as the Auction Flow sheet and web: date + reference number */}
              <ErrorText>{error}</ErrorText>
              <PrimaryButton label="Schedule Auction" onPress={() => schedule.mutate()} loading={schedule.isPending} disabled={!auctionDate} />
            </>
          ) : null}

          {!frozen && aw("can_record_auction_sale") && rec.stage === "AuctionScheduled" ? (
            <>
              <ResultBox k="Auction amount (debt to cover)" v={inr(l.totalOutstandingBalance ?? 0)} />
              <TextField label="Sale amount" keyboardType="decimal-pad" value={saleAmount} onChangeText={setSaleAmount} placeholder="0" />
              <TextField label="Auction expenses" keyboardType="decimal-pad" value={expenses} onChangeText={setExpenses} placeholder="0" />
              <SplitPaymentInput total={Math.max(0, Number(saleAmount) || 0)} onChange={setSalePay} bankLabel="Bank (account proceeds landed in)" />
              {Number(expenses) > Number(saleAmount) && Number(saleAmount) > 0 ? <ErrorText>Auction expenses cannot be more than the sale amount.</ErrorText> : null}
              {Number(saleAmount) > 0 ? (
                <NoticeBanner>
                  {(() => {
                    const p = Number(saleAmount) - (Number(expenses) || 0) - (l.totalOutstandingBalance ?? 0);
                    return p > 0.01 ? `Surplus ${inr(p)} — payable to the customer after the sale.` : p >= -0.01 ? "The sale exactly clears the debt — the loan will be closed." : `Shortfall — balance owing ${inr(Math.abs(p))}.`;
                  })()}
                </NoticeBanner>
              ) : null}
              <ErrorText>{error}</ErrorText>
              <PrimaryButton label="Record Sale" onPress={() => sale.mutate()} loading={sale.isPending} disabled={!(Number(saleAmount) > 0) || Number(expenses) > Number(saleAmount) || !salePay?.ready} />
            </>
          ) : null}

          {rec.stage === "Auctioned" ? (
            <>
              <ResultBox
                k={`Sale ${inr(rec.saleAmount)} · ${(rec.surplusShortfall ?? 0) >= 0 ? "Surplus" : "Shortfall"}`}
                v={inr(Math.abs(rec.surplusShortfall ?? 0))}
                tone={(rec.surplusShortfall ?? 0) >= 0 ? "green" : "red"}
              />
              {!frozen && aw("can_settle_auction") && !balanceDue && hasUndisposedSurplus(rec) ? (
                <>
                  <Txt style={{ fontSize: 12, color: C.muted, marginBottom: 12 }}>
                    {inr(rec.surplusPayableAmount)} surplus is payable back to {l.customer?.name ?? "the customer"} and has not been disposed of yet.
                  </Txt>
                  <Field label="Surplus disposition">
                    <ChipToggle
                      options={["RefundedToCustomer", "RecordedAsIncome"] as const}
                      value={disposition as never}
                      onChange={(v) => setDisposition(v)}
                      labels={{ RefundedToCustomer: "Refund to customer", RecordedAsIncome: "Record as income" }}
                    />
                  </Field>
                  {disposition === "RefundedToCustomer" ? (
                    <>
                      <SplitPaymentInput total={rec.surplusPayableAmount ?? Math.max(rec.surplusShortfall ?? 0, 0)} onChange={setRefundPay} bankLabel="Bank (account it is paid from)" />
                      {refundPay && refundModes.length > 1 ? <ErrorText>Refund the surplus in one payment mode — Cash, UPI or Bank Transfer.</ErrorText> : null}
                    </>
                  ) : null}
                  <TextField
                    label={`Remarks${disposition === "RecordedAsIncome" ? " *" : ""}`}
                    value={dispositionRemarks}
                    onChangeText={setDispositionRemarks}
                    placeholder="Reason / reference"
                  />
                  <ErrorText>{error}</ErrorText>
                  <PrimaryButton
                    label="Settle"
                    onPress={() => settle.mutate()}
                    loading={settle.isPending}
                    disabled={!disposition || (disposition === "RecordedAsIncome" && !dispositionRemarks.trim()) || !refundOk}
                  />
                </>
              ) : !balanceDue && !frozen ? (
                <Txt style={{ fontSize: 12, color: C.muted }}>The sale exactly covered the debt — nothing left to settle.</Txt>
              ) : null}
            </>
          ) : null}

          {rec.stage === "Settled" || rec.stage === "Withdrawn" ? (
            <ResultBox
              k="Outcome"
              v={rec.stage === "Settled" ? AUCTION_OUTCOME_LABELS[(rec.finalSettlementStatus as keyof typeof AUCTION_OUTCOME_LABELS) ?? "Pending"] : "Withdrawn"}
              tone={rec.stage === "Settled" ? "green" : "brand"}
            />
          ) : null}
        </>
      )}
    </Sheet>
  );
}
