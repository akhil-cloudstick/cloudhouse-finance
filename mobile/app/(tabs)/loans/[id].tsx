import React, { useEffect, useRef, useState } from "react";
import { View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ActionsBar,
  Buffering,
  C,
  Card,
  ConfirmSheet,
  EmptyText,
  FieldGrid,
  FlatHeader,
  LdHero,
  PillTabs,
  PScroll,
  ReviewWarning,
  Screen,
  SectionTitle,
  Sheet,
  SheetListItem,
  StatusChip,
  Stepper,
  Txt,
  WarningBanner,
  type SplitAmounts,
} from "../../../src/components/ui";
import { useRefetchOnFocus, useResetOnBlur } from "../../../src/hooks/useRefetchOnFocus";
import { useAuth } from "../../../src/auth/AuthContext";
import {
  approveLoan,
  getLoan,
  hardDeleteLoan,
  listLoanRequests,
  listTopUps,
  normalizeSanctionStage,
  type SanctionStage,
} from "../../../src/api/loans";
import { isFinalStage, stageByKey, stageByPending, stageIndex, canActAtStage, stepperSteps, useApprovalWorkflow } from "../../../src/api/approvalWorkflow";
import { listPackets } from "../../../src/api/packets";
import { getAuction } from "../../../src/api/auctions";
import { dmy, inr } from "../../../src/lib/format";
import { apiErr, invalidateLoan } from "../../../src/components/staff/loan/common";
import { CollectPaymentSheet } from "../../../src/components/staff/loan/CollectPaymentSheet";
import { ExtendSheet } from "../../../src/components/staff/loan/ExtendSheet";
import { ReleaseSheet } from "../../../src/components/staff/loan/ReleaseSheet";
import { EditLoanSheet } from "../../../src/components/staff/loan/EditLoanSheet";
import { DocumentsSheets } from "../../../src/components/staff/loan/DocumentsSheets";
import { BankPledgeSheet } from "../../../src/components/staff/loan/BankPledgeSheet";
import { AuctionSheet } from "../../../src/components/staff/loan/AuctionSheet";
import { DisburseSheet } from "../../../src/components/staff/loan/DisburseSheet";
import { LoanTimeline } from "../../../src/components/staff/loan/LoanTimeline";
import { LoanLedger } from "../../../src/components/staff/loan/LoanLedger";
import { TOP_UP_STATUSES, TopUpSheet } from "../../../src/components/staff/loan/TopUpSheet";
import { TopUpReviewPanel } from "../../../src/components/staff/loan/TopUpReviewPanel";
import { WaiverSheet } from "../../../src/components/staff/loan/WaiverSheet";
import { WaiverReviewPanel } from "../../../src/components/loanRequests/WaiverReviewPanel";

// Loan Description — prototype #header-loandesc + #page-loandesc with its
// Actions / Documents rise-up sheets and every action sheet they open.
// Everything the old screen did still lives here: sanction chain (verify /
// approve / reject / approve & disburse), payments with a mode split,
// extension + release requests and their reviews, complete release, loan &
// ornament edit, bank pledge record / release / delete / history, the auction
// workflow, hard delete, every print flow and the indemnity bond eSign.
// `?action=bank` (release review's "Go to Bank Pledge") opens the Bank Pledge sheet on load.

type SheetKey =
  | "actions"
  | "documents"
  | "collect"
  | "extend"
  | "release"
  | "edit"
  | "bank"
  | "auction"
  | "disburse"
  | "topup"
  | "topupReview"
  | "waiver"
  | "waiverReview"
  | "reject"
  | "delete"
  | null;

const RECORD_TABS = ["ledger", "history"] as const;
type RecordTab = (typeof RECORD_TABS)[number];
const RECORD_TAB_LABELS: Record<RecordTab, string> = { ledger: "Payment Ledger", history: "History" };

function monthsBetween(from?: string, to?: string) {
  if (!from || !to) return null;
  const a = new Date(from.slice(0, 10));
  const b = new Date(to.slice(0, 10));
  const m = (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth());
  return m > 0 ? m : null;
}

export default function LoanDetailScreen() {
  const { id, action } = useLocalSearchParams<{ id: string; action?: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const loanId = Number(id);
  const { can, employee } = useAuth();
  const wf = useApprovalWorkflow();
  const canEditLoan = can("Loan_Management", "can_update_loan");
  const canHardDeleteLoan = can("Loan_Management", "can_hard_delete_loan");

  const loan = useQuery({ queryKey: ["loan", id], queryFn: () => getLoan(loanId), enabled: !!id });
  // This loan's tracking packet — locker info / release warnings.
  const packetQuery = useQuery({ queryKey: ["loanPacket", id], queryFn: () => listPackets({ loanId }), enabled: !!id });
  const packet = packetQuery.data?.[0];
  const auction = useQuery({ queryKey: ["auction", id], queryFn: () => getAuction(loanId), enabled: !!id, retry: false });
  // All of this loan's extension / release requests: the Pending ones switch
  // the Extend / Release sheets to their review, the rest feed the timeline.
  const requests = useQuery({ queryKey: ["loanRequests", id], queryFn: () => listLoanRequests({ loanId }), enabled: !!id });
  // Top-ups aren't in the loan payload — the Payment Ledger needs them.
  const topUps = useQuery({ queryKey: ["loanTopUps", id], queryFn: () => listTopUps(loanId), enabled: !!id });

  // react-navigation keeps this screen mounted — refetch whenever it regains focus.
  useRefetchOnFocus(loan.refetch, auction.refetch, requests.refetch, packetQuery.refetch, topUps.refetch);

  const [open, setOpen] = useState<SheetKey>(null);
  const [error, setError] = useState<string | null>(null);
  const [recordTab, setRecordTab] = useState<RecordTab>("ledger");
  // Which pending top-up / waiver request the review sheet is showing.
  const [reviewId, setReviewId] = useState<number | null>(null);
  useResetOnBlur(() => setOpen(null));

  // ?action=collect|bank → open that sheet once the loan has loaded, then
  // clear the param so a refetch / refocus doesn't reopen it.
  const handledAction = useRef(false);
  useEffect(() => {
    if (action !== "collect" && action !== "bank") {
      handledAction.current = false;
      return;
    }
    if (!loan.data || handledAction.current) return;
    handledAction.current = true;
    const finished = loan.data.status === "Closed" || loan.data.status === "Rejected";
    if (action === "bank") setOpen("bank");
    else if (!finished) setOpen("collect");
    router.setParams({ action: undefined } as never);
  }, [action, loan.data, router]);

  const doApprove = useMutation({
    mutationFn: (vars: { stage: SanctionStage; action: "Approved" | "Rejected" | "Verified"; remarks?: string } & Partial<SplitAmounts>) => approveLoan(loanId, vars),
    onSuccess: () => {
      setError(null);
      setOpen(null);
      invalidateLoan(qc, loanId);
    },
    onError: (e) => setError(apiErr(e)),
  });

  const doHardDelete = useMutation({
    mutationFn: () => hardDeleteLoan(loanId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["loans"] });
      router.back();
    },
    onError: (e) => setError(apiErr(e)),
  });

  const header = (
    <FlatHeader
      back
      title={loan.data?.loanNumber ?? "Loan"}
      subtitle={loan.data ? loan.data.customer?.name ?? `Customer #${loan.data.customerId}` : undefined}
    />
  );

  if (loan.isLoading) {
    return (
      <Screen header={header}>
        <Buffering block />
      </Screen>
    );
  }
  if (loan.isError || !loan.data) {
    return (
      <Screen header={header}>
        <EmptyText>Could not load this loan.</EmptyText>
      </Screen>
    );
  }

  const l = loan.data;
  // Closed (gold released) and Rejected (never disbursed) are finished —
  // nothing left to pay, extend, release or edit.
  const isFinished = l.status === "Closed" || l.status === "Rejected";
  const canEditThis = canEditLoan && !isFinished && l.status !== "Auctioned";
  const allRequests = requests.data ?? [];
  const pendingExtension = allRequests.find((r) => r.type === "Extension" && r.status === "Pending");
  const pendingRelease = allRequests.find((r) => r.type === "Release" && r.status === "Pending");
  const pendingWaivers = allRequests.filter((r) => (r.type === "Waiver" || r.type === "Adjustment") && r.status === "Pending");
  const pendingTopUps = (topUps.data ?? []).filter((t) => t.status === "Pending");
  const reviewWaiver = pendingWaivers.find((r) => r.id === reviewId);
  const reviewTopUp = pendingTopUps.find((t) => t.id === reviewId);

  // Who may act on the pending sanction stage — a UX nicety only; the server
  // enforces it regardless. The stages walked, and which one disburses (the
  // LAST enabled one), come from the tenant's "loan_sanction" workflow;
  // acting needs that stage's Loan Sanction permission plus loan update.
  // LoanOperator is a verification ("Verified").
  const pendingStage = normalizeSanctionStage(l.approvalStage);
  const stageDef = stageByKey(wf, "loan_sanction", pendingStage);
  const requiredRole = stageDef?.role ?? null;
  const stageLabel = stageDef?.label ?? pendingStage ?? "";
  const isVerifyStage = stageDef?.role === "Loan Operator";
  const isFinalSanction = isFinalStage(wf, "loan_sanction", pendingStage);
  const canActOnStage = !!stageDef && canEditLoan && canActAtStage(employee?.role, stageDef);
  const sanctionSteps = stepperSteps(wf, "loan_sanction", pendingStage);
  const approveLabel = isFinalSanction ? (isVerifyStage ? " Disburse" : "Disburse") : isVerifyStage ? "Verify" : "Approve";

  const alreadyAuctioned = l.status === "Auctioned" || l.status === "Auctioned - Balance Due";
  const showAuction = !!auction.data || alreadyAuctioned || !!l.isDefaulted;

  const ornaments = l.ornaments ?? [];
  const weight = l.totalNetWeight ?? ornaments.reduce((s, o) => s + o.netWeight * (o.quantity || 1), 0);
  const purities = Array.from(new Set(ornaments.map((o) => o.purity)));
  const tenure = monthsBetween(l.openedDate, l.dueDate);

  function go(k: SheetKey) {
    setError(null);
    setOpen(k);
  }

  function review(k: "topupReview" | "waiverReview", itemId: number) {
    setReviewId(itemId);
    go(k);
  }

  function stageLabelFor(flow: "loan_topup" | "loan_waiver", pending?: string) {
    return stageByPending(wf, flow, pending)?.label;
  }

  function afterReview() {
    setError(null);
    setOpen(null);
    invalidateLoan(qc, loanId);
  }

  function approveCurrent() {
    if (!pendingStage) return;
    setError(null);
    if (isFinalSanction) return setOpen("disburse");
    doApprove.mutate({ stage: pendingStage, action: isVerifyStage ? "Verified" : "Approved" });
  }

  function rejectCurrent() {
    if (!pendingStage) return;
    go("reject");
  }

  function confirmHardDelete() {
    go("delete");
  }

  const bar =
    pendingStage && canActOnStage
      ? [
          { label: "Actions", icon: "bolt", onPress: () => go("actions") },
          { label: "Reject", tone: "danger" as const, onPress: rejectCurrent, disabled: doApprove.isPending },
          {
            label: approveLabel,
            icon: "check",
            primary: true,
            onPress: approveCurrent,
            disabled: doApprove.isPending,
          },
        ]
      : [
          { label: "Documents", icon: "doc", onPress: () => go("documents") },
          { label: "Actions", icon: "bolt", primary: true, onPress: () => go("actions") },
        ];

  const detailItems: { k: string; v: string; color?: string }[] = [
    { k: "Gold weight", v: `${weight.toFixed(2)} g${purities.length === 1 ? ` · ${purities[0]}` : purities.length > 1 ? ` · ${ornaments.length} items` : ""}` },
    { k: "Interest rate", v: l.scheme ? `${l.scheme.interestRate}%` : "—" },
    { k: "Tenure", v: tenure ? `${tenure} month${tenure === 1 ? "" : "s"}` : "—" },
    { k: "Disbursed on", v: l.disbursementDate ? dmy(l.disbursementDate) : "Not yet" },
    { k: "Next due", v: dmy(l.dueDate), color: l.isOverdue ? C.red : undefined },
    { k: "Outstanding interest", v: inr(l.outstandingInterest ?? 0) },
    { k: "Penal interest", v: inr(l.outstandingPenalInterest ?? 0), color: (l.outstandingPenalInterest ?? 0) > 0 ? C.red : undefined },
  ];
  if (l.settlementAmount != null) detailItems.push({ k: "Final settlement", v: inr(l.settlementAmount) });
  if (l.disbursementDate) {
    detailItems.push({ k: "Sanctioned", v: inr(l.sanctionedAmount ?? 0) }, { k: "Disbursed", v: inr(l.disbursedAmount ?? 0) });
  }
  if (l.bankPledgeStatus) detailItems.push({ k: "Gold location", v: l.bankPledgeStatus });
  if (packet) detailItems.push({ k: "Packet", v: `${packet.code} · ${packet.status}` });

  return (
    <Screen header={header} floating={<ActionsBar actions={bar} />}>
      <PScroll
        extraBottom={70}
        refreshing={loan.isRefetching}
        onRefresh={() => {
          loan.refetch();
          auction.refetch();
          requests.refetch();
          packetQuery.refetch();
        }}
      >
        <LdHero
          name={l.customer?.name ?? `Customer #${l.customerId}`}
          sub={`${l.loanNumber}${l.scheme?.name ? ` · ${l.scheme.name} scheme` : ""}`}
          status={
            <View style={{ alignItems: "flex-end", gap: 6 }}>
              <StatusChip label={l.isOverdue && l.status === "Active" ? "Overdue" : l.status} />
              {l.bankPledgeStatus === "Bank Pledged" ? <StatusChip label="Bank Pledged" /> : null}
            </View>
          }
          amounts={[
            { k: "Principal", v: inr(l.principalAmount) },
            // Outstanding is the full amount owed to close the loan today —
            // principal left + accrued interest + penal interest + fees
            // (Service.enrich's TotalOutstandingBalance), not just principal
            // (outstandingAmount). Falls back to outstandingAmount only if
            // the backend ever omits the enriched field.
            { k: "Outstanding", v: inr(l.totalOutstandingBalance ?? l.outstandingAmount) },
            { k: "Paid to date", v: inr(l.totalPaid ?? 0), color: C.green },
          ]}
        />

        {error && open === null ? (
          <View style={{ marginHorizontal: 18 }}>
            <WarningBanner>{error}</WarningBanner>
          </View>
        ) : null}

        {l.status === "Rejected" ? (
          <View style={{ marginHorizontal: 18 }}>
            <WarningBanner>
              Rejected{l.rejectedByName ? ` by ${l.rejectedByName}` : ""}
              {l.rejectedAt ? ` on ${dmy(l.rejectedAt)}` : ""}
              {l.rejectionRemarks ? ` — ${l.rejectionRemarks}` : ""}. This loan was never disbursed.
            </WarningBanner>
          </View>
        ) : null}

        {pendingStage ? (
          <>
            <SectionTitle>Sanction approval</SectionTitle>
            <Card>
              {sanctionSteps.length ? <Stepper steps={sanctionSteps} current={Math.max(0, stageIndex(wf, "loan_sanction", pendingStage))} /> : null}
              {l.approvalWarning ? <ReviewWarning>{l.approvalWarning}</ReviewWarning> : null}
              <Txt style={{ fontSize: 12, color: C.muted }}>
                {canActOnStage
                  ? isFinalSanction
                    ? `Your ${isVerifyStage ? "verification" : "approval"} disburses the loan.`
                    : `Needs your ${isVerifyStage ? "verification" : "approval"}.`
                  : `Awaiting ${requiredRole ?? stageLabel}.`}
              </Txt>
              {doApprove.isPending ? <Buffering /> : null}
            </Card>
          </>
        ) : null}

        {pendingExtension || pendingRelease || pendingWaivers.length || pendingTopUps.length ? (
          <>
            <SectionTitle>Pending requests</SectionTitle>
            <Card style={{ paddingVertical: 4 }}>
              {(() => {
                const rows: React.ReactNode[] = [];
                const add = (key: string, props: Omit<React.ComponentProps<typeof SheetListItem>, "first">) =>
                  rows.push(<SheetListItem key={key} first={rows.length === 0} {...props} />);
                if (pendingExtension) {
                  add("ext", {
                    icon: "calendar",
                    title: "Extension requested",
                    sub: `+${pendingExtension.requestedExtensionMonths ?? "?"} month(s) · awaiting approval — tap to review`,
                    onPress: () => go("extend"),
                  });
                }
                if (pendingRelease) {
                  add("rel", {
                    icon: "coin",
                    title: pendingRelease.isPartial ? "Partial release requested" : "Release requested",
                    sub: "Awaiting approval — tap to review",
                    onPress: () => go("release"),
                  });
                }
                for (const t of pendingTopUps) {
                  const st = stageLabelFor("loan_topup", t.approvalStage);
                  add(`tu-${t.id}`, {
                    icon: "plus",
                    title: `Top-up requested · ${inr(t.amount)}`,
                    sub: `${st ? `Awaiting ${st}` : "Awaiting approval"} — tap to review`,
                    onPress: () => review("topupReview", t.id),
                  });
                }
                for (const r of pendingWaivers) {
                  const st = stageLabelFor("loan_waiver", r.approvalStage);
                  add(`wv-${r.id}`, {
                    icon: "coin",
                    title: `${r.type} requested · ${inr(r.amount ?? 0)}`,
                    sub: `${st ? `Awaiting ${st}` : "Awaiting approval"} — tap to review`,
                    onPress: () => review("waiverReview", r.id),
                  });
                }
                return rows;
              })()}
            </Card>
          </>
        ) : null}

        <SectionTitle>Loan details</SectionTitle>
        <Card>
          <FieldGrid items={detailItems} />
        </Card>

        {/* Money movements and everything else, one at a time — the web
            page's Payment Ledger table and the loan's History. */}
        <PillTabs tabs={RECORD_TABS} value={recordTab} onChange={setRecordTab} labels={RECORD_TAB_LABELS} style={{ marginTop: 20, marginBottom: 12 }} />
        {recordTab === "ledger" ? <LoanLedger loan={l} topUps={topUps.data ?? []} /> : <LoanTimeline loan={l} requests={allRequests} />}
        <View style={{ height: 8 }} />
      </PScroll>

      {/* ---- Actions ---- */}
      <Sheet visible={open === "actions"} onClose={() => setOpen(null)} title="Loan Actions">
        {(() => {
          const items: React.ReactNode[] = [];
          const add = (key: string, props: Omit<React.ComponentProps<typeof SheetListItem>, "first">) =>
            items.push(<SheetListItem key={key} first={items.length === 0} {...props} />);
          if (!isFinished) {
            add("collect", { icon: "card", title: "Collect Payment", sub: "Record an EMI or part payment", onPress: () => go("collect") });
            add("extend", {
              icon: "calendar",
              title: pendingExtension ? "Review Extension" : "Extend Loan Tenure",
              sub: pendingExtension ? "Extension request awaiting approval" : "Push out the due date",
              onPress: () => go("extend"),
            });
            add("release", {
              icon: "coin",
              title: l.status === "Closure Requested" ? "Complete Release" : pendingRelease ? "Review Release" : "Gold Release",
              sub:
                l.status === "Closure Requested"
                  ? "Hand the gold back and close the loan"
                  : pendingRelease
                    ? "Release request awaiting approval"
                    : "Select ornaments to release — partial or full",
              onPress: () => go("release"),
            });
          }
          if (canEditLoan && TOP_UP_STATUSES.includes(l.status)) {
            add("topup", { icon: "plus", title: "Top Up Loan", sub: "Disburse more against the pledged gold", onPress: () => go("topup") });
          }
          // Mirrors the backend's CreateWaiverRequest guard (not terminal, not
          // still awaiting sanction).
          if (canEditLoan && !isFinished && !["Pending Approval", "Auctioned", "Defaulted"].includes(l.status)) {
            add("waiver", {
              icon: "coin",
              title: "Request Waiver / Adjustment",
              sub: pendingWaivers.length ? `${pendingWaivers.length} awaiting approval · raise another` : "Waive interest or adjust the principal",
              onPress: () => go("waiver"),
            });
          }
          if (canEditThis) add("edit", { icon: "edit", title: "Edit Loan Details", sub: "Scheme, principal, and ornament details", onPress: () => go("edit") });
          if (pendingStage && canActOnStage) add("docs", { icon: "doc", title: "Loan Documents", sub: "Statement, bond & eSign", onPress: () => go("documents") });
          add("bank", {
            icon: "shield",
            title: "Bank Pledge",
            sub: l.bankPledges?.some((p) => p.status === "Active") ? "Pledged to a bank — release, delete or view history" : "Repledge to a bank · view history",
            onPress: () => go("bank"),
          });
          if (showAuction) add("auction", { icon: "bolt", title: "Auction", sub: auction.data ? `Stage: ${auction.data.stage}` : alreadyAuctioned ? "Auction concluded" : "Defaulted — auction workflow", onPress: () => go("auction") });
          if (canHardDeleteLoan) add("delete", { icon: "alert", title: "Delete Loan Permanently", sub: "Removes the loan and every record tied to it", warn: true, onPress: confirmHardDelete });
          return items.length ? items : <EmptyText>No actions available for this loan.</EmptyText>;
        })()}
        {doHardDelete.isPending ? <Buffering /> : null}
      </Sheet>

      <DocumentsSheets loan={l} visible={open === "documents"} onClose={() => setOpen(null)} onOpen={() => setOpen("documents")} />
      <CollectPaymentSheet loan={l} visible={open === "collect"} onClose={() => setOpen(null)} />
      <TopUpSheet
        loan={l}
        visible={open === "topup"}
        onClose={() => setOpen(null)}
        onAddOrnaments={canEditThis ? () => go("edit") : undefined}
        onRecordPayment={() => go("collect")}
      />
      {pendingStage ? (
        <ConfirmSheet
          visible={open === "reject"}
          onClose={() => setOpen(null)}
          title="Reject Loan"
          danger
          message={`Reject ${l.loanNumber} at the ${stageLabel} stage? A rejected loan is never disbursed.`}
          remarks={{ label: "Reason (optional)", placeholder: "Why is this loan being rejected?" }}
          confirmLabel="Reject Loan"
          loading={doApprove.isPending}
          error={open === "reject" ? error : null}
          onConfirm={(remarks) => doApprove.mutate({ stage: pendingStage, action: "Rejected", remarks: remarks || undefined })}
        />
      ) : null}
      <ConfirmSheet
        visible={open === "delete"}
        onClose={() => setOpen(null)}
        title="Delete Loan Permanently"
        danger
        message={`This permanently deletes loan ${l.loanNumber} and every record tied to it — payments, ornaments, approvals, requests, auctions, bank pledges, packets and reminders. This cannot be undone.`}
        confirmLabel="Delete Permanently"
        loading={doHardDelete.isPending}
        error={open === "delete" ? error : null}
        onConfirm={() => doHardDelete.mutate()}
      />
      <ExtendSheet loan={l} pending={pendingExtension} visible={open === "extend"} onClose={() => setOpen(null)} />
      <ReleaseSheet loan={l} pending={pendingRelease} visible={open === "release"} onClose={() => setOpen(null)} />
      {canEditThis ? <EditLoanSheet loan={l} visible={open === "edit"} onClose={() => setOpen(null)} /> : null}
      <BankPledgeSheet loan={l} packetStatus={packet?.status} visible={open === "bank"} onClose={() => setOpen(null)} />
      <AuctionSheet loan={l} auction={auction.data} loading={auction.isLoading} visible={open === "auction"} onClose={() => setOpen(null)} />
      {pendingStage && isFinalSanction ? (
        <DisburseSheet
          loan={l}
          visible={open === "disburse"}
          onClose={() => setOpen(null)}
          loading={doApprove.isPending}
          error={open === "disburse" ? error : null}
          verb={isVerifyStage ? "Verify" : "Approve"}
          onConfirm={(split) => doApprove.mutate({ stage: pendingStage, action: isVerifyStage ? "Verified" : "Approved", ...split })}
        />
      ) : null}
      <WaiverSheet loan={l} visible={open === "waiver"} onClose={() => setOpen(null)} />
      <Sheet visible={open === "waiverReview" && !!reviewWaiver} onClose={() => setOpen(null)} title={`Review ${reviewWaiver?.type ?? "Waiver"} — ${l.loanNumber}`} maxHeightPct={85}>
        {error && open === "waiverReview" ? <WarningBanner>{error}</WarningBanner> : null}
        {reviewWaiver ? <WaiverReviewPanel request={reviewWaiver} loan={l} onSaved={afterReview} onError={setError} /> : null}
      </Sheet>
      <Sheet visible={open === "topupReview" && !!reviewTopUp} onClose={() => setOpen(null)} title={`Review Top-up — ${l.loanNumber}`} maxHeightPct={85}>
        {error && open === "topupReview" ? <WarningBanner>{error}</WarningBanner> : null}
        {reviewTopUp ? <TopUpReviewPanel loan={l} topUp={reviewTopUp} onSaved={afterReview} onError={setError} /> : null}
      </Sheet>
    </Screen>
  );
}
