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
      style={{ backgroundColor: tone.bg, color: tone.fg, paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6, alignSelf: "flex-start", fontSize: 11.5 }}
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

function customerExtraFields(c: Customer) {
  return [
    { label: "Code", value: c.code },
    { label: "Branch", value: c.branch?.name || "—" },
    { label: "DOB", value: c.dob ? new Date(c.dob).toLocaleDateString("en-IN") : "—" },
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

  useRefetchOnFocus(refetch);

  const customers = data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <ScreenContainer style={{ paddingHorizontal: 0 }}>
      <GoldTextInput
        label="Search customers"
        placeholder="Name, phone, or code…"
        value={search}
        onChangeText={setSearch}
        containerStyle={{ marginHorizontal: 16, marginTop: 28 }}
        blur
      />
      <View style={{ marginHorizontal: 16, marginBottom: 12 }}>
        <GoldButton title="+ Register customer" onPress={() => router.push("/customers/new")} />
      </View>

      {/* Only this scrolls — column-label row (sticky, inside
       * ExpandableTable) stays put; reaching the bottom loads the next page. */}
      <View style={{ flex: 1, paddingHorizontal: 16 }}>
        <ExpandableTable<Customer>
          columns={CUSTOMER_COLUMNS}
          visibleCount={CUSTOMER_VISIBLE_COUNT}
          data={customers}
          keyExtractor={(c) => String(c.id)}
          extraFields={customerExtraFields}
          onViewDescription={(c) => router.push(`/customers/${c.id}`)}
          emptyText={isLoading ? "Loading…" : isError ? "Could not load customers." : "No customers found."}
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
