import React, { useState } from "react";
import { View } from "react-native";
import { AccRow, FabCorner, FlatHeader, GroupedFilter, Screen, SearchFilterRow, ServerFlatList, SummaryCard, emptyGroupedFilter, gfValues, type GFSection, type GroupedFilterValue } from "@/common/components/ui";
import { usePersistedState } from "@/common/hooks/use-persisted-state";
import { useShowBranchFilter } from "@/common/hooks/use-branch-switch";
import { listBranchesPage } from "@/modules/branches/services/branchService";
import { useServerList } from "@/common/hooks/use-server-list";
import { useAuth } from "@/common/providers/AuthProvider";
import { useCanOpen } from "@/common/config/routePermissions";
import { openLedger } from "@/common/components/LedgerList";
import { balanceColor, fmtBalance } from "@/modules/banks/utils/bankBalance";
import { BanksSheet } from "@/modules/bank-pledges/components/BanksSheet";
import { listBanksPage } from "@/modules/banks/services/bankService";
import type { Bank } from "@/modules/banks/types/bank-types";
import { inr } from "@/common/utils/format";

// Bank Management — the banks the business uses, each with its balance, and the
// net balance across all of them (same figures as the web Bank Management page:
// GET /banks returns `balance` per bank and `totalBalance` over every match, not
// just the page). Adding, editing and deleting a bank reuse the Banks sheet.


export default function BankManagementScreen() {
  const { can } = useAuth();
  const canManage = can("Bank_Management", "can_create_bank") || can("Bank_Management", "can_update_bank") || can("Bank_Management", "can_delete_bank");
  // A bank's ledger is a Cash drill-down.
  const canLedger = useCanOpen()("/cash");
  const [manageOpen, setManageOpen] = useState(false);
  const [editBank, setEditBank] = useState<Bank | null>(null);
  const canEdit = can("Bank_Management", "can_update_bank");

  // The "banks" prefix is invalidated by the Banks sheet after an add, edit or delete.
  // Business branch — single-select, like the web (GET /banks?branchId=).
  const showBranch = useShowBranchFilter();
  const [fv, setFv] = usePersistedState<GroupedFilterValue>("banks:filters", emptyGroupedFilter());
  const sections: GFSection[] = [
    {
      kind: "async",
      key: "branch",
      label: "Branch",
      fetchPage: (p) => listBranchesPage({ q: p.q, limit: p.limit, offset: p.offset }).then((r) => ({ items: r.items.map((b) => ({ value: String(b.id), label: b.name })), hasMore: r.hasMore })),
    },
  ];
  // Several branches are sent comma-joined, the form GET /banks takes them in.
  const branchId = showBranch ? gfValues(fv, "branch").join(",") || undefined : undefined;
  const list = useServerList<Bank, { branchId?: string }>({
    key: ["banks", "management"],
    persistKey: "bankManagement",
    filters: { branchId },
    fetchPage: (p) => listBanksPage(p),
  });
  const netBalance = list.pages?.[0]?.totalBalance;

  return (
    <Screen
      header={<FlatHeader title="Bank Management" subtitle="Banks & net balance" />}
      floating={canManage ? <FabCorner onPress={() => { setEditBank(null); setManageOpen(true); }} label="Manage banks" /> : undefined}
    >
      <ServerFlatList stickyHeader
        list={list}
        items={list.items}
        keyOf={(b) => String(b.id)}
        emptyText={list.search || branchId ? "No banks match your search." : "No banks yet."}
        header={
          <View>
            {netBalance != null ? (
              <View style={{ paddingTop: 14 }}>
                <SummaryCard title="Net bank balance" stats={[{ n: fmtBalance(netBalance), l: "Across all banks" }]} />
              </View>
            ) : null}
            <SearchFilterRow
              value={list.search}
              onChangeText={list.setSearch}
              placeholder="Search by bank, branch, IFSC or account no."
              filter={showBranch ? <GroupedFilter title="Filter banks" sections={sections} value={fv} onChange={setFv} /> : undefined}
              style={{ paddingTop: 8 }}
            />
          </View>
        }
        renderItem={(b, i) => (
          <AccRow
            defaultOpen={i === 0}
            name={b.name}
            sub={b.branch || b.ifsc || "—"}
            amount={fmtBalance(b.balance ?? 0)}
            amountColor={balanceColor(b.balance ?? 0)}
            details={[
              { k: "Balance", v: fmtBalance(b.balance ?? 0), color: balanceColor(b.balance ?? 0) },
              { k: "IFSC", v: b.ifsc || "—" },
              { k: "Account no", v: b.accountNo || "—" },
              { k: "Phone", v: b.phone || "—" },
              ...(b.branchName ? [{ k: "Business branch", v: b.branchName }] : []),
              ...(b.activePledgeCount ? [{ k: "Active pledges", v: `${b.activePledgeCount} · ${inr(b.activePledgeAmount ?? 0)}` }] : []),
            ]}
            actions={[
              ...(canLedger ? [{ label: "Ledger", primary: true, onPress: () => openLedger("bank", b.id, b.name) }] : []),
              ...(canEdit ? [{ label: "Edit", onPress: () => { setEditBank(b); setManageOpen(true); } }] : []),
            ]}
          />
        )}
      />
      <BanksSheet visible={manageOpen} editBank={editBank} onClose={() => { setManageOpen(false); setEditBank(null); }} />
    </Screen>
  );
}
