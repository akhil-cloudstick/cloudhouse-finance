import { usePersistedState } from "@/common/hooks/use-persisted-state";
import React, { useState } from "react";
import {
  AccRow,
  C,
  FlatHeader,
  GroupedFilter,
  Screen,
  SearchFilterRow,
  ServerFlatList,
  SummaryCard,
  emptyGroupedFilter,
  gfDate,
  gfValues,
  type ChipTone,
  type GFSection,
  type GroupedFilterValue,
  openPage,
} from "@/common/components/ui";
import { View } from "react-native";
import { useServerList } from "@/common/hooks/use-server-list";
import { listLoanRiskAssessmentPage, RISK_STATUSES } from "@/modules/loans/services/loanService";
import { type LoanRiskCounts, type LoanRiskLevel, type LoanRiskRow } from "@/modules/loans/types/loan-types";
import { inr } from "@/common/utils/format";

// Loan Risk — not drawn in the prototype; built from its list language
// (FlatHeader back, SummaryCard, GroupedFilter, SearchInput, server-paged
// AccRows). riskLevel is classified server-side (Service.ClassifyRisk); every
// filter and the search are backend params on GET /loans/risk-assessment.

// The app's standard grouped filter (as on Customers, Auctions, the ledgers). Risk level and status
// each take any number of ticked values (none = no restriction); the date range is when the loan opened.
const FILTER_SECTIONS: GFSection[] = [
  {
    kind: "static",
    key: "level",
    label: "Risk level",
    options: [
      { value: "Loss", label: "Loss" },
      { value: "AtRisk", label: "At Risk" },
      { value: "Safe", label: "Safe" },
    ],
  },
  { kind: "static", key: "status", label: "Loan status", options: RISK_STATUSES.map((s) => ({ value: s, label: s })) },
  { kind: "date", key: "opened", label: "Opened" },
];

const RISK_TONE: Record<LoanRiskLevel, ChipTone> = { Safe: "active", AtRisk: "due", Loss: "overdue" };
const RISK_LABEL: Record<LoanRiskLevel, string> = { Safe: "Safe", AtRisk: "At Risk", Loss: "Loss" };

// status and riskLevel are comma-separated lists (the server accepts one or several).
type Filters = { status?: string; riskLevel?: string; from?: string; to?: string };
type RiskPage = { items: LoanRiskRow[]; hasMore: boolean; total: number; counts: LoanRiskCounts };

export default function LoanRiskScreen() {
  const [fv, setFv] = usePersistedState<GroupedFilterValue>("loanrisk:filters", emptyGroupedFilter());
  // Counts come back on every page — keep the latest server figures.
  const [counts, setCounts] = useState<LoanRiskCounts | null>(null);

  const opened = gfDate(fv, "opened");
  const filters: Filters = {
    status: gfValues(fv, "status").join(",") || undefined,
    riskLevel: gfValues(fv, "level").join(",") || undefined,
    from: opened.from || undefined,
    to: opened.to || undefined,
  };
  const list = useServerList<LoanRiskRow, Filters>({
    key: ["loan-risk", "list"],
    filters,
    fetchPage: async (p) => {
      const page = (await listLoanRiskAssessmentPage(p)) as RiskPage;
      if (page.counts) setCounts(page.counts);
      return page;
    },
  });

  return (
    <Screen header={<FlatHeader title="Loan Risk" subtitle="Risk assessment across active loans" />}>
      <ServerFlatList stickyHeader
        list={list}
        items={list.items}
        keyOf={(r) => String(r.loanId)}
        emptyText={
          list.error
            ? "Could not load risk assessment. A gold rate may not be published yet."
            : list.search
              ? "No loans match your search."
              : "No loans found."
        }
        header={
          <>
            <View style={{ paddingTop: 14 }}>
              <SummaryCard
                title="Gold-value risk"
                stats={[
                  { n: String(counts?.loss ?? 0), l: "Loss" },
                  { n: String(counts?.atRisk ?? 0), l: "At risk" },
                  { n: String(counts?.safe ?? 0), l: "Safe" },
                ]}
              />
            </View>
            <View style={{ paddingTop: 12 }}>
              <SearchFilterRow
                value={list.search}
                onChangeText={list.setSearch}
                placeholder="Search by loan ID, customer name or ID"
                filter={<GroupedFilter title="Filter Loan Risk" sections={FILTER_SECTIONS} value={fv} onChange={setFv} />}
              />
            </View>
          </>
        }
        renderItem={(r, i) => {
          const margin = r.currentGoldValue - r.principalAmount;
          return (
            <AccRow
              defaultOpen={i === 0}
              id={r.loanNumber}
              name={r.customerName}
              sub={r.status}
              amount={inr(r.principalAmount)}
              status={RISK_LABEL[r.riskLevel] ?? r.riskLevel}
              statusTone={RISK_TONE[r.riskLevel]}
              details={[
                { k: "Gold weight", v: `${Number(r.totalNetWeight ?? 0).toFixed(2)} g` },
                { k: "Gold value today", v: inr(r.currentGoldValue) },
                { k: "Outstanding", v: inr(r.principalAmount) },
                { k: "Margin", v: `${margin >= 0 ? "+" : "−"}${inr(Math.abs(margin))}`, color: margin >= 0 ? C.green : C.red },
              ]}
              actions={[{ label: "View Loan", primary: true, onPress: () => openPage(`/loans/${r.loanId}`) }]}
            />
          );
        }}
      />
    </Screen>
  );
}
