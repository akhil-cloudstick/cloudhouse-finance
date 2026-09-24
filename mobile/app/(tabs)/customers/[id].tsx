import React, { useRef, useState } from "react";
import { TAB_BAR_SPACE } from "../../../src/theme/layout";
import { ActivityIndicator, NativeScrollEvent, NativeSyntheticEvent, Pressable, RefreshControl, ScrollView, StyleSheet, View, useWindowDimensions } from "react-native";
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
import { fmt, fmtDate } from "../../../src/lib/format";
import { useRefetchOnFocus } from "../../../src/hooks/useRefetchOnFocus";
import { TableRow, type TableColumn } from "../../../src/components/ExpandableTable";
import { Icon } from "../../../src/components/Icon";
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg";

const STICKY_FADE_STOPS = Array.from({ length: 21 }, (_, i) => i / 20);
const PAGE_SIZE = 10; // matches the rest of the mobile app's paginated tables

const fmtW = (n?: number | null) => `${(n ?? 0).toFixed(2)}g`;

function ageFromDob(dob: string): number {
  const birth = new Date(dob);
  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  const beforeBirthdayThisYear =
    today.getMonth() < birth.getMonth() || (today.getMonth() === birth.getMonth() && today.getDate() < birth.getDate());
  if (beforeBirthdayThisYear) age -= 1;
  return age;
}

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
    { label: "Paid On", value: fmtDate(p.paidOn) },
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
    { label: "Pledge Date", value: fmtDate(b.pledgeDate) },
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
    { label: "Auction Date", value: fmtDate(a.auctionDate) },
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

function TableSwitcher({ index, onGo }: { index: number; onGo: (i: number) => void }) {
  const canPrev = index > 0;
  const canNext = index < TABS.length - 1;
  return (
    <View style={styles.switcher}>
      <Pressable onPress={() => canPrev && onGo(index - 1)} hitSlop={10} style={[styles.switchBtn, !canPrev && { opacity: 0.3 }]}>
        <Icon name="chevronLeft" size={18} color={colors.brandDeep} />
      </Pressable>
      <View style={{ flex: 1, alignItems: "center" }}>
        <ThemedText variant="h3" color={colors.brandDeep}>
          {TABS[index]}
        </ThemedText>
        <View style={styles.dots}>
          {TABS.map((t, i) => (
            <Pressable key={t} onPress={() => onGo(i)} hitSlop={6}>
              <View style={[styles.dot, i === index && styles.dotActive]} />
            </Pressable>
          ))}
        </View>
      </View>
      <Pressable onPress={() => canNext && onGo(index + 1)} hitSlop={10} style={[styles.switchBtn, !canNext && { opacity: 0.3 }]}>
        <View style={{ transform: [{ rotate: "180deg" }] }}>
          <Icon name="chevronLeft" size={18} color={colors.brandDeep} />
        </View>
      </Pressable>
    </View>
  );
}

export default function CustomerDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const customerId = Number(id);
  const [tab, setTab] = useState(0);
  const { width: windowWidth } = useWindowDimensions();
  const [pageWidth, setPageWidth] = useState(windowWidth);
  const [pageHeights, setPageHeights] = useState<number[]>([]);
  const pagerRef = useRef<ScrollView>(null);
  function goToTab(i: number) {
    pagerRef.current?.scrollTo({ x: i * pageWidth, animated: true });
    setTab(i);
  }
  // Current page plus its neighbours, so a swipe lands on already-loading data.
  const near = (i: number) => Math.abs(tab - i) <= 1;

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["customer", id],
    queryFn: () => getCustomer(customerId),
    enabled: !!id,
  });

  // Each tab is its own infinite query, gated to the active tab so
  // switching tabs doesn't eagerly fire all 5 requests up front — only the
  // one currently showing (and any already-visited tab, since React Query
  // caches by queryKey and `enabled` merely pauses future fetches, not the
  // cache itself).
  //
  // staleTime: with the default 0, react-query treats a query as stale the
  // instant it settles — so re-enabling it (tab A -> tab B -> back to tab
  // A) triggered a brand new network refetch EVERY time, each one flashing
  // the RefreshControl spinner even though the data was already sitting in
  // cache from moments ago. useRefetchOnFocus below already covers the
  // real "this went stale, get it again" case (leaving/re-entering the
  // whole screen); a tab switch within one visit shouldn't re-hit the
  // network at all. 30s is generous enough that a quick back-and-forth
  // between tabs never refetches, short enough that genuinely reopening
  // this screen later still gets fresh data.
  const loansQ = useInfiniteQuery({
    queryKey: ["loans", "customer", customerId],
    queryFn: ({ pageParam = 0 }) => listLoansPage({ customerId, limit: PAGE_SIZE, offset: pageParam }),
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) => (lastPage.hasMore ? allPages.length * PAGE_SIZE : undefined),
    enabled: !!id && near(0),
    staleTime: 30_000,
  });
  const ornamentsQ = useInfiniteQuery({
    queryKey: ["customerOrnaments", customerId],
    queryFn: ({ pageParam = 0 }) => listCustomerOrnamentsPage(customerId, PAGE_SIZE, pageParam),
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) => (lastPage.hasMore ? allPages.length * PAGE_SIZE : undefined),
    enabled: !!id && near(1),
    staleTime: 30_000,
  });
  const paymentsQ = useInfiniteQuery({
    queryKey: ["customerPayments", customerId],
    queryFn: ({ pageParam = 0 }) => listCustomerPaymentsPage(customerId, PAGE_SIZE, pageParam),
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) => (lastPage.hasMore ? allPages.length * PAGE_SIZE : undefined),
    enabled: !!id && near(2),
    staleTime: 30_000,
  });
  const bankPledgesQ = useInfiniteQuery({
    queryKey: ["customerBankPledges", customerId],
    queryFn: ({ pageParam = 0 }) => listCustomerBankPledgesPage(customerId, PAGE_SIZE, pageParam),
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) => (lastPage.hasMore ? allPages.length * PAGE_SIZE : undefined),
    enabled: !!id && near(3),
    staleTime: 30_000,
  });
  const auctionsQ = useInfiniteQuery({
    queryKey: ["customerAuctions", customerId],
    queryFn: ({ pageParam = 0 }) => listCustomerAuctionHistoryPage(customerId, PAGE_SIZE, pageParam),
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) => (lastPage.hasMore ? allPages.length * PAGE_SIZE : undefined),
    enabled: !!id && near(4),
    staleTime: 30_000,
  });

  const queries = [loansQ, ornamentsQ, paymentsQ, bankPledgesQ, auctionsQ];
  const activeQuery = queries[tab];

  // Same fix as Customers list's onPullToRefresh: useRefetchOnFocus below
  // calls the SAME refetch functions a pull gesture does, on every focus —
  // not just re-entering this screen but every tab switch back to it, if
  // it stays mounted. Tying the spinner to react-query's own
  // isFetching/isRefetching made it flash on that background refetch too.
  // Track an actual pull separately so the spinner only shows for one.
  const [manualRefreshing, setManualRefreshing] = useState(false);
  async function onPullToRefresh() {
    setManualRefreshing(true);
    try {
      await Promise.all([refetch(), activeQuery.refetch()]);
    } finally {
      setManualRefreshing(false);
    }
  }

  useRefetchOnFocus(refetch, () => activeQuery.refetch());

  // activeQuery is picked at runtime from a union of 5 differently-typed
  // useInfiniteQuery results (one per tab) — TS can't narrow which one
  // without a discriminant, so `.data.pages` collapses to an unhelpful
  // intersection. ExpandableTable below is given `any` columns per tab for
  // the same reason.
  const COLUMNS = [LOAN_COLS, ORNAMENT_COLS, PAYMENT_COLS, PLEDGE_COLS, AUCTION_COLS] as TableColumn<any>[][];
  const EXTRAS = [loanExtra, ornamentExtra, paymentExtra, pledgeExtra, auctionExtra] as ((row: any) => { label: string; value: React.ReactNode }[])[];

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

  // One vertical page: customer cards, then the table switcher (sticky once it
  // reaches the top), then a horizontal pager holding only the tables — so a
  // swipe or switcher tap changes the table, never the whole screen. The
  // pager's height follows the visible table (each page reports its own).
  const activeQ = activeQuery as any;
  function onPageScroll(e: NativeSyntheticEvent<NativeScrollEvent>) {
    const { layoutMeasurement, contentOffset, contentSize } = e.nativeEvent;
    if (layoutMeasurement.height + contentOffset.y >= contentSize.height - 300) {
      if (activeQ.hasNextPage && !activeQ.isFetchingNextPage) activeQ.fetchNextPage();
    }
  }

  return (
    <ScreenContainer style={{ padding: 0 }}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        stickyHeaderIndices={[1]}
        removeClippedSubviews={false}
        onScroll={onPageScroll}
        scrollEventThrottle={64}
        contentContainerStyle={{ paddingBottom: TAB_BAR_SPACE }}
        refreshControl={<RefreshControl refreshing={manualRefreshing} onRefresh={onPullToRefresh} />}
      >
        <View style={{ paddingHorizontal: 10, paddingTop: 20 }}>
          <Card>
            <ThemedText variant="h2" color={colors.brandDeep}>
              {data.name}
            </ThemedText>
            <ThemedText variant="body" style={{ marginTop: 8 }}>
              {data.code} · {data.phone}
            </ThemedText>
            {data.dob ? (
              <ThemedText variant="small" style={{ marginTop: 4 }} color={colors.muted}>
                DOB {new Date(data.dob).toLocaleDateString("en-IN")} · Age {ageFromDob(data.dob)}
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
        </View>

        {/* Sticky (stickyHeaderIndices) — page-coloured so rows slide under it,
            with a gradual fade just below so they fade out rather than cut off.
            collapsable={false} keeps it one stable native view, which stops
            Android's sticky header from jumping while scrolling. */}
        <View style={styles.stickyBar} collapsable={false}>
          <TableSwitcher index={tab} onGo={goToTab} />
          <View pointerEvents="none" style={styles.stickyFade}>
            <Svg width="100%" height="100%">
              <Defs>
                <LinearGradient id="stickyFade" x1="0" y1="0" x2="0" y2="1">
                  {STICKY_FADE_STOPS.map((s) => (
                    <Stop key={s} offset={s} stopColor={colors.bg} stopOpacity={1 - s} />
                  ))}
                </LinearGradient>
              </Defs>
              <Rect x="0" y="0" width="100%" height="100%" fill="url(#stickyFade)" />
            </Svg>
          </View>
        </View>

        <ScrollView
          ref={pagerRef}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          style={pageHeights[tab] ? { height: pageHeights[tab] } : undefined}
          // flex-start so each page keeps its own height instead of stretching to the tallest.
          contentContainerStyle={{ alignItems: "flex-start" }}
          onLayout={(e) => setPageWidth(e.nativeEvent.layout.width)}
          onMomentumScrollEnd={(e) => setTab(Math.round(e.nativeEvent.contentOffset.x / pageWidth))}
        >
          {TABS.map((name, i) => {
            const q = queries[i] as any;
            const items: any[] = q.data?.pages?.flatMap((p: any) => p.items) ?? [];
            return (
              <View
                key={name}
                style={{ width: pageWidth, paddingHorizontal: 10, paddingTop: 4 }}
                onLayout={(e) => {
                  const h = e.nativeEvent.layout.height;
                  setPageHeights((prev) => (prev[i] === h ? prev : Object.assign([...prev], { [i]: h })));
                }}
              >
                {items.length === 0 ? (
                  <ThemedText color={colors.muted} style={{ padding: 16 }}>
                    {q.isError ? "Could not load." : q.isLoading || !q.data ? "Loading…" : `No ${name.toLowerCase()} found.`}
                  </ThemedText>
                ) : (
                  items.map((item: any, idx: number) => (
                    <TableRow<any>
                      key={`${i}-${item.id}`}
                      row={item}
                      columns={COLUMNS[i]}
                      visibleCount={3}
                      extraFields={EXTRAS[i]}
                      onViewDescription={(r: any) => router.push(`/loans/${r.loanId ?? r.id}`)}
                      isFirst={idx === 0}
                      cardRows
                    />
                  ))
                )}
                {q.isFetchingNextPage ? (
                  <View style={{ paddingVertical: 16, alignItems: "center" }}>
                    <ActivityIndicator color={colors.brand} />
                  </View>
                ) : null}
              </View>
            );
          })}
        </ScrollView>
      </ScrollView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  stickyBar: { backgroundColor: colors.bg, paddingHorizontal: 10, paddingTop: 8, zIndex: 2 },
  // Hangs below the bar; rows scrolling up fade into it.
  stickyFade: { position: "absolute", left: 0, right: 0, bottom: -24, height: 24 },
  switcher: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.line,
    paddingVertical: 8,
    paddingHorizontal: 6,
    marginBottom: 12,
    shadowColor: colors.nav,
    shadowOpacity: 0.08,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 3,
  },
  switchBtn: { width: 36, height: 36, alignItems: "center", justifyContent: "center" },
  dots: { flexDirection: "row", gap: 6, marginTop: 4 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.line },
  dotActive: { width: 16, backgroundColor: colors.brandDeep },
});

