import React, { useEffect, useState } from "react";
import { View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { AccRow, FabCorner, FlatHeader, GroupedFilter, Screen, SearchInput, ServerFlatList, emptyGroupedFilter, gfValues, type GFSection, type GroupedFilterValue } from "@/common/components/ui";
import { usePersistedState } from "@/common/hooks/use-persisted-state";
import { dmy } from "@/common/utils/format";
import { CustomerFormSheet } from "@/modules/customers/components/CustomerFormSheet";
import { useServerList } from "@/common/hooks/use-server-list";
import { useResetOnBlur } from "@/common/hooks/use-refetch-on-focus";
import { listCustomersPage } from "@/modules/customers/services/customerService";
import type { Customer } from "@/modules/customers/types/customer-types";
import { useAuth } from "@/common/providers/AuthProvider";

// Same PAN / Aadhaar verification filters as web's Customers page (multi-select each).
const VERIFICATION_OPTIONS = [
  { value: "Verified", label: "Verified" },
  { value: "Pending", label: "Pending" },
  { value: "Failed", label: "Failed" },
  { value: "Name Mismatch", label: "Name Mismatch" },
];
const FILTER_SECTIONS: GFSection[] = [
  { kind: "static", key: "pan", label: "PAN Verified", options: VERIFICATION_OPTIONS },
  { kind: "static", key: "aadhaar", label: "Aadhaar Verified", options: VERIFICATION_OPTIONS },
];

// Customers list — prototype #header-customers + #page-customers.
// Search (name / customer ID / phone) is the server `q` on GET /customers;
// rows page in 10 at a time. The corner FAB (and the dashboard's Register
// Customer quick action, via ?register=1) opens the Register Customer sheet.
export default function CustomersScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ register?: string }>();
  const [registerOpen, setRegisterOpen] = useState(false);
  const canCreate = useAuth().can("Customer_Management", "can_create_customer");

  const [fv, setFv] = usePersistedState<GroupedFilterValue>("customers:filters", emptyGroupedFilter());
  const filters = { panStatus: gfValues(fv, "pan").join(",") || undefined, aadhaarStatus: gfValues(fv, "aadhaar").join(",") || undefined };
  const list = useServerList<Customer, { panStatus?: string; aadhaarStatus?: string }>({ key: ["customers", "list"], persistKey: "customers", fetchPage: (p) => listCustomersPage(p), filters });

  useEffect(() => {
    if (params.register === "1") {
      if (canCreate) setRegisterOpen(true);
      router.setParams({ register: undefined } as never);
    }
  }, [params.register, router, canCreate]);

  useResetOnBlur(() => setRegisterOpen(false));

  const total = list.total;
  return (
    <Screen
      header={
        <FlatHeader
          title="Customers"
          subtitle={total != null ? `${total} total` : undefined}
        />
      }
      floating={canCreate ? <FabCorner onPress={() => setRegisterOpen(true)} label="Register customer" /> : undefined}
    >
      <ServerFlatList
        list={list}
        items={list.items}
        keyOf={(c) => String(c.id)}
        emptyText={list.search ? "No customers match your search." : "No customers yet."}
        header={
          <>
            <View style={{ paddingHorizontal: 18, paddingTop: 12, paddingBottom: 16 }}>
              <GroupedFilter title="Filter customers" sections={FILTER_SECTIONS} value={fv} onChange={setFv} />
            </View>
            <SearchInput
              value={list.search}
              onChangeText={list.setSearch}
              placeholder="Search this list by customer name, ID, or phone"
            />
          </>
        }
        renderItem={(c, i) => (
          <AccRow
            defaultOpen={i === 0}
            id={c.code}
            name={c.name}
            sub={c.phone || undefined}
            status={c.kycStatus || undefined}
            details={[
              { k: "Phone", v: c.phone || "—" },
              { k: "Branch", v: c.branch?.name || "—" },
              { k: "KYC status", v: c.kycStatus || "—" },
              { k: "PAN", v: c.panStatus || "—" },
              { k: "Aadhaar", v: c.aadhaarStatus || "—" },
              { k: "Added on", v: c.createdAt ? dmy(c.createdAt) : "—" },
            ]}
            actions={[{ label: "View Customer", primary: true, onPress: () => router.push(`/customers/${c.id}` as never) }]}
          />
        )}
      />

      <CustomerFormSheet
        visible={registerOpen}
        onClose={() => setRegisterOpen(false)}
        onSaved={(c) => {
          if (c?.id) router.push(`/customers/${c.id}` as never);
        }}
      />
    </Screen>
  );
}
