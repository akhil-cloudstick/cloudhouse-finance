import React, { useState } from "react";
import { View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import {
  AccRow,
  C,
  FlatHeader,
  GroupedFilter,
  emptyGroupedFilter,
  gfValues,
  type GFSection,
  type GroupedFilterValue,
  PillTabs,
  Screen,
  SearchInput,
  ServerFlatList,
  SubTabs,
  openPage,
} from "@/common/components/ui";
import { AuctionFlowSheet } from "@/modules/auctions/components/AuctionFlowSheet";
import { useServerList } from "@/common/hooks/use-server-list";
import { listLoansPage } from "@/modules/loans/services/loanService";
import { getAuction, listConcludedAuctions } from "@/modules/auctions/services/auctionService";
import { inr } from "@/common/utils/format";
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
const ALL_STAGES: AuctionStage[] = [...ACTIVE_STAGES, "Settled", "Withdrawn"];
// The "Auction Status" filter belongs to Active Cases only; History has its own Sale Outcome filter.
const OUTCOME_SECTIONS: GFSection[] = [
  { kind: "static", key: "outcome", label: "Sale Outcome", options: [{ value: "surplus", label: "Settle Surplus" }, { value: "shortfall", label: "Shortfall" }] },
];
const stageSections = (stages: AuctionStage[]): GFSection[] => [
  { kind: "static", key: "stage", label: "Auction Status", options: stages.map((s) => ({ value: s, label: AUCTION_STAGE_LABELS[s] })) },
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

  const [fv, setFv] = useState<GroupedFilterValue>(emptyGroupedFilter());
  const stageCsv = gfValues(fv, "stage").join(",");
  const list = useServerList<Loan, { auctionCase?: string; auction_stage?: string }>({
    key: ["loans", "auctions"],
    filters: stageCsv ? { auction_stage: stageCsv } : { auctionCase: "all" },
    fetchPage: (p) => listLoansPage(p),
  });

  // Always hand the sheet the live row from the list (a snapshot would keep the pre-change status after a mutation).
  const liveFlowLoan = flowLoan ? list.items.find((x) => x.id === flowLoan.id) ?? flowLoan : null;

  const caseSub = (l: Loan) => (l.status === "Auction Eligible" || l.status === "Auctioned" || l.status === "Auctioned - Balance Due" ? l.status : "Defaulted");

  return (
    <>
      <ServerFlatList
        list={list}
        items={list.items}
        keyOf={(l) => String(l.id)}
        emptyText="No auction cases match your search."
        header={
          <>
            {tabs}
            <SearchInput value={list.search} onChangeText={list.setSearch} placeholder="Search by loan ID or customer name" style={{ paddingTop: 12, paddingBottom: 8 }} />
            <View style={{ paddingHorizontal: 18, paddingBottom: 12 }}>
              <GroupedFilter title="Filter cases" sections={stageSections(ACTIVE_STAGES)} value={fv} onChange={setFv} />
            </View>
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
  const overdue = !!l.isOverdue || days > 0;
  return (
    <AccRow
      defaultOpen={defaultOpen}
      id={l.loanNumber}
      name={l.customer?.name ?? `Customer #${l.customerId}`}
      sub={sub}
      amount={inr(l.totalOutstandingBalance ?? l.outstandingAmount)}
      status={overdue ? "Overdue" : l.status}
      details={[
        { k: "Gold weight", v: l.totalNetWeight != null ? `${+Number(l.totalNetWeight).toFixed(2)} g` : "—" },
        { k: "Days overdue", v: `${days} day${days === 1 ? "" : "s"}`, color: days > 0 ? C.red : undefined },
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

  return (
    <ServerFlatList
      list={list}
      items={list.items}
      keyOf={(r) => String(r.id)}
      emptyText="No auction history matches your search."
      header={
        <>
          {tabs}
          <SearchInput value={list.search} onChangeText={list.setSearch} placeholder="Search by loan ID or customer name" style={{ paddingTop: 12, paddingBottom: 8 }} />
          {hist === "conducted" ? (
            <View style={{ paddingHorizontal: 18, paddingBottom: 10 }}>
              <GroupedFilter title="Filter history" sections={OUTCOME_SECTIONS} value={fv} onChange={setFv} />
            </View>
          ) : null}
          <View style={{ paddingHorizontal: 18 }}>
            <SubTabs tabs={HIST} value={hist} onChange={setHist} labels={HIST_LABELS} />
          </View>
        </>
      }
      renderItem={(r) => {
        if (r.stage === "Withdrawn" || !r.saleAmount) {
          return (
            <AccRow
              id={r.loanNumber}
              name="Withdrawn"
              sub="Settled before auction"
              amount={inr(0)}
              status="Closed"
              statusTone="active"
              details={[
                { k: "Customer", v: r.customerName || "—" },
                { k: "Stage", v: r.stage === "Withdrawn" ? "Withdrawn — customer settled" : r.stage },
              ]}
              actions={[{ label: "View Loan", onPress: () => openLoan(r.loanId) }]}
            />
          );
        }
        const ss = r.surplusShortfall ?? 0;
        return (
          <AccRow
            id={r.loanNumber}
            name="Auctioned"
            sub={`Sale ${inr(r.saleAmount)}`}
            amount={`${ss >= 0 ? "+" : "−"}${inr(Math.abs(ss))}`}
            amountColor={ss >= 0 ? C.green : C.red}
            status={ss >= 0 ? "Surplus" : "Shortfall"}
            statusTone={ss >= 0 ? "closed" : "overdue"}
            details={[
              { k: "Customer", v: r.customerName || "—" },
              { k: "Stage", v: r.stage === "Settled" ? "Sale completed" : r.stage },
              { k: "Outcome", v: AUCTION_OUTCOME_LABELS[r.finalSettlementStatus ?? "Pending"] },
            ]}
            actions={[{ label: "View Loan", onPress: () => openLoan(r.loanId) }]}
          />
        );
      }}
    />
  );
}
