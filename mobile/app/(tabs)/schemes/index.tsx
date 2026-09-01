import React, { useEffect, useState } from "react";
import { ScrollView, RefreshControl, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { ScreenContainer } from "../../../src/components/ScreenContainer";
import { ThemedText } from "../../../src/components/ThemedText";
import { GoldTextInput } from "../../../src/components/GoldTextInput";
import { GoldButton } from "../../../src/components/GoldButton";
import { Pager } from "../../../src/components/Pager";
import { colors, statusColors } from "../../../src/theme/colors";
import { listSchemesPage } from "../../../src/api/schemes";
import { Scheme } from "../../../src/types/scheme";
import { useDebouncedValue } from "../../../src/hooks/useDebouncedValue";
import { useRefetchOnFocus } from "../../../src/hooks/useRefetchOnFocus";
import { ExpandableTable, defaultVisibleCount, type TableColumn } from "../../../src/components/ExpandableTable";

const PAGE_SIZE = 10;

function StatusPill({ active }: { active: boolean }) {
  const tone = statusColors(active ? "green" : "muted");
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
  const [page, setPage] = useState(1);

  useEffect(() => {
    setPage(1);
  }, [debouncedSearch]);

  const { data, isLoading, isError, isFetching, refetch } = useQuery({
    queryKey: ["schemes", debouncedSearch, page],
    queryFn: () => listSchemesPage({ q: debouncedSearch || undefined, limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE }),
  });

  useRefetchOnFocus(refetch);

  const schemes = data?.items ?? [];

  return (
    <ScreenContainer style={{ paddingHorizontal: 0 }}>
      <View style={{ paddingHorizontal: 16 }}>
        <GoldTextInput label="Search schemes" value={search} onChangeText={setSearch} blur />
        <GoldButton title="+ New Scheme" variant="outline" onPress={() => router.push("/schemes/new")} />
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ padding: 16 }}
        refreshControl={<RefreshControl refreshing={isFetching && !isLoading} onRefresh={refetch} />}
      >
        <ExpandableTable<Scheme>
          columns={SCHEME_COLUMNS}
          visibleCount={SCHEME_VISIBLE_COUNT}
          data={schemes}
          keyExtractor={(s) => String(s.id)}
          extraFields={schemeExtraFields}
          onViewDescription={(s) => router.push(`/schemes/${s.id}`)}
          emptyText={isLoading ? "Loading…" : isError ? "Could not load schemes." : "No schemes found."}
        />
        <Pager page={page} hasMore={!!data?.hasMore} onChange={setPage} loading={isFetching} />
      </ScrollView>
    </ScreenContainer>
  );
}
