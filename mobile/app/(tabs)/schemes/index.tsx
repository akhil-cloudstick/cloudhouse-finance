import React, { useState } from "react";
import { RefreshControl, View } from "react-native";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { ScreenContainer } from "../../../src/components/ScreenContainer";
import { ThemedText } from "../../../src/components/ThemedText";
import { GoldTextInput } from "../../../src/components/GoldTextInput";
import { GoldButton } from "../../../src/components/GoldButton";
import { statusColors } from "../../../src/theme/colors";
import { useTheme } from "../../../src/theme/ThemeProvider";
import { listSchemesPage } from "../../../src/api/schemes";
import { Scheme } from "../../../src/types/scheme";
import { useDebouncedValue } from "../../../src/hooks/useDebouncedValue";
import { useRefetchOnFocus } from "../../../src/hooks/useRefetchOnFocus";
import { ExpandableTable, defaultVisibleCount, type TableColumn } from "../../../src/components/ExpandableTable";

const PAGE_SIZE = 10;

function StatusPill({ active }: { active: boolean }) {
  const { colors } = useTheme();
  const tone = statusColors(active ? "green" : "muted", colors);
  return (
    <ThemedText
      variant="label"
      style={{ backgroundColor: tone.bg, color: tone.fg, paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6, alignSelf: "flex-start", fontSize: 11.5 }}
    >
      {active ? "Active" : "Inactive"}
    </ThemedText>
  );
}

// 3 columns + 6 detail-only fields (LTV/Duration/Code/Branch/Penal/
// Conditions) = 9 total — "large", so Name/Interest/Status stay visible and
// the rest fold into the expand strip.
const SCHEME_COLUMNS: TableColumn<Scheme>[] = [
  { key: "name", label: "Name", render: (s) => s.name, weight: 1.4 },
  { key: "interest", label: "Interest", render: (s) => `${s.interestRate}%` },
  { key: "status", label: "Status", render: (s) => <StatusPill active={s.isActive} /> },
];
const SCHEME_VISIBLE_COUNT = defaultVisibleCount(SCHEME_COLUMNS.length + 6);

function schemeExtraFields(s: Scheme) {
  return [
    { label: "LTV", value: `${s.ltvPercent}%` },
    { label: "Duration", value: `${s.durationMonths} months` },
    { label: "Code", value: s.code },
    { label: "Branch", value: s.branch?.name || "—" },
    { label: "Penal Rate", value: s.penalRate != null ? `${s.penalRate}%` : "—" },
    { label: "Conditions", value: s.conditions || "—" },
  ];
}

export default function SchemesScreen() {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search);

  const { data, isLoading, isError, isFetching, isFetchingNextPage, fetchNextPage, hasNextPage, refetch } = useInfiniteQuery({
    queryKey: ["schemes", debouncedSearch],
    queryFn: ({ pageParam = 0 }) => listSchemesPage({ q: debouncedSearch || undefined, limit: PAGE_SIZE, offset: pageParam }),
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) => (lastPage.hasMore ? allPages.length * PAGE_SIZE : undefined),
  });

  useRefetchOnFocus(refetch);

  const schemes = data?.pages.flatMap((p) => p.items) ?? [];

  // Search + "New" scroll away with the rows (ExpandableTable's headerContent)
  // so the table's top fade sits right under the app header.
  const listHeader = (
    <View style={{ paddingTop: 20, marginBottom: 16 }}>
      <GoldTextInput label="Search schemes" value={search} onChangeText={setSearch} blur />
      <GoldButton title="+ New Scheme" variant="outline" onPress={() => router.push("/schemes/new")} />
    </View>
  );

  return (
    <ScreenContainer style={{ paddingHorizontal: 0 }}>
      <View style={{ flex: 1, paddingHorizontal: 16 }}>
        <ExpandableTable<Scheme>
          headerContent={listHeader}
          columns={SCHEME_COLUMNS}
          visibleCount={SCHEME_VISIBLE_COUNT}
          data={schemes}
          keyExtractor={(s) => String(s.id)}
          extraFields={schemeExtraFields}
          onViewDescription={(s) => router.push(`/schemes/${s.id}`)}
          loading={isLoading}
          emptyText={isError ? "Could not load schemes." : "No schemes found."}
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
