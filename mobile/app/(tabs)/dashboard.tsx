import React, { useMemo, useState } from "react";
import { View } from "react-native";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import {
  AccBtn,
  AccRow,
  ActItem,
  AsyncSelect,
  Buffering,
  C,
  Card,
  EmptyText,
  Field,
  FieldRow,
  FilterChipRow,
  HeroHeader,
  Input,
  PScroll,
  QuickAction,
  ResultBox,
  Screen,
  SearchInput,
  SectionTitle,
  Sheet,
  Sparkline,
  SummaryCard,
  ThemeDropdown,
  Txt,
  initialsOf,
  useShell,
} from "../../src/components/ui";
import { useAuth } from "../../src/auth/AuthContext";
import { useRefetchOnFocus } from "../../src/hooks/useRefetchOnFocus";
import { useDebouncedValue } from "../../src/hooks/useDebouncedValue";
import {
  getDashboardSummary,
  listDashboardActivityPage,
  listNeedsAttentionPage,
  NEEDS_ATTENTION_PAGE_SIZE,
  type NeedsAttentionItem,
  type NeedsAttentionKind,
} from "../../src/api/dashboard";
import { latestGoldRate } from "../../src/api/goldRates";
import { listSchemes } from "../../src/api/schemes";
import { listLoansPage } from "../../src/api/loans";
import { listCalendarEventsPage } from "../../src/api/reminders";
import { rateForKarat } from "../../src/lib/purity";
import { dmy, inr, inrShort, todayISO } from "../../src/lib/format";
import type { Scheme } from "../../src/types/scheme";
import type { Loan } from "../../src/types/loan";

// Dashboard — prototype #header-dashboard + #page-dashboard. Every figure
// comes from server-computed endpoints (GET /dashboard/summary, paged
// /dashboard/activity and /dashboard/needs-attention); nothing is counted on
// the phone.
type Seg = "Overview" | "Activity";
const ATTENTION_TABS = ["approvals", "requests", "auctions"] as const;

export default function DashboardScreen() {
  const router = useRouter();
  const { employee, can } = useAuth();
  const shell = useShell();
  const [seg, setSeg] = useState<Seg>("Overview");
  const [collectOpen, setCollectOpen] = useState(false);

  const summary = useQuery({ queryKey: ["dashboard", "summary"], queryFn: getDashboardSummary });
  const rate = useQuery({ queryKey: ["gold-rates", "latest"], queryFn: latestGoldRate });
  const todayReminders = useQuery({
    queryKey: ["reminders", "today-count"],
    queryFn: () => listCalendarEventsPage({ limit: 1, offset: 0, from: todayISO(), to: todayISO() }),
  });
  useRefetchOnFocus(summary.refetch, rate.refetch, todayReminders.refetch);

  const s = summary.data;
  const r22 = s?.rate22k ?? rate.data?.k22 ?? 0;
  const r24 = s?.rate24k ?? rate.data?.k24 ?? 0;
  const change = s?.rateChangePct;
  const changeLabel = change == null ? undefined : `${change >= 0 ? "▲" : "▼"} ${Math.abs(change).toFixed(1)}%`;

  return (
    <Screen
      headerFade={false}
      header={
        <HeroHeader
          initials={initialsOf(employee?.name)}
          name={employee?.name ?? ""}
          branch={employee?.branch?.name ? `${employee.branch.name} Branch` : employee?.role}
          cashValue={summary.isLoading ? "…" : inr(s?.cashInHand ?? 0)}
          rates={[
            { k: "22K / gram", v: inr(Math.round(r22)) },
            { k: "24K / gram", v: inr(Math.round(r24)) },
          ]}
          rateChange={changeLabel}
          onRatePress={shell.openGoldRate}
          onSearch={shell.openSearch}
          onBell={shell.openReminders}
          bellDot={(todayReminders.data?.total ?? 0) > 0}
          onAvatar={shell.openProfile}
          segments={["Overview", "Activity"]}
          activeSegment={seg}
          onSegment={(v) => setSeg(v as Seg)}
        />
      }
    >
      <PScroll refreshing={summary.isRefetching} onRefresh={() => { summary.refetch(); rate.refetch(); }}>
        {seg === "Overview" ? (
          <>
            <View style={{ paddingHorizontal: 18 }}>
              <SectionTitle flush style={{ marginTop: 16, marginBottom: 12 }}>
                Quick actions
              </SectionTitle>
            </View>
            <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 6, paddingHorizontal: 18 }}>
              {can("Loan_Management", "can_create_loan") ? <QuickAction icon="plus" label={"Create\nLoan"} tone="loan" onPress={shell.openNewLoan} /> : null}
              {can("Customer_Management", "can_create_customer") ? (
                <QuickAction icon="user" label={"Register\nCustomer"} tone="cust" onPress={() => router.push("/customers?register=1" as never)} />
              ) : null}
              <QuickAction icon="card" label={"Collect\nPayment"} tone="pay" onPress={() => setCollectOpen(true)} />
            </View>

            <SectionTitle>Today</SectionTitle>
            {summary.isLoading ? (
              <Card>
                <Buffering />
              </Card>
            ) : (
              <SummaryCard
                title="Today's summary"
                onPress={can("Report_Management", "can_view_report") ? () => router.push("/reports" as never) : undefined}
                stats={[
                  { n: String(s?.today.loansIssued ?? 0), l: "Loans issued" },
                  { n: inrShort(s?.today.collections ?? 0), l: "Collections" },
                  { n: String(s?.today.newCustomers ?? 0), l: "New customers" },
                ]}
              />
            )}

            <NeedsAttention />

            <SectionTitle>Cash flow · 7 days</SectionTitle>
            <Card>{summary.isLoading ? <Buffering /> : <Sparkline data={(s?.cashFlow7d ?? []).map((d) => d.net)} />}</Card>

            <SectionTitle>Gold loan calculator</SectionTitle>
            <Calculator k24={rate.data?.k24 ?? r24} />
          </>
        ) : (
          <ActivityFeed />
        )}
      </PScroll>
      <CollectPaymentPicker visible={collectOpen} onClose={() => setCollectOpen(false)} />
    </Screen>
  );
}

// ---- Approvals & review lists (kept from the old dashboard, restyled) -----
function NeedsAttention() {
  const router = useRouter();
  const [kind, setKind] = useState<NeedsAttentionKind>("approvals");
  const [search, setSearch] = useState("");
  const q = useDebouncedValue(search.trim());
  const query = useInfiniteQuery({
    queryKey: ["dashboard", "needs-attention", kind, q],
    initialPageParam: 0,
    queryFn: ({ pageParam }) => listNeedsAttentionPage({ offset: pageParam, limit: NEEDS_ATTENTION_PAGE_SIZE, q: q || undefined, kind }),
    getNextPageParam: (last, all) => (last.hasMore ? all.length * NEEDS_ATTENTION_PAGE_SIZE : undefined),
  });
  useRefetchOnFocus(query.refetch);
  const first = query.data?.pages[0];
  const items = useMemo(() => query.data?.pages.flatMap((p) => p.items ?? []) ?? [], [query.data]);
  const labels = {
    approvals: `Approvals${first ? ` · ${first.approvalsCount}` : ""}`,
    requests: `Requests${first ? ` · ${first.requestsCount}` : ""}`,
    auctions: `Auctions${first ? ` · ${first.auctionsCount}` : ""}`,
  };

  const open = (it: NeedsAttentionItem) => {
    if (it.kind === "request") router.push(`/requests?requestId=${it.requestId}` as never);
    else if (it.loanId) router.push(`/loans/${it.loanId}` as never);
  };

  return (
    <>
      <SectionTitle>Needs attention</SectionTitle>
      <View style={{ paddingHorizontal: 18 }}>
        <FilterChipRow options={ATTENTION_TABS} value={kind} onChange={setKind} labels={labels} />
      </View>
      <SearchInput value={search} onChangeText={setSearch} placeholder="Search by loan number, customer name or ID" />
      <View style={{ paddingHorizontal: 18 }}>
        {query.isLoading || (query.isFetching && !query.isFetchingNextPage && items.length === 0) ? (
          <Buffering block />
        ) : items.length === 0 ? (
          <EmptyText>{q ? "Nothing matches your search." : "Nothing needs attention right now."}</EmptyText>
        ) : (
          items.map((it, i) => (
            <AccRow
              key={`${it.kind}-${it.requestId ?? it.loanId}-${i}`}
              id={it.loanNumber}
              name={it.customerName ?? "—"}
              sub={
                it.kind === "approval"
                  ? `Awaiting ${it.approvalStage || "approval"}`
                  : it.kind === "request"
                    ? `${it.requestType ?? "Request"}${it.detail ? ` · ${it.detail}` : ""}`
                    : it.status ?? "Auction case"
              }
              amount={it.kind === "approval" ? inr(it.principal) : it.kind === "auction" ? inr(it.outstanding) : undefined}
              status={it.kind === "approval" ? "Pending" : it.kind === "request" ? "Pending" : it.status ?? "Overdue"}
              details={
                it.kind === "approval"
                  ? [
                      { k: "Stage", v: it.approvalStage || "—" },
                      { k: "Principal", v: inr(it.principal) },
                    ]
                  : it.kind === "request"
                    ? [
                        { k: "Type", v: it.requestType ?? "—" },
                        { k: "Detail", v: it.detail || "—" },
                      ]
                    : [
                        { k: "Status", v: it.status ?? "—" },
                        { k: "Outstanding", v: inr(it.outstanding), color: C.red },
                      ]
              }
              actions={[{ label: it.kind === "auction" ? "View Loan" : "Review", primary: true, onPress: () => open(it) }]}
            />
          ))
        )}
        {query.isFetchingNextPage ? <Buffering /> : query.hasNextPage ? <AccBtn label="Load more" onPress={() => query.fetchNextPage()} style={{ marginBottom: 4 }} /> : null}
      </View>
    </>
  );
}

// ---- Activity tab ----------------------------------------------------------
function ActivityFeed() {
  const router = useRouter();
  const query = useInfiniteQuery({
    queryKey: ["dashboard", "activity"],
    initialPageParam: 0,
    queryFn: ({ pageParam }) => listDashboardActivityPage({ limit: 10, offset: pageParam }),
    getNextPageParam: (last, all) => (last.hasMore ? all.length * 10 : undefined),
  });
  useRefetchOnFocus(query.refetch);
  const items = useMemo(() => query.data?.pages.flatMap((p) => p.items ?? []) ?? [], [query.data]);
  return (
    <>
      <SectionTitle style={{ marginTop: 16 }}>Recent activity</SectionTitle>
      <Card>
        {query.isLoading ? (
          <Buffering />
        ) : items.length === 0 ? (
          <EmptyText>No activity yet.</EmptyText>
        ) : (
          items.map((a, i) => {
            const type = a.type.toLowerCase();
            const color = type.includes("payment") ? C.green : type.includes("overdue") ? C.red : undefined;
            return (
              <ActItem
                key={`${a.type}-${a.loanId}-${a.date}-${i}`}
                first={i === 0}
                title={a.customerName}
                sub={[a.loanNumber, a.label, dmy(a.date)].filter(Boolean).join(" · ")}
                amount={`${type.includes("payment") ? "+" : ""}${inr(a.amount)}`}
                amountColor={color}
                onPress={a.loanId ? () => router.push(`/loans/${a.loanId}` as never) : undefined}
              />
            );
          })
        )}
        {query.isFetchingNextPage ? <Buffering /> : query.hasNextPage ? <AccBtn label="Load more" onPress={() => query.fetchNextPage()} style={{ marginTop: 8 }} /> : null}
      </Card>
    </>
  );
}

// ---- Gold loan calculator --------------------------------------------------
const PURITIES = [
  { k: 22, label: "22 Karat" },
  { k: 18, label: "18 Karat" },
  { k: 24, label: "24 Karat" },
];

function Calculator({ k24 }: { k24: number }) {
  const [weight, setWeight] = useState("");
  const [karat, setKarat] = useState(PURITIES[0]);
  const [scheme, setScheme] = useState<Scheme | null>(null);
  const schemes = useQuery({ queryKey: ["schemes", "active-picker"], queryFn: () => listSchemes() });
  const active = (schemes.data ?? []).filter((sc) => sc.isActive !== false);
  const sc = scheme ?? active[0] ?? null;
  const rate = k24 ? rateForKarat(k24, karat.k) : 0;
  const amount = Math.round(((Number(weight) || 0) * rate * (sc?.ltvPercent ?? 0)) / 100 / 10) * 10;
  return (
    <Card>
      <Field label="Gold weight (grams)">
        <Input keyboardType="decimal-pad" placeholder="18.5" value={weight} onChangeText={setWeight} />
      </Field>
      <FieldRow>
        <Field label="Purity">
          <ThemeDropdown value={karat} options={PURITIES} onChange={setKarat} labelOf={(p) => p.label} keyOf={(p) => p.k} />
        </Field>
        <Field label="Scheme">
          <ThemeDropdown<Scheme> value={sc} options={active} onChange={setScheme} labelOf={(x) => x.name} keyOf={(x) => x.id} placeholder="Scheme" />
        </Field>
      </FieldRow>
      <ResultBox k="Eligible loan amount" v={inr(amount)} style={{ marginBottom: 0 }} />
      {sc ? <Txt style={{ fontSize: 11, color: C.muted, marginTop: 8 }}>At {inr(Math.round(rate))}/g · LTV {sc.ltvPercent}%</Txt> : null}
    </Card>
  );
}

// ---- Collect Payment quick action: pick a loan, then its Collect sheet ----
function CollectPaymentPicker({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const router = useRouter();
  return (
    <Sheet visible={visible} onClose={onClose} title="Collect Payment" maxHeightPct={70}>
      <AsyncSelect<Loan>
        label="Loan"
        placeholder="Search by loan number, customer name or ID"
        queryKey={["loans", "collect-picker"]}
        fetcher={async (q) => (await listLoansPage({ q: q || undefined, status: "Active", limit: 20, offset: 0 })).items ?? []}
        onSelect={(l) => {
          onClose();
          router.push(`/loans/${l.id}?action=collect` as never);
        }}
        keyOf={(l) => l.id}
        renderItem={(l) => ({ title: `${l.loanNumber} · ${l.customer?.name ?? ""}`, sub: `Outstanding ${inr(l.outstandingAmount)}` })}
      />
    </Sheet>
  );
}
