import React, { useState } from "react";
import { View } from "react-native";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Buffering, C, ChipToggle, DateField, FieldGrid, Field, NoticeBanner, PrimaryButton, ResultBox, Sheet, TextField, Txt, WarningBanner } from "../../ui";
import {
  issueAuctionNotice,
  markAuctionEligible,
  recordAuctionSale,
  resolveAuctionDecision,
  scheduleAuction,
  settleAuction,
} from "../../../api/auctions";
import {
  AUCTION_OUTCOME_LABELS,
  hasUndisposedSurplus,
  pendingDecision,
  type AuctionDecisionStatus,
  type AuctionRecord,
  type AuctionSurplusDisposition,
} from "../../../types/auction";
import { useAuth } from "../../../auth/AuthContext";
import { isFlowOff, stageByKey, canActAtStage, useApprovalWorkflow } from "../../../api/approvalWorkflow";
import { dmy, inr, todayISO } from "../../../lib/format";
import type { Loan } from "../../../types/loan";
import { ErrorText, apiErr, invalidateLoan } from "./common";

const DECISION_LABELS: Record<string, string> = {
  PursueBalance: "Pursue balance",
  WriteOff: "Write off",
  RemovedFromAuction: "Remove from auction",
  KeepInAuction: "Keep in auction",
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
}: {
  loan: Loan;
  auction?: AuctionRecord | null;
  loading?: boolean;
  visible: boolean;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const wf = useApprovalWorkflow();
  const { can, employee } = useAuth();
  const canAct = can("Loan_Management", "can_update_loan");
  const [error, setError] = useState<string | null>(null);
  const [auctionDate, setAuctionDate] = useState("");
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
  };
  const onError = (e: unknown) => setError(apiErr(e));
  const id = l.id;

  const eligible = useMutation({ mutationFn: () => markAuctionEligible(id), onSuccess: ok, onError });
  const notice = useMutation({ mutationFn: () => issueAuctionNotice(id), onSuccess: ok, onError });
  const schedule = useMutation({ mutationFn: () => scheduleAuction(id, auctionDate, referenceNumber.trim() || undefined), onSuccess: ok, onError });
  const sale = useMutation({ mutationFn: () => recordAuctionSale(id, Number(saleAmount), expenses ? Number(expenses) : undefined), onSuccess: ok, onError });
  const settle = useMutation({
    mutationFn: () => settleAuction(id, disposition as AuctionSurplusDisposition, dispositionRemarks.trim() || undefined),
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
  const canDecideThis = canAct && !!decisionStage && canActAtStage(employee?.role, decisionStage);
  const balanceDue = l.status === "Auctioned - Balance Due";
  // getAuction only returns the ACTIVE case — a null record with an Auctioned
  // status means the pipeline already concluded, not "never started".
  const alreadyAuctioned = l.status === "Auctioned" || balanceDue;

  return (
    <Sheet visible={visible} onClose={onClose} title="Auction" maxHeightPct={90}>
      <View style={{ height: 8 }} />
      {loading ? (
        <Buffering block />
      ) : !rec ? (
        alreadyAuctioned ? (
          <Txt style={{ fontSize: 12.5, color: C.muted }}>This loan&apos;s gold was already sold at auction — see Auction History for the outcome.</Txt>
        ) : l.isDefaulted ? (
          canAct ? (
            <>
              <NoticeBanner>This loan has defaulted and can be moved into the auction pipeline.</NoticeBanner>
              <ErrorText>{error}</ErrorText>
              <PrimaryButton label="Mark Auction Eligible" onPress={() => eligible.mutate()} loading={eligible.isPending} />
            </>
          ) : (
            <Txt style={{ fontSize: 12.5, color: C.muted }}>Eligible for auction — your role can&apos;t mark it, though.</Txt>
          )
        ) : (
          <Txt style={{ fontSize: 12.5, color: C.muted }}>Not eligible for auction.</Txt>
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
                {!canDecideThis ? " Your role can view this but not decide it." : ""}
              </WarningBanner>
              {decisionFlowOff ? <NoticeBanner>Decisions are now switched off for new cases, but this one was raised before that change and still needs a decision.</NoticeBanner> : null}
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

          {balanceDue && !decisionReq ? (
            <NoticeBanner>
              Balance due after auction — this loan has returned to normal collection. Record payments against it as usual; the auction will close itself once the balance is cleared.
            </NoticeBanner>
          ) : null}

          {!frozen && canAct && rec.stage === "AuctionEligible" ? (
            <>
              <ErrorText>{error}</ErrorText>
              <PrimaryButton label="Issue Notice" onPress={() => notice.mutate()} loading={notice.isPending} />
            </>
          ) : null}

          {!frozen && canAct && rec.stage === "NoticeIssued" ? (
            <>
              <DateField label="Auction date" value={auctionDate} onChange={setAuctionDate} min={todayISO()} />
              <TextField label="Reference number" value={referenceNumber} onChangeText={setReferenceNumber} placeholder="Optional" />
              <ErrorText>{error}</ErrorText>
              <PrimaryButton label="Schedule Auction" onPress={() => schedule.mutate()} loading={schedule.isPending} disabled={!auctionDate} />
            </>
          ) : null}

          {!frozen && canAct && rec.stage === "AuctionScheduled" ? (
            <>
              <TextField label="Sale amount" keyboardType="decimal-pad" value={saleAmount} onChangeText={setSaleAmount} placeholder="0" />
              <TextField label="Auction expenses" keyboardType="decimal-pad" value={expenses} onChangeText={setExpenses} placeholder="0" />
              <ErrorText>{error}</ErrorText>
              <PrimaryButton label="Record Sale" onPress={() => sale.mutate()} loading={sale.isPending} disabled={!(Number(saleAmount) > 0)} />
            </>
          ) : null}

          {rec.stage === "Auctioned" ? (
            <>
              <ResultBox
                k={`Sale ${inr(rec.saleAmount)} · ${(rec.surplusShortfall ?? 0) >= 0 ? "Surplus" : "Shortfall"}`}
                v={inr(Math.abs(rec.surplusShortfall ?? 0))}
                tone={(rec.surplusShortfall ?? 0) >= 0 ? "green" : "red"}
              />
              {!frozen && canAct && !balanceDue && hasUndisposedSurplus(rec) ? (
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
                    disabled={!disposition || (disposition === "RecordedAsIncome" && !dispositionRemarks.trim())}
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
