import React, { useEffect } from "react";
import { View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { useLocalSearchParams, useRouter } from "expo-router";
import { AccRow, C, FabCorner, FlatHeader, GroupedFilter, Screen, SearchInput, ServerFlatList, gfValues, useShell } from "@/common/components/ui";
import { useShowBranchFilter } from "@/common/hooks/use-branch-switch";
import {
  EMPTY_LOAN_FILTERS,
  LOAN_STATUS_OPTIONS,
  loanFilterSections,
  loanFilterParams,
  type LoanFilters,
} from "@/modules/loans/components/LoanFilterSheet";
import { useServerList } from "@/common/hooks/use-server-list";
import { usePersistedState } from "@/common/hooks/use-persisted-state";
import { useAuth } from "@/common/providers/AuthProvider";
import { listLoansPage } from "@/modules/loans/services/loanService";
import { dmy, inr, todayISO } from "@/common/utils/format";
import type { Loan } from "@/modules/loans/types/loan-types";

// Loans list — prototype #header-loans + #page-loans + #filter-sheet-modal.
// Search (loan no. / customer name / customer ID) and every filter are
// server-side params on GET /loans; rows page in 10 at a time.

export const LOAN_STATUS_FILTERS = ["All", ...LOAN_STATUS_OPTIONS] as const;

function daysBetween(fromISO: string, toISO: string) {
  const a = new Date(+fromISO.slice(0, 4), +fromISO.slice(5, 7) - 1, +fromISO.slice(8, 10));
  const b = new Date(+toISO.slice(0, 4), +toISO.slice(5, 7) - 1, +toISO.slice(8, 10));
  return Math.round((b.getTime() - a.getTime()) / 86400000);
}

export function loanRowDetails(l: Loan) {
  const status = (l.status ?? "").toLowerCase();
  const weight = l.totalNetWeight != null ? `${+Number(l.totalNetWeight).toFixed(2)} g` : "—";
  // Shown on every loan, like web's list: what is still owed, and whether the gold is pledged to a bank.
  const common = [
    { k: "Outstanding", v: inr(l.totalOutstandingBalance ?? l.outstandingAmount ?? 0) },
    ...(l.bankPledgeStatus === "Bank Pledged" ? [{ k: "Pledge", v: "Bank Pledged" }] : []),
  ];
  if (status.includes("closed") || status.includes("released")) {
    return [
      { k: "Gold weight", v: weight },
      { k: "Opened on", v: dmy(l.openedDate) },
      ...common,
    ];
  }
  const today = todayISO();
  const due = l.dueDate?.slice(0, 10);
  if (l.isOverdue || (due && due < today)) {
    const d = l.daysOverdue ?? (due ? daysBetween(due, today) : 0);
    return [
      { k: "Gold weight", v: weight },
      { k: "Opened on", v: dmy(l.openedDate) },
      { k: "Overdue by", v: `${d} day${d === 1 ? "" : "s"}`, color: C.red },
      ...common,
    ];
  }
  return [
    { k: "Gold weight", v: weight },
    { k: "Opened on", v: dmy(l.openedDate) },
    { k: "Next due", v: due === today ? "Today" : dmy(l.dueDate) },
    ...common,
  ];
}

export default function LoansScreen() {
  const router = useRouter();
  const shell = useShell();
  const { can } = useAuth();
  const params = useLocalSearchParams<{ schemeId?: string; status?: string }>();

  const [filters, setFilters] = usePersistedState<LoanFilters>("loans:filters", EMPTY_LOAN_FILTERS);

  // Deep links: /loans?schemeId=… (global search "Scheme") / ?status=…
  const schemeId = params.schemeId ? Number(params.schemeId) : undefined;
  useEffect(() => {
    const match = LOAN_STATUS_OPTIONS.find((f) => f.toLowerCase() === params.status?.toLowerCase());
    if (match) setFilters((f) => ({ ...f, options: { ...f.options, status: [{ value: match, label: match }] } }));
  }, [params.status, setFilters]);

  const showBranchFilter = useShowBranchFilter();
  const apiFilters = { ...loanFilterParams(filters, showBranchFilter), schemeId };
  const list = useServerList<Loan, typeof apiFilters>({ key: ["loans", "list"], persistKey: "loans", filters: apiFilters, fetchPage: (p) => listLoansPage(p) });
  const overdue = useQuery({ queryKey: ["loans", "overdue-count"], queryFn: () => listLoansPage({ status: "Overdue", limit: 1, offset: 0 }) });

  const overdueTotal = (overdue.data as { total?: number } | undefined)?.total;

  return (
    <Screen
      header={
        <FlatHeader
          title="Loans"
          subtitle={list.total != null ? `${list.total} total${overdueTotal != null ? ` · ${overdueTotal} overdue` : ""}` : undefined}
        />
      }
      floating={can("Loan_Management", "can_create_loan") ? <FabCorner onPress={shell.openNewLoan} label="New loan" /> : undefined}
    >
      <ServerFlatList
        list={list}
        items={list.items}
        keyOf={(l) => String(l.id)}
        emptyText={list.search ? "No loans match your search." : "No loans found."}
        header={
          <>
            <View style={{ paddingHorizontal: 18, paddingTop: 12, paddingBottom: 16 }}>
              <GroupedFilter title="Filter loans" sections={loanFilterSections(showBranchFilter, showBranchFilter ? gfValues(filters, "branch") : [])} value={filters} onChange={setFilters} />
            </View>
            <SearchInput
              value={list.search}
              onChangeText={list.setSearch}
              placeholder="Search this list by loan ID or customer name"
            />
          </>
        }
        contentStyle={{ paddingTop: 0 }}
        renderItem={(l, i) => {
          const closed = /closed|released/i.test(l.status ?? "");
          return (
            <AccRow
              defaultOpen={i === 0}
              id={l.loanNumber}
              name={l.customer?.name ?? `Customer #${l.customerId}`}
              sub={l.scheme?.name || undefined}
              amount={inr(l.principalAmount)}
              status={l.status}
              details={loanRowDetails(l)}
              actions={[
                ...(can("Loan_Management", "can_update_loan") ? [{ label: "Collect Payment", disabled: closed, onPress: () => shell.openCollect(l.id) }] : []),
                { label: "View Full Details", primary: true, onPress: () => router.push(`/loans/${l.id}` as never) },
              ]}
            />
          );
        }}
      />

    </Screen>
  );
}
