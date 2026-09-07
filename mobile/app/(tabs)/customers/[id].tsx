import React, { useState } from "react";
import { Pressable, RefreshControl, ScrollView, View, StyleSheet } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useQuery, useInfiniteQuery } from "@tanstack/react-query";
import { ScreenContainer } from "../../../src/components/ScreenContainer";
import { Card } from "../../../src/components/Card";
import { ThemedText } from "../../../src/components/ThemedText";
import { GoldButton } from "../../../src/components/GoldButton";
import { colors, statusColors } from "../../../src/theme/colors";
import { getCustomer } from "../../../src/api/customers";
import {
  listCustomerOrnamentsPage,
  listCustomerPaymentsPage,
  listCustomerBankPledgesPage,
  listCustomerAuctionHistoryPage,
} from "../../../src/api/customers";
import { listLoansPage } from "../../../src/api/loans";
import { Loan, CustomerOrnamentRow, CustomerPaymentRow, CustomerBankPledgeRow, CustomerAuctionRow } from "../../../src/types/loan";
import { fmt } from "../../../src/lib/format";
import { useRefetchOnFocus } from "../../../src/hooks/useRefetchOnFocus";
import { ExpandableTable, type TableColumn } from "../../../src/components/ExpandableTable";

const PAGE_SIZE = 10; // matches the rest of the mobile app's paginated tables

const fmtW = (n?: number | null) => `${(n ?? 0).toFixed(2)}g`;

// Mirrors frontend/modules/customers/components/CustomerDetail.tsx's
// TABLE_TABS — same 5 tabs, same order. Loan History reuses the existing
// listLoansPage({customerId}) rather than a new endpoint; the other 4 are
// new (see src/api/customers.ts's listCustomer*Page additions).
const TABS = ["Loans", "Ornaments", "Payments", "Bank Pledges", "Auctions"] as const;

function toneForLoanStatus(status: string): "green" | "red" | "amber" | "info" | "muted" {
  const s = status.toLowerCase();
  if (s.includes("approved") || s.includes("closed")) return "green";
  if (s.includes("reject") || s.includes("default")) return "red";
  if (s.includes("pending")) return "amber";
  return "info";
}

function Pill({ label, tone }: { label: string; tone: "green" | "red" | "amber" | "info" | "muted" }) {
  const t = statusColors(tone);
  return (
    <ThemedText
      variant="label"
      numberOfLines={1}
      style={{ backgroundColor: t.bg, color: t.fg, paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6, alignSelf: "flex-start", fontSize: 11.5 }}
    >
      {label}
    </ThemedText>
  );
}

// Every customer name is already known on this screen (it's the page's own
// subject), so the customer column each of these tables would otherwise
// carry is dropped — 3 columns each, no "large"-table trimming needed.
const LOAN_COLS: TableColumn<Loan>[] = [
  { key: "loanNumber", label: "Loan No", render: (l) => l.loanNumber },
  { key: "status", label: "Status", render: (l) => <Pill label={l.status} tone={toneForLoanStatus(l.status)} /> },
  { key: "outstanding", label: "Outstanding", render: (l) => fmt(l.outstandingAmount) },
];
function loanExtra(l: Loan) {
  return [
    { label: "Principal", value: fmt(l.principalAmount) },
    { label: "Opened", value: new Date(l.openedDate).toLocaleDateString("en-IN") },
    { label: "Due", value: new Date(l.dueDate).toLocaleDateString("en-IN") },
  ];
}

const ORNAMENT_COLS: TableColumn<CustomerOrnamentRow>[] = [
  { key: "name", label: "Ornament", render: (o) => o.name, weight: 1.2 },
  { key: "loan", label: "Loan", render: (o) => o.loanNumber },
  { key: "purity", label: "Purity", render: (o) => o.purity },
];
function ornamentExtra(o: CustomerOrnamentRow) {
  return [
    { label: "Net Weight", value: fmtW(o.netWeight) },
    { label: "Gold Value", value: fmt(o.goldValue) },
  ];
}

const PAYMENT_COLS: TableColumn<CustomerPaymentRow>[] = [
  { key: "loan", label: "Loan", render: (p) => p.loanNumber },
  { key: "type", label: "Type", render: (p) => p.type, weight: 1.2 },
  { key: "amount", label: "Amount", render: (p) => fmt(p.amount) },
];
function paymentExtra(p: CustomerPaymentRow) {
  return [
    { label: "Paid On", value: p.paidOn },
    { label: "Method", value: p.method || "—" },
  ];
}

const PLEDGE_COLS: TableColumn<CustomerBankPledgeRow>[] = [
  { key: "loan", label: "Loan", render: (b) => b.loanNumber },
  { key: "bank", label: "Bank", render: (b) => b.bankName, weight: 1.2 },
  { key: "amount", label: "Amount", render: (b) => fmt(b.pledgedAmount) },
];
function pledgeExtra(b: CustomerBankPledgeRow) {
  return [
    { label: "Pledge Date", value: b.pledgeDate },
    { label: "Status", value: b.status },
  ];
}

const AUCTION_COLS: TableColumn<CustomerAuctionRow>[] = [
  { key: "loan", label: "Loan", render: (a) => a.loanNumber },
  { key: "stage", label: "Stage", render: (a) => a.stage, weight: 1.2 },
  { key: "sale", label: "Sale", render: (a) => (a.saleAmount ? fmt(a.saleAmount) : "—") },
];
function auctionExtra(a: CustomerAuctionRow) {
  const surplus = a.surplusShortfall ?? 0;
  return [
    { label: "Auction Date", value: a.auctionDate || "—" },
    {
      label: surplus >= 0 ? "Surplus" : "Shortfall",
      value: a.saleAmount ? (
        <ThemedText variant="small" color={surplus >= 0 ? colors.green : colors.red}>
          {fmt(Math.abs(surplus))}
        </ThemedText>
      ) : (
        "—"
      ),
    },
  ];
}

export default function CustomerDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const customerId = Number(id);
  const [tab, setTab] = useState(0);
  function changeTab(i: number) {
    setTab(i);
  }

  const { data, isLoading, isError, refetch, isRefetching } = useQuery({
    queryKey: ["customer", id],
    queryFn: () => getCustomer(customerId),
    enabled: !!id,
  });

  // Each tab is its own infinite query, gated to the active tab so
  // switching tabs doesn't eagerly fire all 5 requests up front — only the
  // one currently showing (and any already-visited tab, since React Query
  // caches by queryKey and `enabled` merely pauses future fetches, not the
  // cache itself).
  const loansQ = useInfiniteQuery({
    queryKey: ["loans", "customer", customerId],
    queryFn: ({ pageParam = 0 }) => listLoansPage({ customerId, limit: PAGE_SIZE, offset: pageParam }),
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) => (lastPage.hasMore ? allPages.length * PAGE_SIZE : undefined),
    enabled: !!id && tab === 0,
  });
  const ornamentsQ = useInfiniteQuery({
    queryKey: ["customerOrnaments", customerId],
    queryFn: ({ pageParam = 0 }) => listCustomerOrnamentsPage(customerId, PAGE_SIZE, pageParam),
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) => (lastPage.hasMore ? allPages.length * PAGE_SIZE : undefined),
    enabled: !!id && tab === 1,
  });
  const paymentsQ = useInfiniteQuery({
    queryKey: ["customerPayments", customerId],
    queryFn: ({ pageParam = 0 }) => listCustomerPaymentsPage(customerId, PAGE_SIZE, pageParam),
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) => (lastPage.hasMore ? allPages.length * PAGE_SIZE : undefined),
    enabled: !!id && tab === 2,
  });
  const bankPledgesQ = useInfiniteQuery({
    queryKey: ["customerBankPledges", customerId],
    queryFn: ({ pageParam = 0 }) => listCustomerBankPledgesPage(customerId, PAGE_SIZE, pageParam),
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) => (lastPage.hasMore ? allPages.length * PAGE_SIZE : undefined),
    enabled: !!id && tab === 3,
  });
  const auctionsQ = useInfiniteQuery({
    queryKey: ["customerAuctions", customerId],
    queryFn: ({ pageParam = 0 }) => listCustomerAuctionHistoryPage(customerId, PAGE_SIZE, pageParam),
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) => (lastPage.hasMore ? allPages.length * PAGE_SIZE : undefined),
    enabled: !!id && tab === 4,
  });

  const queries = [loansQ, ornamentsQ, paymentsQ, bankPledgesQ, auctionsQ];
  const activeQuery = queries[tab];

  useRefetchOnFocus(refetch, () => activeQuery.refetch());

  // activeQuery is picked at runtime from a union of 5 differently-typed
  // useInfiniteQuery results (one per tab) — TS can't narrow which one
  // without a discriminant, so `.data.pages` collapses to an unhelpful
  // intersection. ExpandableTable below is given `any` columns per tab for
  // the same reason.
  const items: any[] = (activeQuery.data as any)?.pages?.flatMap((p: any) => p.items) ?? [];
  const activeColumns = [LOAN_COLS, ORNAMENT_COLS, PAYMENT_COLS, PLEDGE_COLS, AUCTION_COLS][tab] as TableColumn<any>[];
  const activeExtra = [loanExtra, ornamentExtra, paymentExtra, pledgeExtra, auctionExtra][tab] as (row: any) => { label: string; value: React.ReactNode }[];
  const activeHasNextPage = !!(activeQuery as any).hasNextPage;
  const activeIsFetchingNextPage = !!(activeQuery as any).isFetchingNextPage;
  const activeFetchNextPage = (activeQuery as any).fetchNextPage as () => void;

  if (isLoading) {
    return (
      <ScreenContainer style={{ paddingHorizontal: 16, paddingTop: 20 }}>
        <ThemedText color={colors.muted}>Loading…</ThemedText>
      </ScreenContainer>
    );
  }
  if (isError || !data) {
    return (
      <ScreenContainer style={{ paddingHorizontal: 16, paddingTop: 20 }}>
        <ThemedText color={colors.red}>Could not load this customer.</ThemedText>
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer style={{ padding: 0 }}>
      {/* Customer info + nominee + tab chips are fixed, not scrollable — only
       * the table below scrolls (its column-label row and count footer both
       * sticky, more rows loading in via infinite scroll). See
       * ExpandableTable.tsx's own comment on why it needs its own flex:1
       * slot rather than a shared ScrollView. */}
      <View style={{ paddingHorizontal: 16, paddingTop: 20 }}>
        <Card>
          <ThemedText variant="h2" color={colors.brandDeep}>
            {data.name}
          </ThemedText>
          <ThemedText variant="body" style={{ marginTop: 8 }}>
            {data.code} · {data.phone}
          </ThemedText>
          {data.dob ? (
            <ThemedText variant="small" style={{ marginTop: 4 }} color={colors.muted}>
              DOB {new Date(data.dob).toLocaleDateString("en-IN")}
            </ThemedText>
          ) : null}
          <ThemedText variant="body" style={{ marginTop: 4 }} color={colors.muted}>
            {data.address}
          </ThemedText>
          {data.branch?.name ? (
            <ThemedText variant="small" style={{ marginTop: 4 }} color={colors.muted}>
              Branch: {data.branch.name}
            </ThemedText>
          ) : null}
          <ThemedText variant="label" style={{ marginTop: 12 }}>
            KYC {data.kycStatus} · PAN {data.panStatus} · Aadhaar {data.aadhaarStatus}
          </ThemedText>
          {data.pan ? (
            <ThemedText variant="small" style={{ marginTop: 4 }} color={colors.muted}>
              PAN {data.pan}
            </ThemedText>
          ) : null}
          {data.aadhaarLast4 ? (
            <ThemedText variant="small" style={{ marginTop: 4 }} color={colors.muted}>
              Aadhaar ••••{data.aadhaarLast4}
            </ThemedText>
          ) : null}
          <GoldButton
            title="Edit Customer"
            variant="outline"
            onPress={() => router.push(`/customers/edit/${customerId}`)}
            style={{ marginTop: 12 }}
          />
        </Card>

        {data.nomineeName ? (
          <Card>
            <ThemedText variant="h3" style={{ marginBottom: 8 }}>
              Nominee
            </ThemedText>
            <ThemedText variant="body">{data.nomineeName}</ThemedText>
            <ThemedText variant="small" color={colors.muted} style={{ marginTop: 4 }}>
              {data.nomineeRelation} · {data.nomineePhone}
            </ThemedText>
          </Card>
        ) : null}

        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tabRow} contentContainerStyle={{ gap: 8 }}>
          {TABS.map((t, i) => {
            const active = i === tab;
            return (
              <Pressable key={t} onPress={() => changeTab(i)} style={[styles.tabChip, active && styles.tabChipActive]}>
                <ThemedText variant="small" color={active ? colors.bg : colors.ink}>
                  {t}
                </ThemedText>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      <View style={{ flex: 1, paddingHorizontal: 16, paddingTop: 8 }}>
        <ExpandableTable<any>
          columns={activeColumns}
          visibleCount={3}
          data={items}
          keyExtractor={(item: any) => `${tab}-${item.id}`}
          extraFields={activeExtra}
          onViewDescription={(r: any) => router.push(`/loans/${r.loanId ?? r.id}`)}
          emptyText={activeQuery.isLoading ? "Loading…" : activeQuery.isError ? "Could not load." : `No ${TABS[tab].toLowerCase()} found.`}
          refreshControl={
            <RefreshControl
              refreshing={(isRefetching || (activeQuery.isFetching && !activeIsFetchingNextPage && !activeQuery.isLoading))}
              onRefresh={() => { refetch(); activeQuery.refetch(); }}
            />
          }
          onEndReached={() => {
            if (activeHasNextPage && !activeIsFetchingNextPage) activeFetchNextPage();
          }}
          isFetchingNextPage={activeIsFetchingNextPage}
        />
      </View>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  tabRow: { marginTop: 4, marginBottom: 12, flexGrow: 0 },
  tabChip: {
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.card,
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  tabChipActive: { backgroundColor: colors.brandDeep, borderColor: colors.brandDeep },
});
