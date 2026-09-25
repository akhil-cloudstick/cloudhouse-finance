import React, { useState } from "react";
import { RefreshControl, View } from "react-native";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { ScreenContainer } from "../../../src/components/ScreenContainer";
import { ThemedText } from "../../../src/components/ThemedText";
import { GoldTextInput } from "../../../src/components/GoldTextInput";
import { GoldButton } from "../../../src/components/GoldButton";
import { FilterSheetButton } from "../../../src/components/FilterSheetButton";
import { statusColors } from "../../../src/theme/colors";
import { useTheme } from "../../../src/theme/ThemeProvider";
import { listInvestmentsPage } from "../../../src/api/investments";
import { Investment, InvestmentStatus } from "../../../src/types/investment";
import { useDebouncedValue } from "../../../src/hooks/useDebouncedValue";
import { useRefetchOnFocus } from "../../../src/hooks/useRefetchOnFocus";
import { useAuth } from "../../../src/auth/AuthContext";
import { fmt } from "../../../src/lib/format";
import { ExpandableTable, defaultVisibleCount, type TableColumn } from "../../../src/components/ExpandableTable";
import { HEADER_FADE_BELOW } from "../../../src/components/FloatingHeader";

const PAGE_SIZE = 10;

// "All" + every InvestmentStatus — mirrors web Investments.tsx's STATUSES,
// sent server-side as the `status` param ("All" sends none at all).
const STATUS_FILTERS = ["All", "Active", "Matured", "Closed", "Renewed"] as const;

function toneForStatus(status: InvestmentStatus): "green" | "red" | "amber" | "info" | "muted" {
  if (status === "Active") return "green";
  if (status === "Closed") return "muted";
  if (status === "Renewed") return "amber";
  return "info";
}

function StatusPill({ status }: { status: InvestmentStatus }) {
  const { colors } = useTheme();
  const tone = statusColors(toneForStatus(status), colors);
  return (
    <ThemedText
      variant="label"
      numberOfLines={1}
      style={{ backgroundColor: tone.bg, color: tone.fg, paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6, alignSelf: "flex-start", fontSize: 11.5 }}
    >
      {status}
    </ThemedText>
  );
}

const INVESTMENT_COLUMNS: TableColumn<Investment>[] = [
  { key: "investmentNumber", label: "Investment", render: (i) => i.investmentNumber, weight: 1.1 },
  { key: "investor", label: "Investor", render: (i) => i.customer?.name ?? `#${i.customerId}`, weight: 1.3 },
  { key: "status", label: "Status", render: (i) => <StatusPill status={i.status} /> },
  { key: "principal", label: "Principal", render: (i) => fmt(i.principalAmount) },
];
const INVESTMENT_VISIBLE_COUNT = defaultVisibleCount(INVESTMENT_COLUMNS.length + 2);

function investmentExtraFields(i: Investment) {
  return [
    { label: "Rate", value: `${i.interestRatePercent}% ${i.interestRateType}` },
    { label: "Maturity", value: new Date(i.maturityDate).toLocaleDateString("en-IN") },
  ];
}

export default function InvestmentsScreen() {
  const router = useRouter();
  const { can } = useAuth();
  const canCreate = can("Investment_Management", "can_create_investment");
  const canUpdate = can("Investment_Management", "can_update_investment");
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search);
  const [status, setStatus] = useState<(typeof STATUS_FILTERS)[number]>("All");

  const { data, isLoading, isError, isFetching, isFetchingNextPage, fetchNextPage, hasNextPage, refetch } = useInfiniteQuery({
    queryKey: ["investments", debouncedSearch, status],
    queryFn: ({ pageParam = 0 }) =>
      listInvestmentsPage({
        q: debouncedSearch || undefined,
        status: status === "All" ? undefined : status,
        limit: PAGE_SIZE,
        offset: pageParam,
      }),
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) => (lastPage.hasMore ? allPages.length * PAGE_SIZE : undefined),
  });

  useRefetchOnFocus(refetch);

  const investments = data?.pages.flatMap((p) => p.items) ?? [];

  // Scrolls away with the rows (ExpandableTable's headerContent) so the
  // table's top fade sits right under the app header.
  const listHeader = (
    <View>
      <GoldTextInput
        label="Search investments"
        placeholder="Investment # or investor…"
        value={search}
        onChangeText={setSearch}
        containerStyle={{ marginTop: HEADER_FADE_BELOW + 4 }}
        blur
      />
      {canUpdate ? (
        <View style={{ marginBottom: 12 }}>
          <GoldButton title="Manage Plans" variant="outline" onPress={() => router.push("/investments/plans")} />
        </View>
      ) : null}
      {canCreate ? (
        <View style={{ marginBottom: 12 }}>
          <GoldButton title="+ New Investment" onPress={() => router.push("/investments/new")} />
        </View>
      ) : null}

      <View style={{ marginBottom: 12 }}>
        <FilterSheetButton options={STATUS_FILTERS} value={status} onChange={setStatus} />
      </View>
    </View>
  );

  return (
    <ScreenContainer style={{ paddingHorizontal: 0 }}>
      <View style={{ flex: 1, paddingHorizontal: 16 }}>
        <ExpandableTable<Investment>
          headerContent={listHeader}
          columns={INVESTMENT_COLUMNS}
          visibleCount={INVESTMENT_VISIBLE_COUNT}
          data={investments}
          keyExtractor={(i) => String(i.id)}
          extraFields={investmentExtraFields}
          onViewDescription={(i) => router.push(`/investments/${i.id}`)}
          loading={isLoading}
          emptyText={isError ? "Could not load investments." : "No investments in this category."}
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
