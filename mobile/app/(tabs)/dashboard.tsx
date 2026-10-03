import React, { useMemo, useState } from "react";
import { View } from "react-native";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import {
  AccBtn,
  AccGroup,
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
  SectionTitle,
  Sheet,
  Sparkline,
  SummaryCard,
  ThemeDropdown,
  Txt,
  initialsOf,
  useShell,
  openPage,
} from "../../src/components/ui";
import { useAuth } from "../../src/auth/AuthContext";
import { useCanOpen } from "../../src/config/routePermissions";
import { useRefetchOnFocus } from "../../src/hooks/useRefetchOnFocus";
import {
  getDashboardSummary,
  listDashboardActivityPage,
  listNeedsAttentionPage,
  NEEDS_ATTENTION_PAGE_SIZE,
  type NeedsAttentionItem,
  type NeedsAttentionKind,
} from "../../src/api/dashboard";
import { latestGoldRate } from "../../src/api/goldRates";
import { stageByPending, useApprovalWorkflow } from "../../src/api/approvalWorkflow";
import { listActiveSchemes } from "../../src/api/schemes";
import { listLoansPage } from "../../src/api/loans";
import { listCalendarEventsPage } from "../../src/api/reminders";
import { listPurityStandards } from "../../src/api/purityStandards";
import { rateForFineness, rateForKarat } from "../../src/lib/purity";
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
  const { employee, can } = useAuth();
  const shell = useShell();
  const [seg, setSeg] = useState<Seg>("Overview");
  const [collectOpen, setCollectOpen] = useState(false);

  const summary = useQuery({ queryKey: ["dashboard", "summary"], queryFn: getDashboardSummary });
  const rate = useQuery({ queryKey: ["gold-rates", "latest"], queryFn: latestGoldRate });
  const canViewReminders = can("Reminder_Management", "can_view_reminder_module");
  const todayReminders = useQuery({
    queryKey: ["reminders", "today-count"],
    queryFn: () => listCalendarEventsPage({ limit: 1, offset: 0, from: todayISO(), to: todayISO() }),
    enabled: canViewReminders,
  });
  useRefetchOnFocus(summary.refetch, rate.refetch, todayReminders.refetch);

  const s = summary.data;
  const r22 = s?.rate22k ?? rate.data?.k22 ?? 0;
  const r24 = s?.rate24k ?? rate.data?.k24 ?? 0;
  const r18 = rate.data?.k18 || (r24 ? rateForKarat(r24, 18) : 0);
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
            { k: "24K / g", v: inr(Math.round(r24)) },
            { k: "22K / g", v: inr(Math.round(r22)) },
            { k: "18K / g", v: inr(Math.round(r18)) },
          ]}
          rateChange={changeLabel}
          onRatePress={can("Gold_Rate_Management", "can_view_gold_rate_module") ? shell.openGoldRate : undefined}
          onSearch={shell.openSearch}
          onBell={canViewReminders ? shell.openReminders : undefined}
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
                <QuickAction icon="user" label={"Register\nCustomer"} tone="cust" onPress={() => openPage("/customers?register=1")} />
              ) : null}
              {can("Loan_Management", "can_update_loan") ? (
                <QuickAction icon="card" label={"Collect\nPayment"} tone="pay" onPress={() => setCollectOpen(true)} />
              ) : null}
            </View>

            <SectionTitle>Today</SectionTitle>
            {summary.isLoading ? (
              <Card>
                <Buffering />
              </Card>
            ) : (
              <SummaryCard
                title="Today's summary"
                onPress={can("Report_Management", "can_view_report_module") ? () => openPage("/reports") : undefined}
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
  const [kind, setKind] = useState<NeedsAttentionKind>("approvals");
  const query = useInfiniteQuery({
    queryKey: ["dashboard", "needs-attention", kind],
    initialPageParam: 0,
    queryFn: ({ pageParam }) => listNeedsAttentionPage({ offset: pageParam, limit: NEEDS_ATTENTION_PAGE_SIZE, kind }),
    getNextPageParam: (last, all) => (last.hasMore ? all.length * NEEDS_ATTENTION_PAGE_SIZE : undefined),
  });
  useRefetchOnFocus(query.refetch);
  const first = query.data?.pages[0];
  const items = useMemo(() => query.data?.pages.flatMap((p) => p.items ?? []) ?? [], [query.data]);
  const wf = useApprovalWorkflow();
  // Approval items carry their workflow flow (gold loan sanction by default)
  // and the raw pending value — shown as the configured stage label.
  const flowOf = (it: NeedsAttentionItem) => it.flow || "loan_sanction";
  const stageLabel = (it: NeedsAttentionItem) =>
    stageByPending(wf, flowOf(it), it.approvalStage === "AuthorizedManagement" ? "FinalSanction" : it.approvalStage)?.label ?? it.approvalStage;
  const FLOW_NAMES: Record<string, string> = { loan_sanction: "Gold loan", loan_topup: "Top-up", personal_loan: "Personal loan", expense: "Expense" };
  const labels = {
    approvals: `Approvals${first ? ` · ${first.approvalsCount}` : ""}`,
    requests: `Requests${first ? ` · ${first.requestsCount}` : ""}`,
    auctions: `Auctions${first ? ` · ${first.auctionsCount}` : ""}`,
  };

  const canOpen = useCanOpen();
  // `t` re-applies a deep link that targets an already-open page; only
  // stamped when actually opening, never while rendering.
  const targetOf = (it: NeedsAttentionItem, t = ""): string | null => {
    if (it.kind === "approval" && it.flow === "personal_loan" && it.entityId) return `/personal-loans?id=${it.entityId}&t=${t}`;
    if (it.kind === "approval" && it.flow === "expense") return `/cash?tab=expenses&t=${t}`;
    if (it.kind === "request") return `/requests?requestId=${it.requestId}${it.loanId ? `&loanId=${it.loanId}` : ""}`;
    return it.loanId ? `/loans/${it.loanId}` : null;
  };
  // Review / View Loan only when the user can open where it leads.
  const openable = (it: NeedsAttentionItem) => {
    const to = targetOf(it);
    return !!to && canOpen(to);
  };
  const open = (it: NeedsAttentionItem) => {
    const to = targetOf(it, String(Date.now()));
    if (to) openPage(to);
  };

  return (
    <>
      <SectionTitle>Needs attention</SectionTitle>
      <Card style={{ padding: 12 }}>
        <FilterChipRow options={ATTENTION_TABS} value={kind} onChange={setKind} labels={labels} />
        {query.isLoading || (query.isFetching && !query.isFetchingNextPage && items.length === 0) ? (
          <Buffering block />
        ) : items.length === 0 ? (
          <EmptyText>Nothing needs attention right now.</EmptyText>
        ) : (
          <AccGroup>
          {items.map((it, i) => (
            <AccRow
              key={`${it.kind}-${it.flow ?? ""}-${it.requestId ?? it.entityId ?? it.loanId}-${i}`}
              id={it.loanNumber ?? (it.flow === "expense" ? it.detail : undefined)}
              name={it.customerName ?? "—"}
              sub={
                it.kind === "approval"
                  ? `${flowOf(it) !== "loan_sanction" ? `${FLOW_NAMES[flowOf(it)] ?? "Approval"} · ` : ""}Awaiting ${stageLabel(it) || "approval"}`
                  : it.kind === "request"
                    ? `${it.requestType ?? "Request"}${it.detail ? ` · ${it.detail}` : ""}`
                    : it.status ?? "Auction case"
              }
              amount={it.kind === "approval" ? inr(it.principal) : it.kind === "auction" ? inr(it.outstanding) : undefined}
              status={it.kind === "approval" ? "Pending" : it.kind === "request" ? "Pending" : it.status ?? "Overdue"}
              details={
                it.kind === "approval"
                  ? [
                      { k: "Stage", v: stageLabel(it) || "—" },
                      { k: flowOf(it) === "loan_sanction" || flowOf(it) === "personal_loan" ? "Principal" : "Amount", v: inr(it.principal) },
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
              actions={openable(it) ? [{ label: it.kind === "auction" ? "View Loan" : "Review", primary: true, onPress: () => open(it) }] : undefined}
            />
          ))}
          </AccGroup>
        )}
        {query.isFetchingNextPage ? <Buffering /> : query.hasNextPage ? <AccBtn label="Load more" onPress={() => query.fetchNextPage()} /> : null}
      </Card>
    </>
  );
}

// ---- Activity tab ----------------------------------------------------------
function ActivityFeed() {
  const canViewLoans = useCanOpen()("/loans");
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
                onPress={a.loanId && canViewLoans ? () => openPage(`/loans/${a.loanId}`) : undefined}
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
// Every karat the loan form accepts plus the common hallmark fineness grades,
// merged with the tenant's own purity standards (GET /purity-standards) so a
// custom grade set up on the web shows here too. Rates derive off the day's
// 24K benchmark exactly like loan/purity.go.
type PurityOpt = { key: string; label: string; rate: (k24: number) => number };
const STD_KARATS = [24, 23, 22, 21, 20, 18, 16, 14, 12, 10];
const STD_FINENESS = [99.9, 99.5, 91.6, 87.5, 83.3, 75, 58.5, 41.7];
const karatOpt = (k: number, label?: string): PurityOpt => ({ key: `${k}K`, label: label || `${k} Karat`, rate: (k24) => rateForKarat(k24, k) });
const finenessOpt = (f: number, label?: string): PurityOpt => ({ key: `${f}%`, label: label || `${f}% fineness`, rate: (k24) => rateForFineness(k24, f) });

function usePurityOptions(): PurityOpt[] {
  const standards = useQuery({ queryKey: ["purity-standards", "calculator"], queryFn: () => listPurityStandards() });
  return useMemo(() => {
    const byKey = new Map<string, PurityOpt>();
    for (const k of STD_KARATS) byKey.set(`${k}K`, karatOpt(k));
    for (const f of STD_FINENESS) byKey.set(`${f}%`, finenessOpt(f));
    for (const ps of standards.data ?? []) {
      if (!ps.isActive) continue;
      const o = ps.karat ? karatOpt(ps.karat, ps.label) : ps.finenessPercent ? finenessOpt(ps.finenessPercent, ps.label) : null;
      if (o && !byKey.has(o.key)) byKey.set(o.key, o);
    }
    const karats = [...byKey.values()].filter((o) => o.key.endsWith("K")).sort((a, b) => parseFloat(b.key) - parseFloat(a.key));
    const fineness = [...byKey.values()].filter((o) => o.key.endsWith("%")).sort((a, b) => parseFloat(b.key) - parseFloat(a.key));
    return [...karats, ...fineness];
  }, [standards.data]);
}

function Calculator({ k24 }: { k24: number }) {
  const [weight, setWeight] = useState("");
  const purities = usePurityOptions();
  const [purityKey, setPurityKey] = useState("22K");
  const [scheme, setScheme] = useState<Scheme | null>(null);
  const schemes = useQuery({ queryKey: ["schemes", "active"], queryFn: () => listActiveSchemes() });
  const active = schemes.data ?? [];
  const sc = scheme ?? active[0] ?? null;
  const purity = purities.find((p) => p.key === purityKey) ?? purities[0];
  const rate = k24 && purity ? purity.rate(k24) : 0;
  const amount = Math.round(((Number(weight) || 0) * rate * (sc?.ltvPercent ?? 0)) / 100 / 10) * 10;
  return (
    <Card>
      <Field label="Gold weight (grams)">
        <Input keyboardType="decimal-pad" placeholder="18.5" value={weight} onChangeText={setWeight} />
      </Field>
      <FieldRow>
        <Field label="Purity">
          <ThemeDropdown value={purity} options={purities} onChange={(p) => setPurityKey(p.key)} labelOf={(p) => p.label} keyOf={(p) => p.key} />
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
  const shell = useShell();
  return (
    <Sheet visible={visible} onClose={onClose} title="Collect Payment" maxHeightPct={70}>
      <AsyncSelect<Loan>
        label="Loan"
        placeholder="Search by loan number, customer name or ID"
        queryKey={["loans", "collect-picker"]}
        fetcher={async (q) => (await listLoansPage({ q: q || undefined, status: "Active", limit: 20, offset: 0 })).items ?? []}
        onSelect={(l) => {
          onClose();
          shell.openCollect(l.id);
        }}
        keyOf={(l) => l.id}
        renderItem={(l) => ({ title: `${l.loanNumber} · ${l.customer?.name ?? ""}`, sub: `Outstanding ${inr(l.outstandingAmount)}` })}
      />
    </Sheet>
  );
}
