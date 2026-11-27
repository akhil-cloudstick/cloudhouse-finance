import React, { useEffect, useState } from "react";
import { View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import {
  AccRow,
  C,
  DetailRow,
  FlatHeader,
  GroupedFilter,
  emptyGroupedFilter,
  gfValues,
  type GFSection,
  type GroupedFilterValue,
  PillTabs,
  Screen,
  SearchFilterRow,
  ServerFlatList,
  Sheet,
  SubTabs,
  openPage,
} from "@/common/components/ui";
import { useAuctionEntryEditor } from "@/modules/auctions/components/useAuctionEntryEditor";
import { useLocalSearchParams } from "expo-router";
import { AuctionFlowSheet } from "@/modules/auctions/components/AuctionFlowSheet";
import { useServerList } from "@/common/hooks/use-server-list";
import { listLoansPage } from "@/modules/loans/services/loanService";
import { getAuction, listConcludedAuctions } from "@/modules/auctions/services/auctionService";
import { dmy, inr } from "@/common/utils/format";
import type { Loan } from "@/modules/loans/types/loan-types";
import { AUCTION_OUTCOME_LABELS, pendingDecision, type AuctionRecord, type AuctionStage, type ConcludedAuctionRow } from "@/modules/auctions/types/auction-types";

// Auctions — prototype #header-auctions + #page-auctions, the auction filter
// sheet and the Auction Flow sheet. Active Cases are loans bucketed
// server-side by `auctionCase` (all | eligible | defaulted | auctioned_balance_due);
// Auction History is GET /loans/auctions/concluded split by `hasSale`.

const TABS = ["active", "history"] as const;
type Tab = (typeof TABS)[number];
const TAB_LABELS: Record<Tab, string> = { active: "Active Cases", history: "Auction History" };

const HIST = ["conducted", "closed"] as const;
type Hist = (typeof HIST)[number];
const HIST_LABELS: Record<Hist, string> = { conducted: "Auctions Conducted", closed: "Closed Without Auction" };

const AUCTION_STAGE_LABELS: Record<AuctionStage, string> = {
  AuctionEligible: "Auction Eligible",
  NoticeIssued: "Notice Issued",
  AuctionScheduled: "Auction Scheduled",
  Auctioned: "Auctioned",
  Settled: "Settled",
  Withdrawn: "Withdrawn",
};
const ACTIVE_STAGES: AuctionStage[] = ["AuctionEligible", "NoticeIssued", "AuctionScheduled", "Auctioned"];
// The "Auction Status" filter belongs to Active Cases only; History has its own Sale Outcome filter.
const OUTCOME_SECTIONS: GFSection[] = [
  { kind: "static", key: "outcome", label: "Sale Outcome", options: [{ value: "surplus", label: "Settle Surplus" }, { value: "shortfall", label: "Shortfall" }] },
];
// Same options as web: Defaulted (not yet eligible) first, then every stage including the concluded Settled / Withdrawn.
const stageSections = (stages: AuctionStage[]): GFSection[] => [
  {
    kind: "static",
    key: "stage",
    label: "Auction Status",
    options: [{ value: "Defaulted", label: "Defaulted (not yet eligible)" }, ...stages.map((s) => ({ value: s, label: AUCTION_STAGE_LABELS[s] }))],
  },
];

function useOpenLoan() {
  return (id: number) => {
    openPage(`/loans/${id}`);
  };
}

export default function AuctionsScreen() {
  const [tab, setTab] = useState<Tab>("active");
  const tabs = <PillTabs tabs={TABS} value={tab} onChange={setTab} labels={TAB_LABELS} />;
  return (
    <Screen header={<FlatHeader title="Auctions" subtitle="Active cases & history" />}>
      {tab === "active" ? <ActiveCases tabs={tabs} /> : <AuctionHistory tabs={tabs} />}
    </Screen>
  );
}

type ActiveCasesProps = { tabs: React.ReactNode };

function ActiveCases({ tabs }: ActiveCasesProps) {
  const openLoan = useOpenLoan();

  const [flowLoan, setFlowLoan] = useState<Loan | null>(null);

  // The dashboard's Auction Cases tile opens this screen as ?preset=notice-issued: Active Cases filtered to that stage.
  const { preset } = useLocalSearchParams<{ preset?: string }>();
  const [fv, setFv] = useState<GroupedFilterValue>(() => (preset === "notice-issued" ? { ...emptyGroupedFilter(), stage: ["NoticeIssued"] } as GroupedFilterValue : emptyGroupedFilter()));
  const picked = gfValues(fv, "stage");
  // As on web: only the in-flight stages and "Defaulted" list loans here; Settled / Withdrawn cases live in History.
  const stageCsv = picked.filter((s) => (ACTIVE_STAGES as string[]).includes(s)).join(",");
  const wantDefaulted = picked.includes("Defaulted");
  const nothingActive = picked.length > 0 && !stageCsv && !wantDefaulted;
  const list = useServerList<Loan, { auction_stage?: string; auction_case?: string }>({
    key: ["loans", "auctions"],
    // With no status chosen: the whole pipeline plus defaulted loans that can still be marked Auction Eligible.
    filters: stageCsv ? { auction_stage: stageCsv } : wantDefaulted ? { auction_case: "defaulted" } : { auction_case: "all" },
    fetchPage: (p) => listLoansPage(p),
    enabled: !nothingActive,
  });
  // Defaulted ticked together with other stages: those loans come from a second query, listed after the stage matches.
  const defList = useServerList<Loan, { auction_case?: string }>({
    key: ["loans", "auctionsDefaulted"],
    filters: { auction_case: "defaulted" },
    fetchPage: (p) => listLoansPage(p),
    enabled: wantDefaulted && !!stageCsv,
  });
  const shownItems = nothingActive ? [] : wantDefaulted && stageCsv ? [...list.items, ...defList.items.filter((d) => !list.items.some((x) => x.id === d.id))] : list.items;
  useEffect(() => { void list.refetch(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Always hand the sheet the live row from the list (a snapshot would keep the pre-change status after a mutation).
  const liveFlowLoan = flowLoan ? list.items.find((x) => x.id === flowLoan.id) ?? flowLoan : null;

  const caseSub = (l: Loan) => (l.status === "Auction Eligible" || l.status === "Auctioned" || l.status === "Auctioned - Balance Due" ? l.status : "Defaulted");

  return (
    <>
      <ServerFlatList stickyHeader
        list={list}
        items={shownItems}
        keyOf={(l) => String(l.id)}
        emptyText="No auction cases match your search."
        header={
          <>
            {tabs}
            <SearchFilterRow
              value={list.search}
              onChangeText={list.setSearch}
              placeholder="Search by loan ID or customer name"
              style={{ paddingTop: 12, paddingBottom: 12 }}
              filter={<GroupedFilter title="Filter cases" sections={stageSections(ACTIVE_STAGES)} value={fv} onChange={setFv} />}
            />
          </>
        }
        renderItem={(l, i) => (
          <AuctionCaseRow loan={l} defaultOpen={i === 0} sub={caseSub(l)} onView={() => openLoan(l.id)} onFlow={() => setFlowLoan(l)} />
        )}
      />

      <AuctionFlowSheet loan={liveFlowLoan} visible={!!flowLoan} onClose={() => setFlowLoan(null)} />
    </>
  );
}

// The flow button names the step the case is on, read from its auction record
// (same query the Auction Flow sheet uses, so opening it is instant).
// Defaulted loans have no record yet — marking them Auction Eligible is the
// flow's first step, so that's what their button says.
const NEXT_STEP: Partial<Record<AuctionStage, string>> = {
  AuctionEligible: "Issue Notice",
  NoticeIssued: "Schedule Auction",
  AuctionScheduled: "Record Sale",
  Auctioned: "Settle Auction",
};

function flowLabel(l: Loan, rec: AuctionRecord | null | undefined, loading: boolean): string {
  if (l.status === "Auctioned - Balance Due") return "View Auction";
  // An Auctioned loan is still a case while its sale is unsettled: it has an auction record, so its next step is shown.
  if (l.status !== "Auction Eligible" && l.status !== "Auctioned") return "Mark Auction Eligible";
  if (loading || !rec) return "Auction Flow";
  if (pendingDecision(rec)) return "Decision Pending";
  if (rec.stage === "Settled" || rec.stage === "Withdrawn") return "View Auction";
  return NEXT_STEP[rec.stage] ?? "Auction Flow";
}

type AuctionCaseRowProps = { loan: Loan; defaultOpen: boolean; sub: string; onView: () => void; onFlow: () => void };

function AuctionCaseRow({ loan: l, defaultOpen, sub, onView, onFlow }: AuctionCaseRowProps) {
  const hasRecord = l.status === "Auction Eligible" || l.status === "Auctioned";
  const auction = useQuery({ queryKey: ["auction", String(l.id)], queryFn: () => getAuction(l.id), enabled: hasRecord });
  const days = l.daysOverdue ?? 0;
  // The loan's own status stays "Auction Eligible" through notice and scheduling, so the pill follows the auction record's stage.
  const rec = auction.data;
  const stageStatus = hasRecord && rec && rec.stage !== "Settled" && rec.stage !== "Withdrawn" ? AUCTION_STAGE_LABELS[rec.stage] : sub;
  return (
    <AccRow
      defaultOpen={defaultOpen}
      id={l.loanNumber}
      name={l.customer?.name ?? `Customer #${l.customerId}`}
      amount={inr(l.totalOutstandingBalance ?? l.outstandingAmount)}
      // The case status (Defaulted / Auction Eligible / Auctioned) shows only as the status pill — not "Overdue",
      // and not repeated as a line under the customer's name.
      status={stageStatus}
      details={[
        { k: "Gold weight", v: l.totalNetWeight != null ? `${+Number(l.totalNetWeight).toFixed(2)} g` : "—" },
        { k: "Days overdue", v: `${days} day${days === 1 ? "" : "s"}`, color: days > 0 ? C.red : undefined },
        ...(rec?.auctionDate ? [{ k: "Auction date", v: dmy(rec.auctionDate) }] : []),
        ...(rec?.auctionReferenceNumber ? [{ k: "Reference number", v: rec.auctionReferenceNumber }] : []),
      ]}
      actions={[
        { label: "View Loan", onPress: onView },
        { label: flowLabel(l, auction.data, hasRecord && auction.isLoading), primary: true, onPress: onFlow },
      ]}
    />
  );
}

type AuctionHistoryProps = { tabs: React.ReactNode };

function AuctionHistory({ tabs }: AuctionHistoryProps) {
  const openLoan = useOpenLoan();
  const [hist, setHist] = useState<Hist>("conducted");
  const editor = useAuctionEntryEditor();
  const [info, setInfo] = useState<ConcludedAuctionRow | null>(null);
  const [fv, setFv] = useState<GroupedFilterValue>(emptyGroupedFilter());
  // History's own filter, for the Auctions Conducted table only: sales that left a surplus to settle, or fell short.
  // Both ticked (or none) shows every sale.
  const picked = gfValues(fv, "outcome");
  const outcome = hist === "conducted" && picked.length === 1 ? picked[0] : "";
  const list = useServerList<ConcludedAuctionRow, { hasSale: boolean; outcome?: string }>({
    key: ["auctionHistory"],
    filters: { hasSale: hist === "conducted", ...(outcome ? { outcome } : {}) },
    fetchPage: async (p) => listConcludedAuctions(p),
  });
  // Switching to this tab refetches, so a sale or settlement recorded since the last visit shows without a manual refresh.
  useEffect(() => { void list.refetch(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
    <ServerFlatList stickyHeader
      list={list}
      items={list.items}
      keyOf={(r) => String(r.id)}
      emptyText="No auction history matches your search."
      header={
        <>
          {tabs}
          <SearchFilterRow
            value={list.search}
            onChangeText={list.setSearch}
            placeholder="Search by loan ID or customer name"
            style={{ paddingTop: 12, paddingBottom: 10 }}
            filter={hist === "conducted" ? <GroupedFilter title="Filter history" sections={OUTCOME_SECTIONS} value={fv} onChange={setFv} /> : undefined}
          />
          <View style={{ paddingHorizontal: 18 }}>
            <SubTabs tabs={HIST} value={hist} onChange={setHist} labels={HIST_LABELS} />
          </View>
        </>
      }
      renderItem={(r) => {
        if (r.stage === "Withdrawn" || !r.saleAmount) {
          return (
            <AccRow
              // iPad and bigger: the same columns as the web "Closed Without Auction" table.
              cells={[
                { h: "Loan", v: r.loanNumber, sub: r.customerName || undefined, flex: 1.4 },
                { h: "Marked Eligible", v: r.auctionEligibleDate ? dmy(r.auctionEligibleDate) : "—" },
                { h: "Outcome", v: r.stage === "Withdrawn" ? "Withdrawn — removed from auction" : AUCTION_OUTCOME_LABELS[r.finalSettlementStatus ?? "Pending"], flex: 1.6 },
              ]}
              id={r.loanNumber}
              name="Withdrawn"
              sub="Settled before auction"
              amount={inr(0)}
              status="Closed"
              statusTone="active"
              details={[
                { k: "Customer", v: r.customerName || "—" },
                { k: "Marked eligible", v: r.auctionEligibleDate ? dmy(r.auctionEligibleDate) : "—" },
                { k: "Outcome", v: r.stage === "Withdrawn" ? "Withdrawn — removed from auction" : AUCTION_OUTCOME_LABELS[r.finalSettlementStatus ?? "Pending"] },
              ]}
              actions={[{ label: "View Loan", onPress: () => openLoan(r.loanId) }]}
            />
          );
        }
        const ss = r.surplusShortfall ?? 0;
        return (
          <AccRow
            // iPad and bigger: the same columns as the web "Auctions Conducted" table.
            cells={[
              { h: "Loan", v: r.loanNumber, sub: r.customerName || undefined, flex: 1.3 },
              { h: "Auction Date", v: r.auctionDate ? dmy(r.auctionDate) : "—" },
              { h: "Reference", v: r.auctionReferenceNumber || "—" },
              { h: "Sale Amount", v: inr(r.saleAmount ?? 0), num: true },
              { h: "Expenses", v: r.auctionExpenses ? inr(r.auctionExpenses) : "—", num: true },
              { h: "Net Proceeds", v: inr((r.saleAmount ?? 0) - (r.auctionExpenses || 0)), num: true },
              { h: "Surplus / Shortfall", v: `${ss >= 0 ? "+" : "−"}${inr(Math.abs(ss))}`, num: true, color: ss >= 0 ? C.green : C.red },
              { h: "Outcome", v: AUCTION_OUTCOME_LABELS[r.finalSettlementStatus ?? "Pending"], flex: 1.3 },
            ]}
            id={r.loanNumber}
            name="Auctioned"
            sub={`Sale ${inr(r.saleAmount)}`}
            amount={`${ss >= 0 ? "+" : "−"}${inr(Math.abs(ss))}`}
            amountColor={ss >= 0 ? C.green : C.red}
            status={ss >= 0 ? "Surplus" : "Shortfall"}
            statusTone={ss >= 0 ? "closed" : "overdue"}
            details={[
              { k: "Customer", v: r.customerName || "—" },
              { k: "Stage", v: r.stage === "Settled" ? "Sale completed" : r.stage === "Auctioned" ? "Sold — settlement pending" : r.stage },
              { k: "Outcome", v: AUCTION_OUTCOME_LABELS[r.finalSettlementStatus ?? "Pending"] },
            ]}
            actions={[
              { label: "Info", onPress: () => setInfo(r) },
              ...editor.actionsFor({
                loanId: r.loanId,
                loanNumber: r.loanNumber,
                // The sale always; its surplus settlement / write-off once the case has one (as web's editor does).
                kinds: [
                  "sale",
                  ...(r.surplusDisposition && (r.surplusPayableAmount ?? 0) > 0 ? (["surplus"] as const) : []),
                  ...(r.finalSettlementStatus === "WrittenOff" ? (["write-off"] as const) : []),
                ],
              }),
              { label: "View Loan", onPress: () => openLoan(r.loanId) },
            ]}
          />
        );
      }}
    />
    <Sheet visible={!!info} onClose={() => setInfo(null)} title={info ? `Auction — ${info.loanNumber}` : "Auction"} maxHeightPct={80}>
      {info ? (
        <View style={{ paddingTop: 8 }}>
          <DetailRow first k="Customer" v={info.customerName || "—"} />
          <DetailRow k="Auction date" v={info.auctionDate ? dmy(info.auctionDate) : "—"} />
          <DetailRow k="Reference" v={info.auctionReferenceNumber || "—"} />
          <DetailRow k="Sale amount" v={inr(info.saleAmount ?? 0)} />
          <DetailRow k="Auction expenses" v={info.auctionExpenses ? inr(info.auctionExpenses) : "—"} />
          <DetailRow k="Net proceeds" v={inr((info.saleAmount ?? 0) - (info.auctionExpenses ?? 0))} />
          <DetailRow k="Amount due at auction" v={inr(info.dueTotal ?? (info.saleAmount ?? 0) - (info.auctionExpenses ?? 0) - (info.surplusShortfall ?? 0))} />
          <DetailRow k={(info.surplusShortfall ?? 0) >= 0 ? "Surplus" : "Shortfall"} v={inr(Math.abs(info.surplusShortfall ?? 0))} />
          {info.surplusDisposition === "RefundedToCustomer" ? <DetailRow k="Refund to customer" v={inr(info.surplusPayableAmount || Math.max(0, info.surplusShortfall ?? 0))} /> : null}
          <DetailRow k="Outcome" v={AUCTION_OUTCOME_LABELS[info.finalSettlementStatus ?? "Pending"]} />
          {(info.decisionRequests ?? []).filter((d) => d.decisionRemarks).map((d, i, all) => (
            <DetailRow key={d.id} k={all.length > 1 ? `Decision remarks ${i + 1}` : "Decision remarks"} v={d.decisionRemarks} />
          ))}
          {info.surplusDisposition === "RecordedAsIncome" ? <DetailRow k="Surplus settlement" v="Kept as company income" /> : null}
          {info.surplusDisposition === "RecordedAsIncome" ? (
            <DetailRow k="Reason for keeping surplus" v={info.surplusRemarks || "—"} truncLines={2} />
          ) : info.surplusRemarks ? (
            <DetailRow k="Settlement remarks" v={info.surplusRemarks} truncLines={2} />
          ) : null}
        </View>
      ) : null}
    </Sheet>
    {editor.sheet}
    </>
  );
}
