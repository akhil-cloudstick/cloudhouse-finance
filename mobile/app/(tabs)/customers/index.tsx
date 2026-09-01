import React, { useEffect, useState } from "react";
import { ScrollView, RefreshControl, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { ScreenContainer } from "../../../src/components/ScreenContainer";
import { ThemedText } from "../../../src/components/ThemedText";
import { GoldTextInput } from "../../../src/components/GoldTextInput";
import { GoldButton } from "../../../src/components/GoldButton";
import { Pager } from "../../../src/components/Pager";
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
  const [page, setPage] = useState(1);

  useEffect(() => {
    setPage(1);
  }, [debouncedSearch]);

  // Every keystroke (after debounce) re-queries the backend with `q` —
  // no in-memory filtering of a full customer list. Paginated 10/page, one
  // separate API call per page, Prev/Next-driven.
  const { data, isLoading, isError, isFetching, refetch } = useQuery({
    queryKey: ["customers", debouncedSearch, page],
    queryFn: () => listCustomersPage({ q: debouncedSearch || undefined, limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE }),
  });

  useRefetchOnFocus(refetch);

  const customers = data?.items ?? [];

  return (
    <ScreenContainer style={{ paddingHorizontal: 0 }}>
      <GoldTextInput
        label="Search customers"
        placeholder="Name, phone, or code…"
        value={search}
        onChangeText={setSearch}
        containerStyle={{ marginHorizontal: 16 }}
        blur
      />
      <View style={{ marginHorizontal: 16, marginBottom: 12 }}>
        <GoldButton title="+ Register customer" onPress={() => router.push("/customers/new")} />
      </View>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 16 }}
        refreshControl={<RefreshControl refreshing={isFetching && !isLoading} onRefresh={refetch} />}
      >
        <ExpandableTable<Customer>
          columns={CUSTOMER_COLUMNS}
          visibleCount={CUSTOMER_VISIBLE_COUNT}
          data={customers}
          keyExtractor={(c) => String(c.id)}
          extraFields={customerExtraFields}
          onViewDescription={(c) => router.push(`/customers/${c.id}`)}
          emptyText={isLoading ? "Loading…" : isError ? "Could not load customers." : "No customers found."}
        />
        <Pager page={page} hasMore={!!data?.hasMore} onChange={setPage} loading={isFetching} />
      </ScrollView>
    </ScreenContainer>
  );
}
