import React, { useEffect, useRef, useState } from "react";
import { RefreshControl, Pressable, View, ScrollView, StyleSheet } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { ScreenContainer } from "../../../src/components/ScreenContainer";
import { ThemedText } from "../../../src/components/ThemedText";
import { GoldTextInput } from "../../../src/components/GoldTextInput";
import { GoldButton } from "../../../src/components/GoldButton";
import { Pager } from "../../../src/components/Pager";
import { colors, statusColors } from "../../../src/theme/colors";
import { listLoansPage } from "../../../src/api/loans";
import { Loan } from "../../../src/types/loan";
import { useDebouncedValue } from "../../../src/hooks/useDebouncedValue";
import { useRefetchOnFocus } from "../../../src/hooks/useRefetchOnFocus";
import { useAuth } from "../../../src/auth/AuthContext";
import { fmt } from "../../../src/lib/format";
import { ExpandableTable, defaultVisibleCount, type TableColumn } from "../../../src/components/ExpandableTable";

const PAGE_SIZE = 10;

// Status categories offered as a filter chip row — mirrors
// frontend/modules/loans/components/Loans.tsx's CATS, minus "Defaulted"
// (that one is a client-computed refinement of Overdue on the web side;
// filtering server-side by loan.status directly, as this screen does,
// doesn't have that distinction). "All" sends no status param at all.
const STATUS_FILTERS = ["All", "Active", "Due Soon", "Overdue", "Pending Approval", "Auction Eligible", "Closed"] as const;

function toneForStatus(status: string): "green" | "red" | "amber" | "blue" | "muted" {
  const s = status.toLowerCase();
  if (s.includes("approved") || s.includes("closed")) return "green";
  if (s.includes("reject") || s.includes("default")) return "red";
  if (s.includes("pending")) return "amber";
  return "blue";
}

function StatusPill({ status }: { status: string }) {
  const tone = statusColors(toneForStatus(status));
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

// 4 columns + 3 detail-only fields (Principal/Opened/Due) = 7 total fields
// — over the defaultVisibleCount threshold, so this reads as a "large"
// table and collapses to 3 visible columns (Outstanding folds into the
// expand strip alongside the rest), matching the approved design.
const LOAN_COLUMNS: TableColumn<Loan>[] = [
  { key: "loanNumber", label: "Loan No", render: (l) => l.loanNumber, weight: 1.1 },
  { key: "customer", label: "Customer", render: (l) => l.customer?.name ?? `#${l.customerId}`, weight: 1.3 },
  { key: "status", label: "Status", render: (l) => <StatusPill status={l.status} /> },
  { key: "outstanding", label: "Outstanding", render: (l) => fmt(l.outstandingAmount) },
];
const LOAN_VISIBLE_COUNT = defaultVisibleCount(LOAN_COLUMNS.length + 3);

function loanExtraFields(l: Loan) {
  return [
    { label: "Principal", value: fmt(l.principalAmount) },
    { label: "Opened", value: new Date(l.openedDate).toLocaleDateString("en-IN") },
    { label: "Due", value: new Date(l.dueDate).toLocaleDateString("en-IN") },
  ];
}

export default function LoansScreen() {
  const router = useRouter();
  const { can } = useAuth();
  // Mirrors new-loan.tsx's own gate — same permission, so a role that
  // can't reach New Loan from here couldn't submit it anyway.
  const canCreateLoan = can("Loan_Management", "can_create_loan");
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search);
  const [statusFilter, setStatusFilter] = useState<(typeof STATUS_FILTERS)[number]>("All");
  const [page, setPage] = useState(1); // 1-based, matches Pager
  const filterScrollRef = useRef<ScrollView>(null);

  // A new search/filter always starts back at page 1 — otherwise you could
  // land on "page 3" of a filter that only has one page of results.
  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, statusFilter]);

  const { data, isLoading, isError, isFetching, refetch } = useQuery({
    queryKey: ["loans", debouncedSearch, statusFilter, page],
    // Each page is its own, separate API call — Prev/Next just changes
    // `offset`, never slices an already-fetched larger list.
    queryFn: () =>
      listLoansPage({
        q: debouncedSearch || undefined,
        status: statusFilter === "All" ? undefined : statusFilter,
        limit: PAGE_SIZE,
        offset: (page - 1) * PAGE_SIZE,
      }),
  });

  useRefetchOnFocus(refetch);

  const loans = data?.items ?? [];

  return (
    <ScreenContainer style={{ padding: 0 }}>
      <View style={{ flex: 1, paddingHorizontal: 16, paddingTop: 0 }}>
      {canCreateLoan ? (
        <View style={{ marginBottom: 12 }}>
          <GoldButton title="+ New Loan" onPress={() => router.push("/new-loan")} />
        </View>
      ) : null}
      <GoldTextInput
        label="Search loans"
        placeholder="Loan number or customer…"
        value={search}
        onChangeText={setSearch}
        blur
      />
      <ScrollView
        ref={filterScrollRef}
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.filterRow}
        contentContainerStyle={styles.filterRowContent}
      >
        {STATUS_FILTERS.map((s) => {
          const active = s === statusFilter;
          return (
            <Pressable
              key={s}
              onPress={() => {
                setStatusFilter(s);
                // "All" is always the leftmost chip — if you'd scrolled
                // right to reach a later filter and then tap back to All,
                // the row stayed at that scroll position, so the
                // now-selected All chip sat clipped at the left edge of
                // the visible viewport instead of coming back into view.
                // Every other chip you can tap is, by definition, already
                // fully on-screen at the moment you tap it, so only All
                // needs this.
                if (s === "All") filterScrollRef.current?.scrollTo({ x: 0, animated: true });
              }}
              style={[styles.filterChip, active && styles.filterChipActive]}
            >
              <ThemedText variant="small" numberOfLines={1} color={active ? colors.ivory : colors.ink}>
                {s}
              </ThemedText>
            </Pressable>
          );
        })}
      </ScrollView>
      <ScrollView
        showsVerticalScrollIndicator={false}
        // The table card sat flush against this ScrollView's own edges —
        // ScrollView always clips its content to its own bounds (that's how
        // scrolling works), so the card's shadow blur had nowhere to render
        // and got cut off on every side but the bottom. A few px of
        // contentContainerStyle padding gives the blur room without moving
        // or resizing the card itself.
        contentContainerStyle={{ padding: 6 }}
        refreshControl={<RefreshControl refreshing={isFetching && !isLoading} onRefresh={refetch} />}
      >
        <ExpandableTable<Loan>
          columns={LOAN_COLUMNS}
          visibleCount={LOAN_VISIBLE_COUNT}
          data={loans}
          keyExtractor={(l) => String(l.id)}
          extraFields={loanExtraFields}
          onViewDescription={(l) => router.push(`/loans/${l.id}`)}
          emptyText={isLoading ? "Loading…" : isError ? "Could not load loans." : "No loans found."}
        />
        <Pager page={page} hasMore={!!data?.hasMore} onChange={setPage} loading={isFetching} />
      </ScrollView>
      </View>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  // marginTop/marginBottom (not padding) previously sat directly on the
  // ScrollView itself — a horizontal ScrollView's OWN vertical margin can
  // get eaten by its parent's layout pass before it ever measures its
  // content, which was clipping the chip row's top/bottom edge (and,
  // combined with no vertical padding on the content, the chips' own
  // shadow-free borders too). Padding lives on contentContainerStyle
  // instead, inside the scrollable area, so it can never be clipped.
  // height is pinned explicitly (not left to intrinsic content sizing) so
  // Android can't re-measure this row to a squashed height/width mid-scroll
  // of the vertical ScrollView below it — that remeasure-on-scroll is what
  // was making "All" (the widest/leftmost chip, so the most visible one)
  // visibly shrink while the table scrolled.
  filterRow: { marginTop: 10, marginBottom: 12, flexGrow: 0, height: 40 },
  filterRowContent: { gap: 8, paddingVertical: 3, paddingRight: 4, alignItems: "center" },
  // height + justifyContent (not just paddingVertical) pin every chip to
  // the identical box regardless of which is active — active vs inactive
  // used to differ only by fill color, but without a fixed height each
  // chip's box was sized off its own text's line height, so re-selecting a
  // filter (which reflows the whole row) could nudge that by a px and read
  // as the chip visibly "growing".
  filterChip: {
    flexShrink: 0,
    height: 32,
    justifyContent: "center",
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.card,
    borderRadius: 16,
    paddingHorizontal: 12,
  },
  filterChipActive: { backgroundColor: colors.goldDeep, borderColor: colors.goldDeep },
});
