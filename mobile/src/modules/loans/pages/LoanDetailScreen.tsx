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
} from "@/common/components/ui";
import { useRefetchOnFocus, useResetOnBlur } from "@/common/hooks/use-refetch-on-focus";
import { useAuth } from "@/common/providers/AuthProvider";
import { approveLoan, getLoan, hardDeleteLoan, listLoanRequests, listTopUps, normalizeSanctionStage } from "@/modules/loans/services/loanService";
import { type SanctionStage } from "@/modules/loans/types/loan-types";
import { isFinalStage, stageByKey, stageByPending, stageIndex, canActAtStage, stepperSteps, useApprovalWorkflow } from "@/common/services/approvalWorkflowService";
import { listPackets } from "@/modules/packets/services/packetService";
import { getCashSummary } from "@/modules/cash/services/cashService";
import { getAuction } from "@/modules/auctions/services/auctionService";
import { dmy, inr } from "@/common/utils/format";
import { apiErr, invalidateLoan } from "@/common/components/loanSheetKit";
import { CollectPaymentSheet } from "@/common/components/CollectPaymentSheet";
import { ExtendSheet } from "@/modules/loans/components/ExtendSheet";
import { ReleaseSheet } from "@/modules/loans/components/ReleaseSheet";
import { EditLoanSheet } from "@/modules/loans/components/EditLoanSheet";
import { DocumentsSheets } from "@/modules/loans/components/DocumentsSheets";
import { BankPledgeSheet } from "@/modules/loans/components/BankPledgeSheet";
import { AuctionSheet } from "@/modules/loans/components/AuctionSheet";
import { DisburseSheet } from "@/modules/loans/components/DisburseSheet";
import { LoanTimeline } from "@/modules/loans/components/LoanTimeline";
import { LoanLedger } from "@/modules/loans/components/LoanLedger";
import { TOP_UP_STATUSES, TopUpSheet } from "@/modules/loans/components/TopUpSheet";
import { TopUpReviewPanel } from "@/modules/loans/components/TopUpReviewPanel";

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
  | "reject"
  | "delete"
  | null;

const RECORD_TABS = ["overview", "ledger", "ornaments", "history"] as const;
type RecordTab = (typeof RECORD_TABS)[number];
const RECORD_TAB_LABELS: Record<RecordTab, string> = { overview: "Overview", ledger: "Payment Ledger", ornaments: "Ornaments", history: "History" };

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
  const canTopUp = can("Loan_Management", "can_top_up_loan");
  const canHardDeleteLoan = can("Loan_Management", "can_hard_delete_loan");

  const loan = useQuery({ queryKey: ["loan", id], queryFn: () => getLoan(loanId), enabled: !!id });
  // The branch's Balance in Hand — the final sanction stage pays the principal
  // out of it. The Disburse sheet still opens when it falls short, but its
  // confirm button stays disabled until cash is added (the backend refuses it
  // too). Only fetched while a sanction stage is pending.
  const cashSummary = useQuery({
    queryKey: ["cashSummary", "loanDisburse", loan.data?.branchId],
    queryFn: () => getCashSummary(loan.data!.branchId),
    enabled: !!loan.data?.branchId && !!loan.data?.approvalStage,
  });
  // This loan's tracking packet — locker info / release warnings.
  const packetQuery = useQuery({ queryKey: ["loanPacket", id], queryFn: () => listPackets({ loanId }), enabled: !!id });
  const packet = packetQuery.data?.[0];
  // Auction data and the Auction action need "can view auction module".
  const canViewAuctions = can("Auction_Workflow", "can_view_auction_module");
  const auction = useQuery({ queryKey: ["auction", id], queryFn: () => getAuction(loanId), enabled: !!id && canViewAuctions, retry: false });
  // All of this loan's extension / release requests: the Pending ones switch
  // the Extend / Release sheets to their review, the rest feed the timeline.
  const requests = useQuery({ queryKey: ["loanRequests", id], queryFn: () => listLoanRequests({ loanId }), enabled: !!id });
  // Top-ups aren't in the loan payload — the Payment Ledger needs them.
  const topUps = useQuery({ queryKey: ["loanTopUps", id], queryFn: () => listTopUps(loanId), enabled: !!id });

  // react-navigation keeps this screen mounted — refetch whenever it regains focus.
  useRefetchOnFocus(loan.refetch, auction.refetch, requests.refetch, packetQuery.refetch, topUps.refetch);

  const [open, setOpen] = useState<SheetKey>(null);
  const [error, setError] = useState<string | null>(null);
  const [recordTab, setRecordTab] = useState<RecordTab>("overview");
  // Which pending top-up the review sheet is showing.
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
  const pendingTopUps = (topUps.data ?? []).filter((t) => t.status === "Pending");
  const reviewTopUp = pendingTopUps.find((t) => t.id === reviewId);

  // Who may act on the pending sanction stage — a UX nicety only; the server
  // enforces it regardless. The stages walked, and which one disburses (the
  // LAST enabled one), come from the tenant's "loan_sanction" workflow;
  // acting needs that stage's Loan Sanction permission plus loan update.
  // LoanOperator is a verification ("Verified").
  // Resolved through the chain like the web's LoanDetail: a legacy value
  // maps onto the current chain's stage, whose key the approve call sends.
  const stageDef = stageByKey(wf, "loan_sanction", normalizeSanctionStage(l.approvalStage));
  const pendingStage = stageDef?.key ?? null;
  const requiredRole = stageDef?.role ?? null;
  const stageLabel = stageDef?.label ?? pendingStage ?? "";
  const isVerifyStage = stageDef?.role === "Loan Operator";
  const isFinalSanction = isFinalStage(wf, "loan_sanction", pendingStage);
  const canActOnStage = !!stageDef && canEditLoan && canActAtStage(employee, stageDef);
  const sanctionSteps = stepperSteps(wf, "loan_sanction", pendingStage);
  const balanceInHand = cashSummary.data?.expectedCash;
  // A WithheldFromPayout service charge is paid out that much less (same as DisburseSheet).
  const payoutAmount = l.principalAmount - (l.serviceChargeMode === "WithheldFromPayout" ? l.serviceChargeAmount ?? 0 : 0);
  const disburseBlocked = isFinalSanction && balanceInHand != null && payoutAmount > balanceInHand + 0.005;
  const approveLabel = isFinalSanction ? (isVerifyStage ? " Disburse" : "Disburse") : isVerifyStage ? "Verify" : "Approve";

  const alreadyAuctioned = l.status === "Auctioned" || l.status === "Auctioned - Balance Due";
  const showAuction = canViewAuctions && (!!auction.data || alreadyAuctioned || !!l.isDefaulted);

  const ornaments = l.ornaments ?? [];
  const weight = l.totalNetWeight ?? ornaments.reduce((s, o) => s + o.netWeight * (o.quantity || 1), 0);
  const purities = Array.from(new Set(ornaments.map((o) => o.purity)));
  const tenure = monthsBetween(l.openedDate, l.dueDate);

  function go(k: SheetKey) {
    setError(null);
    setOpen(k);
  }

  function review(k: "topupReview", itemId: number) {
    setReviewId(itemId);
    go(k);
  }

  function stageLabelFor(flow: "loan_topup", pending?: string) {
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

  // Overview tab, in the web page's column order: Loan Details, Settlement
  // Preview, Financial Summary.
  const detailItems: { k: string; v: string; color?: string }[] = [
    { k: "Customer", v: l.customer?.name ?? `Customer #${l.customerId}` },
    { k: "Gold scheme", v: l.scheme?.name ?? "—" },
    { k: "Branch", v: l.branch?.name ?? "—" },
    { k: "Opening date", v: dmy(l.openedDate) },
    { k: "Due date", v: dmy(l.dueDate), color: l.isOverdue ? C.red : undefined },
    { k: "Tenure", v: tenure ? `${tenure} month${tenure === 1 ? "" : "s"}` : "—" },
  ];
  if (l.disbursementDate) detailItems.push({ k: "Disbursed on", v: dmy(l.disbursementDate) });
  if (l.bankPledgeStatus) detailItems.push({ k: "Gold location", v: l.bankPledgeStatus });
  if (packet) detailItems.push({ k: "Packet", v: `${packet.code} · ${packet.status}` });

  const settlementRows: { k: string; v: number; color?: string }[] = [
    { k: "Outstanding principal", v: l.outstandingAmount },
    { k: "Outstanding interest", v: l.outstandingInterest ?? 0 },
    { k: "Outstanding penal interest", v: l.outstandingPenalInterest ?? 0, color: (l.outstandingPenalInterest ?? 0) > 0 ? C.red : undefined },
  ];
  if ((l.outstandingProcessingFee ?? 0) > 0) settlementRows.push({ k: "Outstanding processing fee", v: l.outstandingProcessingFee ?? 0, color: C.red });

  const financialItems: { k: string; v: string; color?: string }[] = [
    { k: "Principal", v: inr(l.principalAmount) },
    { k: "Remaining", v: inr(l.outstandingAmount) },
    // Nothing accrues until disbursement, so a pending loan would read ₹0 —
    // show the monthly interest it will carry instead.
    l.disbursementDate
      ? { k: "Interest", v: inr(l.accruedInterest ?? 0) }
      : { k: "Interest / month", v: inr((l.principalAmount * (l.scheme?.interestRate ?? 0)) / 100 / 12) },
    { k: "Interest paid", v: inr(l.interestPaid ?? 0) },
    { k: "Outstanding interest", v: inr(l.outstandingInterest ?? 0) },
    { k: "Total paid", v: inr(l.totalPaid ?? 0) },
    { k: "Scheme rate", v: l.scheme ? `${l.scheme.interestRate}% p.a.` : "—" },
    { k: "LTV", v: l.scheme ? `${l.schemeLtvPercent ?? l.scheme.ltvPercent}%` : "—" },
    { k: "Gold weight", v: `${weight.toFixed(2)} g${purities.length === 1 ? ` · ${purities[0]}` : purities.length > 1 ? ` · ${ornaments.length} items` : ""}` },
  ];
  if ((l.accruedPenalInterest ?? 0) > 0) financialItems.push({ k: "Accrued penal interest", v: inr(l.accruedPenalInterest ?? 0), color: C.red });
  if (l.disbursementDate) {
    financialItems.push({ k: "Sanctioned", v: inr(l.sanctionedAmount ?? 0) }, { k: "Disbursed", v: inr(l.disbursedAmount ?? 0) });
  }

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
              {disburseBlocked ? (
                <WarningBanner>Balance in hand {inr(balanceInHand ?? 0)} is lower than the {inr(payoutAmount)} to disburse — add cash before approving.</WarningBanner>
              ) : null}
              {doApprove.isPending ? <Buffering /> : null}
            </Card>
          </>
        ) : null}

        {pendingExtension || pendingRelease || pendingTopUps.length ? (
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
                return rows;
              })()}
            </Card>
          </>
        ) : null}

        {/* One section at a time, like the web page's cards: Overview (Loan
            Details, Settlement Preview, Financial Summary), the Payment
            Ledger table, the Pledged Ornaments table, and the loan's History. */}
        <PillTabs tabs={RECORD_TABS} value={recordTab} onChange={setRecordTab} labels={RECORD_TAB_LABELS} style={{ marginTop: 20, marginBottom: 12 }} />
        {recordTab === "overview" ? (
          <>
            <SectionTitle>Loan details</SectionTitle>
            <Card>
              <FieldGrid items={detailItems} />
            </Card>
            <SectionTitle>Settlement preview</SectionTitle>
            <Card>
              {settlementRows.map((r) => (
                <View key={r.k} style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 4 }}>
                  <Txt style={{ fontSize: 13 }}>{r.k}</Txt>
                  <Txt style={{ fontSize: 13, fontWeight: "700", color: r.color }}>{inr(r.v)}</Txt>
                </View>
              ))}
              <View style={{ flexDirection: "row", justifyContent: "space-between", paddingTop: 9, marginTop: 6, borderTopWidth: 1, borderTopColor: C.line }}>
                <Txt style={{ fontSize: 13, fontWeight: "700" }}>Final settlement</Txt>
                <Txt style={{ fontSize: 15, fontWeight: "700" }}>{inr(l.settlementAmount ?? l.totalOutstandingBalance ?? l.outstandingAmount)}</Txt>
              </View>
              <Txt style={{ fontSize: 11, color: C.muted, marginTop: 8 }}>Principal + Interest + Penal Interest + Processing Fee − Payments/Waivers</Txt>
            </Card>
            <SectionTitle>Financial summary</SectionTitle>
            <Card>
              <FieldGrid items={financialItems} />
            </Card>
          </>
        ) : recordTab === "ledger" ? (
          <LoanLedger loan={l} topUps={topUps.data ?? []} />
        ) : recordTab === "ornaments" ? (
          ornaments.length === 0 ? (
            <EmptyText>No ornaments on this loan.</EmptyText>
          ) : (
            ornaments.map((o) => (
              <Card key={o.id}>
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                  <Txt style={{ fontWeight: "700" }}>{o.name}</Txt>
                  <StatusChip label={o.purity} />
                </View>
                <FieldGrid
                  items={[
                    { k: "Gross", v: `${o.grossWeight.toFixed(1)} g` },
                    { k: "Net", v: `${o.netWeight.toFixed(1)} g` },
                    { k: "Qty", v: String(o.quantity) },
                    { k: "Gold value", v: inr(o.goldValue) },
                    { k: "Status", v: o.releasedAt ? `Released ${dmy(o.releasedAt)}` : "Held", color: o.releasedAt ? C.green : undefined },
                  ]}
                />
              </Card>
            ))
          )
        ) : (
          <LoanTimeline loan={l} requests={allRequests} />
        )}
        <View style={{ height: 8 }} />
      </PScroll>

      {/* ---- Actions ---- */}
      <Sheet visible={open === "actions"} onClose={() => setOpen(null)} title="Loan Actions">
        {(() => {
          const items: React.ReactNode[] = [];
          const add = (key: string, props: Omit<React.ComponentProps<typeof SheetListItem>, "first">) =>
            items.push(<SheetListItem key={key} first={items.length === 0} {...props} />);
          // Collect / request / complete all POST behind "can update loan";
          // a pending request can still be opened read-only to review it.
          if (!isFinished) {
            if (canEditLoan) add("collect", { icon: "card", title: "Collect Payment", sub: "Record an EMI or part payment", onPress: () => go("collect") });
            if (canEditLoan || pendingExtension) add("extend", {
              icon: "calendar",
              title: pendingExtension ? "Review Extension" : "Extend Loan Tenure",
              sub: pendingExtension ? "Extension request awaiting approval" : "Push out the due date",
              onPress: () => go("extend"),
            });
            if (canEditLoan || (pendingRelease && l.status !== "Closure Requested")) add("release", {
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
          if (canTopUp && TOP_UP_STATUSES.includes(l.status)) {
            add("topup", { icon: "plus", title: "Top Up Loan", sub: "Disburse more against the pledged gold", onPress: () => go("topup") });
          }
          if (canEditThis) add("edit", { icon: "edit", title: "Edit Loan Details", sub: "Scheme, principal, and ornament details", onPress: () => go("edit") });
          if (pendingStage && canActOnStage) add("docs", { icon: "doc", title: "Loan Documents", sub: "Statement, bond & eSign", onPress: () => go("documents") });
          if (can("Bank_Pledge_Management", "can_view_bank_pledge_module")) add("bank", {
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
        // Recording a payment is a loan update — top-up alone doesn't grant it.
        onRecordPayment={canEditLoan ? () => go("collect") : undefined}
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
          balanceInHand={balanceInHand}
          visible={open === "disburse"}
          onClose={() => setOpen(null)}
          loading={doApprove.isPending}
          error={open === "disburse" ? error : null}
          verb={isVerifyStage ? "Verify" : "Approve"}
          onConfirm={(split) => doApprove.mutate({ stage: pendingStage, action: isVerifyStage ? "Verified" : "Approved", ...split })}
        />
      ) : null}
      <Sheet visible={open === "topupReview" && !!reviewTopUp} onClose={() => setOpen(null)} title={`Review Top-up — ${l.loanNumber}`} maxHeightPct={85}>
        {error && open === "topupReview" ? <WarningBanner>{error}</WarningBanner> : null}
        {reviewTopUp ? <TopUpReviewPanel loan={l} topUp={reviewTopUp} onSaved={afterReview} onError={setError} /> : null}
      </Sheet>
    </Screen>
  );
}
