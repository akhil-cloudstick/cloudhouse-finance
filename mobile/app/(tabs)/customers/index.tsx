import React, { useEffect, useState } from "react";
import { useLocalSearchParams, useRouter } from "expo-router";
import { AccRow, CountLine, FabCorner, FlatHeader, Screen, SearchInput, ServerFlatList } from "../../../src/components/ui";
import { dmy } from "../../../src/lib/format";
import { CustomerFormSheet } from "../../../src/components/staff/CustomerFormSheet";
import { useServerList } from "../../../src/hooks/useServerList";
import { useResetOnBlur } from "../../../src/hooks/useRefetchOnFocus";
import { listCustomersPage } from "../../../src/api/customers";
import type { Customer } from "../../../src/types/customer";

// Customers list — prototype #header-customers + #page-customers.
// Search (name / customer ID / phone) is the server `q` on GET /customers;
// rows page in 10 at a time. The corner FAB (and the dashboard's Register
// Customer quick action, via ?register=1) opens the Register Customer sheet.
export default function CustomersScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ register?: string }>();
  const [registerOpen, setRegisterOpen] = useState(false);

  const list = useServerList<Customer>({ key: ["customers", "list"], fetchPage: (p) => listCustomersPage(p) });

  useEffect(() => {
    if (params.register === "1") {
      setRegisterOpen(true);
      router.setParams({ register: undefined } as never);
    }
  }, [params.register, router]);

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
      floating={<FabCorner onPress={() => setRegisterOpen(true)} label="Register customer" />}
    >
      <ServerFlatList
        list={list}
        items={list.items}
        keyOf={(c) => String(c.id)}
        emptyText={list.search ? "No customers match your search." : "No customers yet."}
        header={
          <>
            {total != null ? <CountLine>{`${total} customer${total === 1 ? "" : "s"}`}</CountLine> : null}
            <SearchInput
              value={list.search}
              onChangeText={list.setSearch}
              placeholder="Search this list by customer name, ID, or phone"
              style={total != null ? undefined : { paddingTop: 12 }}
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
