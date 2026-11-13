import React, { useState } from "react";
import { View } from "react-native";
import { useRouter } from "expo-router";
import { AccRow, FabMenu, FlatHeader, Screen, SearchInput, ServerFlatList } from "@/common/components/ui";
import { useServerList } from "@/common/hooks/use-server-list";
import { useAuth } from "@/common/providers/AuthProvider";
import { InvestorFormSheet } from "@/modules/investments/components/InvestorFormSheet";
import { listInvestorsPage, type Investor } from "@/modules/investments/services/investorService";

// Investors — mobile equivalent of web's Investors modal: searchable list (name / code / phone) with phone and
// branch; each opens its detail page. Managed with the investment permissions, like web.
export default function InvestorsScreen() {
  const router = useRouter();
  const canCreate = useAuth().can("Investment_Management", "can_create_investment");
  const [createOpen, setCreateOpen] = useState(false);
  const list = useServerList<Investor>({ key: ["investors", "list"], persistKey: "investors", fetchPage: (p) => listInvestorsPage(p) });

  return (
    <Screen
      header={<FlatHeader back title="Investors" subtitle="People who invest with you" />}
      floating={canCreate ? <FabMenu label="Investor actions" actions={[{ label: "New Investor", icon: "plus", onPress: () => setCreateOpen(true) }]} /> : null}
    >
      <ServerFlatList
        list={list}
        items={list.items}
        keyOf={(i) => String(i.id)}
        emptyText={list.search ? "No investors match your search." : "No investors yet."}
        header={
          <View style={{ paddingTop: 12 }}>
            <SearchInput value={list.search} onChangeText={list.setSearch} placeholder="Search by name, code or phone" style={{ paddingBottom: 8 }} />
          </View>
        }
        renderItem={(inv) => (
          <AccRow
            id={inv.code}
            name={inv.name}
            sub={inv.phone || undefined}
            details={[
              { k: "Phone", v: inv.phone || "—" },
              { k: "Branch", v: inv.branch?.name || "—" },
            ]}
            actions={[{ label: "View", primary: true, onPress: () => router.push(`/investments/investors/${inv.id}` as never) }]}
          />
        )}
      />
      <InvestorFormSheet visible={createOpen} onClose={() => setCreateOpen(false)} onSaved={(i) => router.push(`/investments/investors/${i.id}` as never)} />
    </Screen>
  );
}
