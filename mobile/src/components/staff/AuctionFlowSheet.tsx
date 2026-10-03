import React, { useEffect, useState } from "react";
import { View } from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Buffering,
  BtnRow2,
  C,
  Card,
  ChipToggle,
  DateField,
  Field,
  FieldGrid,
  Input,
  MoveItem,
  NoticeBanner,
  PrimaryButton,
  ResultBox,
  SectionTitle,
  Sheet,
  Stepper,
  ThemeDropdown,
  Txt,
  WarningBanner,
} from "../ui";
import { useAuth } from "../../auth/AuthContext";
import { isFlowOff, stageByKey, canActAtStage, useApprovalWorkflow } from "../../api/approvalWorkflow";
import { ApiError } from "../../api/client";
import {
  getAuction,
  issueAuctionNotice,
  markAuctionEligible,
  recordAuctionSale,
  resolveAuctionDecision,
  scheduleAuction,
  settleAuction,
} from "../../api/auctions";
import {
  AUCTION_OUTCOME_LABELS,
  hasUndisposedSurplus,
  pendingDecision,
  type AuctionDecisionStatus,
  type AuctionRecord,
  type AuctionSurplusDisposition,
} from "../../types/auction";
import { dmy, inr, todayISO } from "../../lib/format";
import type { Loan } from "../../types/loan";

// Auction Flow (prototype #auction-workflow-modal) — one rise-up sheet that
// steps a loan through Eligible → Notice → Schedule → Conduct → Settle.
// Marking a defaulted loan Auction Eligible is the first step of the flow
// itself (it opens the case), not a separate tool. The step shown
// is driven by the loan's real auction record (GET /loans/:id/auction);
// every action is the same API call the loan detail screen makes, with the
// same permission and role gates.


const STEPS = ["Eligible", "Notice", "Schedule", "Conduct", "Settle"];
const NOTICE_TYPES = ["Registered post", "SMS + Email", "In-person"];
const DISPOSITIONS = ["RefundedToCustomer", "RecordedAsIncome"] as const;
const DISPOSITION_LABELS: Record<AuctionSurplusDisposition, string> = {
  RefundedToCustomer: "Refund to customer",
  RecordedAsIncome: "Record as income",
};
const DECISION_LABELS: Record<Exclude<AuctionDecisionStatus, "Pending">, string> = {
  KeepInAuction: "Keep in auction",
  RemovedFromAuction: "Remove from auction",
  PursueBalance: "Pursue balance",
  WriteOff: "Write off",
};

function stepOf(rec: AuctionRecord | null | undefined): number {
  switch (rec?.stage) {
    case "NoticeIssued":
      return 1;
    case "AuctionScheduled":
      return 2;
    case "Auctioned":
    case "Settled":
    case "Withdrawn":
      return 3;
    default:
      return 0;
  }
}

const errText = (msg: string | null) => (msg ? <Txt style={{ fontSize: 12, color: C.red, marginBottom: 10 }}>{msg}</Txt> : null);

export function AuctionFlowSheet({ loan, visible, onClose }: { loan: Loan | null; visible: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const { can, employee } = useAuth();
  const wf = useApprovalWorkflow();
  const canAct = can("Loan_Management", "can_update_loan");
  // Same gate as the web's Auctions page for opening a case.
  const canMarkEligible = canAct && can("Auction_Workflow", "can_mark_loan_auction_eligible");
  const loanId = loan?.id ?? 0;
  const key = String(loanId);

  const auction = useQuery({ queryKey: ["auction", key], queryFn: () => getAuction(loanId), enabled: visible && !!loan });
  const rec = auction.data ?? null;
  const current = stepOf(rec);
  const allDone = rec?.stage === "Settled" || rec?.stage === "Withdrawn";

  // Which step panel is on screen — follows the record, but Back lets staff
  // look at what an earlier step recorded.
  const [view, setView] = useState(0);
  useEffect(() => setView(current), [current, visible]);

  const [error, setError] = useState<string | null>(null);
  const [noticeType, setNoticeType] = useState(NOTICE_TYPES[0]);
  const [noticeDate, setNoticeDate] = useState(todayISO());
  const [deadline, setDeadline] = useState("");
  const [auctionDate, setAuctionDate] = useState("");
  const [reference, setReference] = useState("");
  const [saleAmount, setSaleAmount] = useState("");
  const [expenses, setExpenses] = useState("");
  const [disposition, setDisposition] = useState<AuctionSurplusDisposition>("RefundedToCustomer");
  const [dispRemarks, setDispRemarks] = useState("");
  const [decision, setDecision] = useState<Exclude<AuctionDecisionStatus, "Pending"> | "">("");
  const [decisionRemarks, setDecisionRemarks] = useState("");

  useEffect(() => {
    if (!visible) return;
    setError(null);
    setNoticeType(NOTICE_TYPES[0]);
    setNoticeDate(todayISO());
    setDeadline("");
    setAuctionDate("");
    setReference("");
    setSaleAmount("");
    setExpenses("");
    setDisposition("RefundedToCustomer");
    setDispRemarks("");
    setDecision("");
    setDecisionRemarks("");
  }, [visible, loanId]);

  function onOk() {
    setError(null);
    qc.invalidateQueries({ queryKey: ["auction", key] });
    qc.invalidateQueries({ queryKey: ["loan", key] });
    qc.invalidateQueries({ queryKey: ["loans"] });
    qc.invalidateQueries({ queryKey: ["auctionHistory"] });
  }
  const onError = (err: unknown) => setError(err instanceof ApiError ? err.message : "Could not complete that action.");

  const eligible = useMutation({ mutationFn: () => markAuctionEligible(loanId), onSuccess: onOk, onError });
  const notice = useMutation({
    // The notice endpoint stores free-text remarks; the notice type and
    // dates the prototype asks for are recorded there.
    mutationFn: () =>
      issueAuctionNotice(
        loanId,
        [noticeType, noticeDate ? `issued ${dmy(noticeDate)}` : null, deadline ? `respond by ${dmy(deadline)}` : null].filter(Boolean).join(" · ")
      ),
    onSuccess: onOk,
    onError,
  });
  const schedule = useMutation({ mutationFn: () => scheduleAuction(loanId, auctionDate, reference.trim() || undefined), onSuccess: onOk, onError });
  const sale = useMutation({
    mutationFn: () => recordAuctionSale(loanId, Number(saleAmount), expenses ? Number(expenses) : undefined),
    onSuccess: onOk,
    onError,
  });
  const settle = useMutation({
    mutationFn: () => settleAuction(loanId, disposition, dispRemarks.trim() || undefined),
    onSuccess: onOk,
    onError,
  });
  const decide = useMutation({
    mutationFn: (requestId: number) =>
      resolveAuctionDecision(loanId, requestId, decision as Exclude<AuctionDecisionStatus, "Pending">, decisionRemarks.trim() || undefined),
    onSuccess: () => {
      setDecision("");
      setDecisionRemarks("");
      onOk();
    },
    onError,
  });

  if (!loan) return null;

  const decisionReq = pendingDecision(rec);
  const frozen = !!decisionReq;
  // Who may decide is the flow's own "Auction Workflow" permission; with the
  // tenant's decision flow switched off no human decision is taken (the
  // backend applies the flow's automatic outcome instead).
  const decisionFlow = decisionReq?.kind === "Shortfall" ? "auction_shortfall" : "auction_partial_repayment";
  const decisionFlowOff = isFlowOff(wf, decisionFlow);
  const decisionStage = stageByKey(wf, decisionFlow, "Decision");
  const canDecide = canAct && !!decisionStage && canActAtStage(employee?.role, decisionStage);
  const balanceDue = loan.status === "Auctioned - Balance Due";
  const alreadyAuctioned = loan.status === "Auctioned" || balanceDue;
  const actionable = canAct && !frozen;
  // Each step is also service-checked against its own Auction Workflow permission.
  const can_ = (k: string) => actionable && can("Auction_Workflow", k);
  const days = loan.daysOverdue ?? 0;
  const isDefaulted = !!loan.isDefaulted;
  const customer = loan.customer?.name ?? "The customer";

  const backBtn = view > 0 ? <PrimaryButton label="Back" variant="outline" onPress={() => setView((v) => v - 1)} /> : null;
  const nextBtn = <PrimaryButton label="Continue" variant="outline" onPress={() => setView((v) => v + 1)} />;
  const noPerm = !canAct ? <Txt style={{ fontSize: 12, color: C.muted, marginBottom: 10 }}>Your role can view this case but not act on it.</Txt> : null;

  function body() {
    if (auction.isLoading) return <Buffering block />;
    if (auction.isError) return <Txt style={{ fontSize: 12.5, color: C.red, paddingVertical: 20 }}>Could not load this auction case.</Txt>;

    // No live record: either never started, or already concluded.
    if (!rec) {
      if (alreadyAuctioned)
        return (
          <>
            <SectionTitle flush style={{ marginTop: 16 }}>
              Case concluded
            </SectionTitle>
            <NoticeBanner>This loan&apos;s gold was already sold at auction — see Auction History for the outcome.</NoticeBanner>
            {balanceDue ? (
              <NoticeBanner>
                Balance due after auction — this loan has returned to normal collection. Record payments against it as usual; the auction will close itself
                once the balance is cleared.
              </NoticeBanner>
            ) : null}
          </>
        );
      return (
        <>
          <SectionTitle flush style={{ marginTop: 16 }}>
            Step 1 · Mark Auction Eligible
          </SectionTitle>
          <NoticeBanner>
            {isDefaulted
              ? `${customer} has been overdue for ${days} day${days === 1 ? "" : "s"} with interest still unpaid. Marking the loan Auction Eligible opens its auction case — the next step is issuing the notice.`
              : "This loan is not eligible for auction — only a defaulted loan (over 90 days overdue with interest unpaid) can be."}
          </NoticeBanner>
          {errText(frozen ? null : error)}
          {isDefaulted ? (
            canMarkEligible ? (
              <PrimaryButton label="Mark Loan Auction Eligible" onPress={() => eligible.mutate()} loading={eligible.isPending} />
            ) : (
              <Txt style={{ fontSize: 12, color: C.muted }}>Eligible for auction — your role can&apos;t mark it, though.</Txt>
            )
          ) : null}
        </>
      );
    }

    if (view === 0) {
      return (
        <>
          <SectionTitle flush style={{ marginTop: 16 }}>
            Step 2 · Issue Notice
          </SectionTitle>
          {current > 0 ? (
            <>
              <Card style={{ marginHorizontal: 0, paddingVertical: 4 }}>
                {(rec.notices ?? []).length ? (
                  (rec.notices ?? []).map((n, i) => <MoveItem key={n.id} first={i === 0} title={n.method || "Notice issued"} sub={n.remarks} date={dmy(n.issuedAt)} />)
                ) : (
                  <MoveItem first title="Notice issued" />
                )}
              </Card>
              <BtnRow2>{nextBtn}</BtnRow2>
            </>
          ) : (
            <>
              <NoticeBanner>
                Customer {customer} has been overdue for {days} day{days === 1 ? "" : "s"}. Issuing a notice starts the legal auction-eligibility clock.
              </NoticeBanner>
              {noPerm}
              <Field label="Notice type">
                <ThemeDropdown<string> value={noticeType} options={NOTICE_TYPES} onChange={setNoticeType} labelOf={(v) => v} />
              </Field>
              <DateField label="Notice date" value={noticeDate} onChange={setNoticeDate} max={todayISO()} />
              <DateField label="Response deadline" value={deadline} onChange={setDeadline} min={noticeDate || undefined} clearable />
              {errText(frozen ? null : error)}
              <PrimaryButton label="Issue Notice & Continue--" onPress={() => notice.mutate()} loading={notice.isPending} disabled={!can_("can_issue_auction_notice")} />
            </>
          )}
        </>
      );
    }

    if (view === 1) {
      return (
        <>
          <SectionTitle flush style={{ marginTop: 16 }}>
            Step 3 · Schedule Auction
          </SectionTitle>
          {current > 1 ? (
            <>
              <FieldGrid
                style={{ marginBottom: 14 }}
                items={[
                  { k: "Auction date", v: dmy(rec.auctionDate) },
                  { k: "Auctioneer / venue", v: rec.auctionReferenceNumber || "—" },
                ]}
              />
              <BtnRow2>
                {backBtn}
                {nextBtn}
              </BtnRow2>
            </>
          ) : (
            <>
              {noPerm}
              <DateField label="Auction date" value={auctionDate} onChange={setAuctionDate} min={todayISO()} />
              <Field label="Auctioneer / venue">
                <Input value={reference} onChangeText={setReference} placeholder="e.g. Branch premises, auctioneer name" />
              </Field>
              {errText(frozen ? null : error)}
              <BtnRow2>
                {backBtn}
                <PrimaryButton label="Schedule & Continue" onPress={() => schedule.mutate()} loading={schedule.isPending} disabled={!can_("can_schedule_auction") || !auctionDate} />
              </BtnRow2>
            </>
          )}
        </>
      );
    }

    if (view === 2) {
      return (
        <>
          <SectionTitle flush style={{ marginTop: 16 }}>
            Step 4 · Conduct Auction
          </SectionTitle>
          {current > 2 ? (
            <>
              <FieldGrid
                style={{ marginBottom: 14 }}
                items={[
                  { k: "Sale amount", v: inr(rec.saleAmount) },
                  { k: "Auction expenses", v: inr(rec.auctionExpenses ?? 0) },
                ]}
              />
              <BtnRow2>
                {backBtn}
                {nextBtn}
              </BtnRow2>
            </>
          ) : (
            <>
              {noPerm}
              <Field label="Sale amount">
                <Input value={saleAmount} onChangeText={(v) => setSaleAmount(v.replace(/[^0-9.]/g, ""))} placeholder="₹" keyboardType="decimal-pad" />
              </Field>
              <Field label="Auction expenses">
                <Input value={expenses} onChangeText={(v) => setExpenses(v.replace(/[^0-9.]/g, ""))} placeholder="₹" keyboardType="decimal-pad" />
              </Field>
              {errText(frozen ? null : error)}
              <BtnRow2>
                {backBtn}
                <PrimaryButton label="Record Sale & Continue" onPress={() => sale.mutate()} loading={sale.isPending} disabled={!can_("can_record_auction_sale") || !(Number(saleAmount) > 0)} />
              </BtnRow2>
            </>
          )}
        </>
      );
    }

    // Step 5 — settle surplus / shortfall.
    const ss = rec.surplusShortfall ?? 0;
    const outstanding = (rec.saleAmount ?? 0) - (rec.auctionExpenses ?? 0) - ss;
    return (
      <>
        <SectionTitle flush style={{ marginTop: 16 }}>
          Step 5 · Settle Surplus / Shortfall
        </SectionTitle>
        <ResultBox k="Outstanding balance" v={inr(outstanding)} />
        <ResultBox k="Sale amount" v={inr(rec.saleAmount)} tone="green" />
        <ResultBox k={ss >= 0 ? "Surplus payable to customer" : "Shortfall"} v={inr(Math.abs(ss >= 0 ? rec.surplusPayableAmount ?? ss : ss))} tone={ss >= 0 ? "brand" : "red"} />
        {allDone ? (
          <>
            <NoticeBanner>
              {rec.stage === "Settled" ? AUCTION_OUTCOME_LABELS[rec.finalSettlementStatus ?? "Pending"] : "Withdrawn — removed from auction"}
            </NoticeBanner>
            <BtnRow2>{backBtn}</BtnRow2>
          </>
        ) : balanceDue ? (
          <>
            <NoticeBanner>
              Balance due after auction — this loan has returned to normal collection. Record payments against it as usual; the auction will close itself once
              the balance is cleared.
            </NoticeBanner>
            <BtnRow2>{backBtn}</BtnRow2>
          </>
        ) : hasUndisposedSurplus(rec) ? (
          <>
            {noPerm}
            <Field label="Surplus disposition">
              <ChipToggle options={DISPOSITIONS} value={disposition} onChange={setDisposition} labels={DISPOSITION_LABELS} />
            </Field>
            <Field label={`Remarks${disposition === "RecordedAsIncome" ? " *" : " (optional)"}`}>
              <Input value={dispRemarks} onChangeText={setDispRemarks} placeholder="Reason / reference" />
            </Field>
            {errText(frozen ? null : error)}
            <BtnRow2>
              {backBtn}
              <PrimaryButton
                label="Settle & Close Case"
                onPress={() => settle.mutate()}
                loading={settle.isPending}
                disabled={!can_("can_settle_auction") || (disposition === "RecordedAsIncome" && !dispRemarks.trim())}
              />
            </BtnRow2>
          </>
        ) : (
          <>
            {!frozen ? <NoticeBanner>The sale exactly covered the debt — nothing left to settle.</NoticeBanner> : null}
            <BtnRow2>{backBtn}</BtnRow2>
          </>
        )}
      </>
    );
  }

  return (
    <Sheet visible={visible} onClose={onClose} title={`Auction Flow — ${loan.loanNumber}`} maxHeightPct={90}>
      <View style={{ marginBottom: 6, marginTop: 8 }}>
        {/* An existing record has already passed "Eligible", so its record step sits one along. */}
        <Stepper steps={STEPS} current={rec ? current + 1 : 0} allDone={allDone || (!rec && alreadyAuctioned)} />
      </View>

      {decisionReq ? (
        <View style={{ marginTop: 12 }}>
          <WarningBanner>
            {decisionReq.kind === "Shortfall"
              ? `Shortfall — awaiting authority. The sale realised ${inr(decisionReq.amountPaid)} and left ${inr(decisionReq.outstandingAtRequest)} owing.`
              : `Decision pending. ${inr(decisionReq.amountPaid)} was paid, leaving ${inr(decisionReq.outstandingAtRequest)} owing. No notice, schedule, or sale can proceed until this is resolved.`}
            {!canDecide ? " Your role can view this but not decide it." : ""}
          </WarningBanner>
          {decisionFlowOff ? <NoticeBanner>Decisions are now switched off for new cases, but this one was raised before that change and still needs a decision.</NoticeBanner> : null}
          {canDecide ? (
            <>
              <Field label="Decision">
                <ChipToggle
                  options={decisionReq.kind === "Shortfall" ? (["PursueBalance", "WriteOff"] as const) : (["RemovedFromAuction", "KeepInAuction"] as const)}
                  value={(decision || "") as never}
                  onChange={(v) => setDecision(v)}
                  labels={DECISION_LABELS}
                />
              </Field>
              <Field label={`Remarks${decisionReq.kind === "Shortfall" ? " *" : " (optional)"}`}>
                <Input value={decisionRemarks} onChangeText={setDecisionRemarks} placeholder="Reason for this decision" />
              </Field>
              <PrimaryButton
                label="Record Decision"
                onPress={() => decide.mutate(decisionReq.id)}
                loading={decide.isPending}
                disabled={!decision || (decisionReq.kind === "Shortfall" && !decisionRemarks.trim())}
                style={{ marginBottom: 6 }}
              />
            </>
          ) : null}
          {errText(error)}
        </View>
      ) : null}

      {body()}
    </Sheet>
  );
}
