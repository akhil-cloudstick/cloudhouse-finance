import React, { useState } from "react";
import { RefreshControl, View } from "react-native";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { ScreenContainer } from "../../../src/components/ScreenContainer";
import { ThemedText } from "../../../src/components/ThemedText";
import { ChipSelect } from "../../../src/components/ChipSelect";
import { colors, statusColors, StatusTone } from "../../../src/theme/colors";
import { listLoansPage } from "../../../src/api/loans";
import { listConcludedAuctions } from "../../../src/api/auctions";
import { Loan } from "../../../src/types/loan";
import { AUCTION_OUTCOME_LABELS, ConcludedAuctionRow } from "../../../src/types/auction";
import { fmt } from "../../../src/lib/format";
import { useRefetchOnFocus } from "../../../src/hooks/useRefetchOnFocus";
import { ExpandableTable, type TableColumn } from "../../../src/components/ExpandableTable";

const PAGE_SIZE = 10;

// There's no dedicated "auctions" list endpoint for the Active tab —
// eligible/defaulted loans come from the Loans module. The actual auction
// actions (eligible → notice → schedule → sale → settle) live on the loan's
// own detail screen (/loans/[id]) since every action is per-loan, not a
// separate resource.
//
// "Defaulted" is NOT filterable server-side: it's a read-time derived flag
// (Loan.isDefaulted, backend/internal/loan/model.go's IsDefaulted —
// gorm:"-"), never a value the persisted `status` column holds. Asking the
// backend for status=Defaulted silently returns zero rows every time —
// that's why this screen used to show no auctions at all. Instead we fetch
// the loans once and bucket client-side by isDefaulted vs. the real
// "Auction Eligible" status.
// "Auctioned - Balance Due" surfaces loans whose sale left a shortfall
// still frozen on a management decision (see [id].tsx's escalation banner)
// — previously invisible on this screen entirely; staff could only reach
// one by already knowing its loan number. A loan merely awaiting its
// surplus to be settled (plain "Auctioned", sale fully covered the debt)
// still isn't listed here — telling "surplus still open" apart from
// "already settled" needs each loan's own auction record, which this list
// doesn't fetch (see [id].tsx, which does and gets it right per-loan).
const FILTERS = ["Auction Eligible", "Defaulted", "Auctioned - Balance Due"] as const;

// Mirrors frontend/components/Auctions.tsx's Active Cases / Auction History
// split — the mobile screen used to be Active-only. History reuses the same
// paginated {items, hasMore} endpoint (handler.go's ListConcludedAuctions)
// the web app's two tables page independently.
const TOP_TABS = ["Active Cases", "Auction History"] as const;
const HISTORY_TABLES = ["Auctions Conducted", "Closed Without Auction"] as const;

export default function AuctionsScreen() {
  const [topTab, setTopTab] = useState<(typeof TOP_TABS)[number]>("Active Cases");

  return (
    <ScreenContainer style={{ paddingHorizontal: 0 }}>
      <View style={{ paddingHorizontal: 16, paddingTop: 20 }}>
        <ChipSelect options={TOP_TABS} value={topTab} onChange={setTopTab} />
      </View>
      {topTab === "Active Cases" ? <ActiveCases /> : <AuctionHistory />}
    </ScreenContainer>
  );
}

function LoanStatusPill({ status }: { status: string }) {
  const s = status.toLowerCase();
  const tone: StatusTone = s.includes("default") ? "red" : s.includes("balance due") ? "amber" : "blue";
  const t = statusColors(tone);
  return (
    <ThemedText
      variant="label"
      numberOfLines={1}
      style={{ backgroundColor: t.bg, color: t.fg, paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6, alignSelf: "flex-start", fontSize: 11.5 }}
    >
      {status}
    </ThemedText>
  );
}

// 4 columns + 2 detail-only fields (Gold weight/Days overdue) = 6 total —
// right at the defaultVisibleCount threshold (which trims only past 6), so
// all 4 stay visible here.
const ACTIVE_COLUMNS: TableColumn<Loan>[] = [
  { key: "loanNumber", label: "Loan No", render: (l) => l.loanNumber, weight: 1.1 },
  { key: "customer", label: "Customer", render: (l) => l.customer?.name ?? `#${l.customerId}`, weight: 1.3 },
  { key: "status", label: "Status", render: (l) => <LoanStatusPill status={l.status} /> },
  { key: "outstanding", label: "Outstanding", render: (l) => fmt(l.totalOutstandingBalance ?? l.outstandingAmount) },
];
function activeExtraFields(l: Loan) {
  return [
    { label: "Gold Weight", value: l.totalNetWeight != null ? `${l.totalNetWeight.toFixed(2)} g` : "—" },
    { label: "Days Overdue", value: l.daysOverdue ? String(l.daysOverdue) : "—" },
  ];
}

function ActiveCases() {
  const router = useRouter();
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("Auction Eligible");
  // "Auction Eligible"/"Auctioned - Balance Due" are real stored status
  // values, so the backend can filter+paginate them directly. "Defaulted"
  // has no such column (see the top-of-file comment) — for that one this
  // still fetches a real, separate 10-row page per Next tap, just filtered
  // client-side after it arrives, so a page can come back holding fewer
  // than 10 matching rows even though a full page was actually fetched.
  const isDefaultedFilter = filter === "Defaulted";

  const { data, isLoading, isError, isFetching, isFetchingNextPage, fetchNextPage, hasNextPage, refetch } = useInfiniteQuery({
    queryKey: ["loans", "auctions", filter],
    queryFn: ({ pageParam = 0 }) =>
      listLoansPage({
        status: isDefaultedFilter ? undefined : filter,
        limit: PAGE_SIZE,
        offset: pageParam,
      }),
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) => (lastPage.hasMore ? allPages.length * PAGE_SIZE : undefined),
  });

  useRefetchOnFocus(refetch);

  const allLoans = data?.pages.flatMap((p) => p.items) ?? [];
  const filtered = isDefaultedFilter ? allLoans.filter((l) => !!l.isDefaulted) : allLoans;

  // Pushing straight to `/loans/[id]` from outside the Loans tab leaves that
  // tab's Stack with the detail screen as its ONLY entry — see the matching
  // comment in dashboard.tsx. Pushing the list first builds the history
  // explicitly so back/the Loans tab land on the list, not stuck on detail.
  function openLoan(id: string | number) {
    router.push("/loans");
    router.push(`/loans/${id}`);
  }

  return (
    <>
      <View style={{ paddingHorizontal: 16 }}>
        <ChipSelect options={FILTERS} value={filter} onChange={setFilter} label="Filter" />
      </View>
      <View style={{ flex: 1, paddingHorizontal: 16 }}>
        <ExpandableTable<Loan>
          columns={ACTIVE_COLUMNS}
          visibleCount={ACTIVE_COLUMNS.length}
          data={filtered}
          keyExtractor={(l) => String(l.id)}
          extraFields={activeExtraFields}
          onViewDescription={(l) => openLoan(l.id)}
          emptyText={isLoading ? "Loading…" : isError ? "Could not load loans." : "No loans found for this filter."}
          refreshControl={<RefreshControl refreshing={isFetching && !isFetchingNextPage && !isLoading} onRefresh={refetch} />}
          onEndReached={() => {
            if (hasNextPage && !isFetchingNextPage) fetchNextPage();
          }}
          isFetchingNextPage={isFetchingNextPage}
        />
      </View>
    </>
  );
}

const HISTORY_COLUMNS: TableColumn<ConcludedAuctionRow>[] = [
  { key: "loan", label: "Loan", render: (r) => r.loanNumber },
  { key: "outcome", label: "Outcome", render: (r) => (r.stage === "Withdrawn" ? "Withdrawn" : AUCTION_OUTCOME_LABELS[r.finalSettlementStatus ?? "Pending"]), weight: 1.3 },
  { key: "sale", label: "Sale", render: (r) => (r.saleAmount ? fmt(r.saleAmount) : "—") },
  {
    key: "surplus",
    label: "Surplus/Short",
    render: (r) =>
      r.saleAmount ? (
        <ThemedText variant="small" color={(r.surplusShortfall ?? 0) < 0 ? colors.red : colors.green}>
          {fmt(r.surplusShortfall ?? 0)}
        </ThemedText>
      ) : (
        "—"
      ),
  },
];
function historyExtraFields(r: ConcludedAuctionRow) {
  return [
    { label: "Customer", value: r.customerName },
    { label: "Stage", value: r.stage },
  ];
}

function AuctionHistory() {
  const router = useRouter();
  const [table, setTable] = useState<(typeof HISTORY_TABLES)[number]>("Auctions Conducted");
  const hasSale = table === "Auctions Conducted";

  // Same rationale as ActiveCases' openLoan below — [id].tsx's route param
  // is the loan's numeric id (it calls getLoan(Number(id))), not its
  // human-readable loanNumber, so this pushes `item.loanId`, not
  // `item.loanNumber` (which is only for display).
  function openLoan(loanId: number) {
    router.push("/loans");
    router.push(`/loans/${loanId}`);
  }

  const { data, isLoading, isError, isFetching, isFetchingNextPage, fetchNextPage, hasNextPage, refetch } = useInfiniteQuery({
    queryKey: ["auctionHistory", hasSale],
    queryFn: ({ pageParam = 0 }) => listConcludedAuctions({ hasSale, limit: PAGE_SIZE, offset: pageParam }),
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) => (lastPage.hasMore ? allPages.length * PAGE_SIZE : undefined),
  });

  useRefetchOnFocus(refetch);

  const records = data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <>
      <View style={{ paddingHorizontal: 16 }}>
        <ChipSelect options={HISTORY_TABLES} value={table} onChange={setTable} label="Table" />
      </View>
      <View style={{ flex: 1, paddingHorizontal: 16 }}>
        <ExpandableTable<ConcludedAuctionRow>
          columns={HISTORY_COLUMNS}
          visibleCount={HISTORY_COLUMNS.length}
          data={records}
          keyExtractor={(r) => String(r.id)}
          extraFields={historyExtraFields}
          onViewDescription={(r) => openLoan(r.loanId)}
          emptyText={isLoading ? "Loading…" : isError ? "Could not load auction history." : "No concluded auctions."}
          refreshControl={<RefreshControl refreshing={isFetching && !isFetchingNextPage && !isLoading} onRefresh={refetch} />}
          onEndReached={() => {
            if (hasNextPage && !isFetchingNextPage) fetchNextPage();
          }}
          isFetchingNextPage={isFetchingNextPage}
        />
      </View>
    </>
  );
}
