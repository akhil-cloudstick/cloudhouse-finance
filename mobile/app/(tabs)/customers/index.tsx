import React, { useState } from "react";
import { RefreshControl, View } from "react-native";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { ScreenContainer } from "../../../src/components/ScreenContainer";
import { ThemedText } from "../../../src/components/ThemedText";
import { GoldTextInput } from "../../../src/components/GoldTextInput";
import { GoldButton } from "../../../src/components/GoldButton";
import { colors, statusColors, StatusTone } from "../../../src/theme/colors";
import { listCustomersPage } from "../../../src/api/customers";
import { Customer } from "../../../src/types/customer";
import { useDebouncedValue } from "../../../src/hooks/useDebouncedValue";
import { useRefetchOnFocus } from "../../../src/hooks/useRefetchOnFocus";
import { ExpandableTable, defaultVisibleCount, type TableColumn } from "../../../src/components/ExpandableTable";

const PAGE_SIZE = 10;

function kycTone(status: string): StatusTone {
  const s = status.toLowerCase();
  if (s === "verified") return "green";
  if (s === "failed" || s === "rejected") return "red";
  return "amber";
}

function StatusPill({ status }: { status: string }) {
  const tone = statusColors(kycTone(status));
  return (
    <ThemedText
      variant="label"
      numberOfLines={1}
      // marginLeft (on top of the row's own 10px inter-column gap) —
      // Phone's own digits run right up to this column's edge, and the
      // shared 10px alone still read as the two values crowding together;
      // this is the extra 20px asked for, scoped to just this column
      // rather than widening every column's gap in ExpandableTable.tsx.
      style={{ backgroundColor: tone.bg, color: tone.fg, paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6, alignSelf: "flex-start", fontSize: 11.5, marginLeft: 20 }}
    >
      {status}
    </ThemedText>
  );
}

// 3 columns + 5 detail-only fields (Code/Branch/DOB/Address/PAN) = 8 total
// — "large", so this collapses to 3 columns: Name/Phone/KYC (Code moves
// into the expand strip, alongside the rest).
const CUSTOMER_COLUMNS: TableColumn<Customer>[] = [
  { key: "name", label: "Name", render: (c) => c.name, weight: 1.4 },
  { key: "phone", label: "Phone", render: (c) => c.phone },
  { key: "kyc", label: "KYC", render: (c) => <StatusPill status={c.kycStatus} /> },
];
const CUSTOMER_VISIBLE_COUNT = defaultVisibleCount(CUSTOMER_COLUMNS.length + 5);

function ageFromDob(dob: string): number {
  const birth = new Date(dob);
  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  const beforeBirthdayThisYear =
    today.getMonth() < birth.getMonth() || (today.getMonth() === birth.getMonth() && today.getDate() < birth.getDate());
  if (beforeBirthdayThisYear) age -= 1;
  return age;
}

function customerExtraFields(c: Customer) {
  return [
    { label: "Code", value: c.code },
    { label: "Branch", value: c.branch?.name || "—" },
    { label: "DOB", value: c.dob ? new Date(c.dob).toLocaleDateString("en-IN") : "—" },
    { label: "Age", value: c.dob ? `${ageFromDob(c.dob)}` : "—" },
    { label: "Address", value: c.address || "—" },
    { label: "PAN", value: c.pan || "—" },
  ];
}

export default function CustomersScreen() {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search);

  // Every keystroke (after debounce) re-queries the backend with `q` —
  // no in-memory filtering of a full customer list. Paginated 10/page, one
  // separate API call per page, loaded incrementally via infinite scroll.
  const { data, isLoading, isError, isFetching, isFetchingNextPage, fetchNextPage, hasNextPage, refetch } = useInfiniteQuery({
    queryKey: ["customers", debouncedSearch],
    queryFn: ({ pageParam = 0 }) => listCustomersPage({ q: debouncedSearch || undefined, limit: PAGE_SIZE, offset: pageParam }),
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) => (lastPage.hasMore ? allPages.length * PAGE_SIZE : undefined),
  });

  // useRefetchOnFocus calls the SAME `refetch` a pull-to-refresh gesture
  // does, and fires on every focus — not just navigating back from a
  // customer's detail screen, but every time this tab is switched back to
  // from Dashboard/Loans/etc, which happens far more often. Tying
  // RefreshControl's spinner to react-query's own `isFetching` made it
  // flash on every one of those background refetches too, reading as "the
  // loading buffer is always showing" even though nothing the person did
  // asked for it. Track pull-to-refresh separately so the spinner only
  // shows for an actual pull gesture; the focus refetch still runs and
  // updates the list, just silently.
  const [manualRefreshing, setManualRefreshing] = useState(false);
  async function onPullToRefresh() {
    setManualRefreshing(true);
    try {
      await refetch();
    } finally {
      setManualRefreshing(false);
    }
  }

  useRefetchOnFocus(refetch);

  const customers = data?.pages.flatMap((p) => p.items) ?? [];

  // Search + register scroll away with the rows (ExpandableTable's
  // headerContent) so the table's top fade sits right under the app header.
  const listHeader = (
    <View>
      <GoldTextInput
        label="Search customers"
        placeholder="Name, phone, or code…"
        value={search}
        onChangeText={setSearch}
        containerStyle={{ marginTop: 28 }}
        blur
      />
      <View style={{ marginBottom: 12 }}>
        <GoldButton title="+ Register customer" onPress={() => router.push("/customers/new")} />
      </View>
    </View>
  );

  return (
    <ScreenContainer style={{ paddingHorizontal: 0 }}>
      {/* Reaching the bottom loads the next page. */}
      <View style={{ flex: 1, paddingHorizontal: 16 }}>
        <ExpandableTable<Customer>
          headerContent={listHeader}
          columns={CUSTOMER_COLUMNS}
          visibleCount={CUSTOMER_VISIBLE_COUNT}
          data={customers}
          keyExtractor={(c) => String(c.id)}
          extraFields={customerExtraFields}
          onViewDescription={(c) => router.push(`/customers/${c.id}`)}
          emptyText={isLoading ? "Loading…" : isError ? "Could not load customers." : "No customers found."}
          refreshControl={<RefreshControl refreshing={manualRefreshing} onRefresh={onPullToRefresh} />}
          onEndReached={() => {
            if (hasNextPage && !isFetchingNextPage) fetchNextPage();
          }}
          isFetchingNextPage={isFetchingNextPage}
        />
      </View>
    </ScreenContainer>
  );
}
