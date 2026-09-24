import React, { useState } from "react";
import { RefreshControl, View } from "react-native";
import { useInfiniteQuery } from "@tanstack/react-query";
import { ScreenContainer } from "../../src/components/ScreenContainer";
import { ThemedText } from "../../src/components/ThemedText";
import { Card } from "../../src/components/Card";
import { FilterSheetButton } from "../../src/components/FilterSheetButton";
import { colors, statusColors } from "../../src/theme/colors";
import { listLoanRiskAssessmentPage, RISK_STATUSES } from "../../src/api/loans";
import { LoanRiskRow, LoanRiskLevel } from "../../src/types/loan";
import { useRefetchOnFocus } from "../../src/hooks/useRefetchOnFocus";
import { fmt } from "../../src/lib/format";
import { ExpandableTable, defaultVisibleCount, type TableColumn, type ExtraField } from "../../src/components/ExpandableTable";

const PAGE_SIZE = 10;

// "All statuses" + RISK_STATUSES — mirrors web LoanRisk.tsx's status
// <select>. "All statuses" sends no `status` param at all.
const STATUS_FILTERS = ["All statuses", ...RISK_STATUSES] as const;

// No client-side threshold math — riskLevel/classification is computed
// server-side (Service.ClassifyRisk); this just maps it to a chip.
const RISK_TONE: Record<LoanRiskLevel, "green" | "amber" | "red"> = { Safe: "green", AtRisk: "amber", Loss: "red" };
const RISK_LABEL: Record<LoanRiskLevel, string> = { Safe: "Safe", AtRisk: "At Risk", Loss: "Loss" };

// "All levels" + the three real levels, using the same display labels the
// chip/pill renders elsewhere on this screen (FilterSheetButton shows the
// option text verbatim, so this uses "At Risk" rather than the wire value
// "AtRisk") — mirrors STATUS_FILTERS' own "All X" convention and web
// LoanRisk.tsx's risk-level <select>. riskLevelFilterToWire below maps a
// selected label back to the LoanRiskLevel the API expects.
const RISK_LEVEL_FILTERS = ["All levels", "Loss", "At Risk", "Safe"] as const;

function riskLevelFilterToWire(v: (typeof RISK_LEVEL_FILTERS)[number]): LoanRiskLevel | undefined {
  if (v === "At Risk") return "AtRisk";
  if (v === "Loss" || v === "Safe") return v;
  return undefined;
}

function RiskPill({ level }: { level: LoanRiskLevel }) {
  const tone = statusColors(RISK_TONE[level]);
  return (
    <ThemedText
      variant="label"
      numberOfLines={1}
      style={{ backgroundColor: tone.bg, color: tone.fg, paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6, alignSelf: "flex-start", fontSize: 11.5 }}
    >
      {RISK_LABEL[level]}
    </ThemedText>
  );
}

const RISK_COLUMNS: TableColumn<LoanRiskRow>[] = [
  { key: "loanNumber", label: "Loan No", render: (r) => r.loanNumber, weight: 1.1 },
  { key: "customer", label: "Customer", render: (r) => r.customerName, weight: 1.3 },
  { key: "risk", label: "Risk", render: (r) => <RiskPill level={r.riskLevel} /> },
];
const RISK_VISIBLE_COUNT = defaultVisibleCount(RISK_COLUMNS.length + 4);

function riskExtraFields(r: LoanRiskRow): ExtraField[] {
  const margin = r.currentGoldValue - r.principalAmount;
  return [
    { label: "Status", value: r.status },
    { label: "Principal", value: fmt(r.principalAmount) },
    { label: "Gold Weight", value: `${r.totalNetWeight.toFixed(2)}g` },
    { label: "Current Gold Value", value: fmt(r.currentGoldValue) },
    {
      label: "Margin",
      value: (
        <ThemedText variant="small" color={margin >= 0 ? colors.green : colors.red}>
          {margin >= 0 ? "+" : "−"}{fmt(Math.abs(margin))}
        </ThemedText>
      ),
    },
  ];
}

export default function LoanRiskScreen() {
  const [status, setStatus] = useState<(typeof STATUS_FILTERS)[number]>("All statuses");
  const [riskLevelFilter, setRiskLevelFilter] = useState<(typeof RISK_LEVEL_FILTERS)[number]>("All levels");
  const riskLevel = riskLevelFilterToWire(riskLevelFilter);

  const { data, isLoading, isError, isFetching, isFetchingNextPage, fetchNextPage, hasNextPage, refetch } = useInfiniteQuery({
    queryKey: ["loan-risk", status, riskLevel],
    queryFn: ({ pageParam = 0 }) =>
      listLoanRiskAssessmentPage({
        status: status === "All statuses" ? undefined : status,
        riskLevel,
        limit: PAGE_SIZE,
        offset: pageParam,
      }),
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) => (lastPage.hasMore ? allPages.length * PAGE_SIZE : undefined),
  });

  useRefetchOnFocus(refetch);

  const rows = data?.pages.flatMap((p) => p.items) ?? [];
  const latest = data?.pages[data.pages.length - 1];
  const total = latest?.total ?? 0;
  const counts = latest?.counts ?? { loss: 0, atRisk: 0, safe: 0 };

  // Summary card + filters scroll away with the rows (ExpandableTable's
  // headerContent) so the table's top fade sits right under the app header.
  const listHeader = (
      <View style={{ paddingTop: 20 }}>
        <Card>
          <ThemedText variant="h3" style={{ marginBottom: 8 }}>
            Gold-value risk assessment
          </ThemedText>
          <ThemedText variant="body">Total open loans: {total}</ThemedText>
          <ThemedText variant="body" color={colors.red}>Loss: {counts.loss}</ThemedText>
          <ThemedText variant="body" color={colors.amber}>At Risk: {counts.atRisk}</ThemedText>
          <ThemedText variant="body" color={colors.green}>Safe: {counts.safe}</ThemedText>
        </Card>

        <View style={{ marginBottom: 12, flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
          <FilterSheetButton label="Status" options={STATUS_FILTERS} value={status} onChange={setStatus} />
          <FilterSheetButton label="Risk" options={RISK_LEVEL_FILTERS} value={riskLevelFilter} onChange={setRiskLevelFilter} />
        </View>
      </View>
  );

  return (
    <ScreenContainer style={{ paddingHorizontal: 0 }}>
      <View style={{ flex: 1, paddingHorizontal: 16 }}>
        <ExpandableTable<LoanRiskRow>
          headerContent={listHeader}
          columns={RISK_COLUMNS}
          visibleCount={RISK_VISIBLE_COUNT}
          data={rows}
          keyExtractor={(r) => String(r.loanId)}
          extraFields={riskExtraFields}
          emptyText={
            isLoading ? "Loading…" : isError ? "Could not load risk assessment. A gold rate may not be published yet." : "No loans found."
          }
          refreshControl={<RefreshControl refreshing={isFetching && !isFetchingNextPage && !isLoading} onRefresh={refetch} />}
          onEndReached={() => {
            if (hasNextPage && !isFetchingNextPage) fetchNextPage();
          }}
          isFetchingNextPage={isFetchingNextPage}
        />
      </View>
    </ScreenContainer>
  );
}
