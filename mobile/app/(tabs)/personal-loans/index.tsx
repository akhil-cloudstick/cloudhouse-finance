import React, { useState } from "react";
import { RefreshControl, View } from "react-native";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { ScreenContainer } from "../../../src/components/ScreenContainer";
import { ThemedText } from "../../../src/components/ThemedText";
import { GoldTextInput } from "../../../src/components/GoldTextInput";
import { GoldButton } from "../../../src/components/GoldButton";
import { FilterSheetButton } from "../../../src/components/FilterSheetButton";
import { colors, statusColors } from "../../../src/theme/colors";
import { listPersonalLoansPage, PersonalLoan, Frequency } from "../../../src/api/personalLoans";
import { useDebouncedValue } from "../../../src/hooks/useDebouncedValue";
import { useRefetchOnFocus } from "../../../src/hooks/useRefetchOnFocus";
import { useAuth } from "../../../src/auth/AuthContext";
import { fmt } from "../../../src/lib/format";
import { ExpandableTable, defaultVisibleCount, type TableColumn } from "../../../src/components/ExpandableTable";

const PAGE_SIZE = 10;

// "All" + the three collection frequencies — mirrors
// frontend/modules/personal-loans/components/PersonalLoans.tsx's FREQS,
// sent server-side as the `frequency` param ("All" sends none at all).
const FREQ_FILTERS = ["All", "Daily", "Weekly", "Monthly"] as const;

function toneForStatus(status: string): "green" | "red" | "amber" | "info" | "muted" {
  const s = status.toLowerCase();
  if (s === "active") return "green";
  if (s === "defaulted") return "red";
  if (s === "renewed") return "amber";
  return "info";
}

function StatusPill({ status }: { status: string }) {
  const tone = statusColors(toneForStatus(status));
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

const LOAN_COLUMNS: TableColumn<PersonalLoan>[] = [
  { key: "loanNumber", label: "Loan No", render: (l) => l.loanNumber, weight: 1.1 },
  { key: "customer", label: "Customer", render: (l) => l.customer?.name ?? `#${l.customerId}`, weight: 1.3 },
  { key: "status", label: "Status", render: (l) => <StatusPill status={l.status} /> },
  { key: "outstanding", label: "Outstanding", render: (l) => fmt(l.outstandingAmount) },
];
const LOAN_VISIBLE_COUNT = defaultVisibleCount(LOAN_COLUMNS.length + 2);

function loanExtraFields(l: PersonalLoan) {
  return [
    { label: "Principal", value: fmt(l.principalAmount) },
    { label: "Frequency", value: l.frequency },
  ];
}

export default function PersonalLoansScreen() {
  const router = useRouter();
  const { can } = useAuth();
  const canCreate = can("Personal_Loan_Management", "can_create_personal_loan");
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search);
  const [freq, setFreq] = useState<(typeof FREQ_FILTERS)[number]>("All");

  const { data, isLoading, isError, isFetching, isFetchingNextPage, fetchNextPage, hasNextPage, refetch } = useInfiniteQuery({
    queryKey: ["personalLoans", debouncedSearch, freq],
    queryFn: ({ pageParam = 0 }) =>
      listPersonalLoansPage({
        q: debouncedSearch || undefined,
        frequency: freq === "All" ? undefined : (freq as Frequency),
        limit: PAGE_SIZE,
        offset: pageParam,
      }),
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) => (lastPage.hasMore ? allPages.length * PAGE_SIZE : undefined),
  });

  useRefetchOnFocus(refetch);

  const loans = data?.pages.flatMap((p) => p.items) ?? [];

  // Scrolls away with the rows (ExpandableTable's headerContent) so the
  // table's top fade sits right under the app header.
  const listHeader = (
    <View>
      <GoldTextInput
        label="Search personal loans"
        placeholder="Loan number or customer…"
        value={search}
        onChangeText={setSearch}
        containerStyle={{ marginTop: 28 }}
        blur
      />
      {canCreate ? (
        <View style={{ marginBottom: 12 }}>
          <GoldButton title="+ New Personal Loan" onPress={() => router.push("/personal-loans/new")} />
        </View>
      ) : null}

      <View style={{ marginBottom: 12 }}>
        <FilterSheetButton label="Frequency" options={FREQ_FILTERS} value={freq} onChange={setFreq} />
      </View>
    </View>
  );

  return (
    <ScreenContainer style={{ paddingHorizontal: 0 }}>
      <View style={{ flex: 1, paddingHorizontal: 16 }}>
        <ExpandableTable<PersonalLoan>
          headerContent={listHeader}
          columns={LOAN_COLUMNS}
          visibleCount={LOAN_VISIBLE_COUNT}
          data={loans}
          keyExtractor={(l) => String(l.id)}
          extraFields={loanExtraFields}
          onViewDescription={(l) => router.push(`/personal-loans/${l.id}`)}
          emptyText={isLoading ? "Loading…" : isError ? "Could not load personal loans." : "No personal loans found."}
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
