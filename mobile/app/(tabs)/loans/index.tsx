import React, { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocalSearchParams, useRouter } from "expo-router";
import {
  AccRow,
  C,
  DateField,
  FabCorner,
  Field,
  FieldRow,
  FilterChipRow,
  FiltersBar,
  FlatHeader,
  PrimaryButton,
  Screen,
  SearchInput,
  ServerFlatList,
  Sheet,
  ThemeDropdown,
  useShell,
} from "../../../src/components/ui";
import { useServerList } from "../../../src/hooks/useServerList";
import { useAuth } from "../../../src/auth/AuthContext";
import { listLoansPage } from "../../../src/api/loans";
import { listSchemes } from "../../../src/api/schemes";
import { dmy, inr, todayISO } from "../../../src/lib/format";
import type { Loan } from "../../../src/types/loan";
import type { Scheme } from "../../../src/types/scheme";

// Loans list — prototype #header-loans + #page-loans + #filter-sheet-modal.
// Search (loan no. / customer name / customer ID) and every filter are
// server-side params on GET /loans; rows page in 10 at a time.

// Chip label → backend `status` value ("All" sends none).
export const LOAN_STATUS_FILTERS = ["All", "Active", "Overdue", "Due today", "Pending approval", "Closed"] as const;
type StatusFilter = (typeof LOAN_STATUS_FILTERS)[number];
const STATUS_PARAM: Record<StatusFilter, string | undefined> = {
  All: undefined,
  Active: "Active",
  Overdue: "Overdue",
  "Due today": "Due Today",
  "Pending approval": "Pending Approval",
  Closed: "Closed",
};
const SUMMARY: Record<StatusFilter, string> = {
  All: "All loans",
  Active: "Active loans",
  Overdue: "Overdue loans",
  "Due today": "Due today",
  "Pending approval": "Pending approval",
  Closed: "Closed loans",
};

type Filters = { status?: string; schemeId?: number; from?: string; to?: string };

function daysBetween(fromISO: string, toISO: string) {
  const a = new Date(+fromISO.slice(0, 4), +fromISO.slice(5, 7) - 1, +fromISO.slice(8, 10));
  const b = new Date(+toISO.slice(0, 4), +toISO.slice(5, 7) - 1, +toISO.slice(8, 10));
  return Math.round((b.getTime() - a.getTime()) / 86400000);
}

export function loanRowDetails(l: Loan) {
  const status = (l.status ?? "").toLowerCase();
  const weight = l.totalNetWeight != null ? `${+Number(l.totalNetWeight).toFixed(2)} g` : "—";
  if (status.includes("closed") || status.includes("released")) {
    return [
      { k: "Gold weight", v: weight },
      { k: "Opened on", v: dmy(l.openedDate) },
    ];
  }
  const today = todayISO();
  const due = l.dueDate?.slice(0, 10);
  if (l.isOverdue || (due && due < today)) {
    const d = l.daysOverdue ?? (due ? daysBetween(due, today) : 0);
    return [
      { k: "Gold weight", v: weight },
      { k: "Overdue by", v: `${d} day${d === 1 ? "" : "s"}`, color: C.red },
    ];
  }
  return [
    { k: "Gold weight", v: weight },
    { k: "Next due", v: due === today ? "Today" : dmy(l.dueDate) },
  ];
}

export default function LoansScreen() {
  const router = useRouter();
  const shell = useShell();
  const { can } = useAuth();
  const params = useLocalSearchParams<{ schemeId?: string; status?: string }>();

  const [status, setStatus] = useState<StatusFilter>("All");
  const [scheme, setScheme] = useState<Scheme | null>(null);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [sheetOpen, setSheetOpen] = useState(false);
  // Staged filter values edited in the sheet, applied on "Apply Filters".
  const [draft, setDraft] = useState({ status, scheme, from, to });

  const schemes = useQuery({ queryKey: ["schemes", "all-picker"], queryFn: () => listSchemes() });

  // Deep links: /loans?schemeId=… (global search "Scheme") / ?status=…
  useEffect(() => {
    if (params.schemeId && schemes.data) {
      const sc = schemes.data.find((x) => String(x.id) === params.schemeId);
      if (sc) setScheme(sc);
    }
  }, [params.schemeId, schemes.data]);
  useEffect(() => {
    const match = LOAN_STATUS_FILTERS.find((f) => STATUS_PARAM[f]?.toLowerCase() === params.status?.toLowerCase());
    if (match) setStatus(match);
  }, [params.status]);

  const filters: Filters = { status: STATUS_PARAM[status], schemeId: scheme?.id, from: from || undefined, to: to || undefined };
  const list = useServerList<Loan, Filters>({ key: ["loans", "list"], filters, fetchPage: (p) => listLoansPage(p) });
  const overdue = useQuery({ queryKey: ["loans", "overdue-count"], queryFn: () => listLoansPage({ status: "Overdue", limit: 1, offset: 0 }) });

  const activeCount = (status !== "All" ? 1 : 0) + (scheme ? 1 : 0) + (from || to ? 1 : 0);
  const summary = `${SUMMARY[status]}${scheme ? ` · ${scheme.name}` : ""} · ${list.total ?? list.items.length}`;
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
            <FiltersBar
              count={activeCount}
              summary={summary}
              onPress={() => {
                setDraft({ status, scheme, from, to });
                setSheetOpen(true);
              }}
            />
            <SearchInput
              value={list.search}
              onChangeText={list.setSearch}
              placeholder="Search this list by loan ID or customer name"
              style={{ paddingTop: 0 }}
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
              sub={l.scheme?.name ? `${l.scheme.name} scheme` : undefined}
              amount={inr(l.principalAmount)}
              status={l.status}
              details={loanRowDetails(l)}
              actions={[
                { label: "Collect Payment", disabled: closed, onPress: () => shell.openCollect(l.id) },
                { label: "View Full Details", primary: true, onPress: () => router.push(`/loans/${l.id}` as never) },
              ]}
            />
          );
        }}
      />

      <Sheet visible={sheetOpen} onClose={() => setSheetOpen(false)} title="Filter Loans" maxHeightPct={80}>
        <Field label="Status">
          <FilterChipRow options={LOAN_STATUS_FILTERS} value={draft.status} onChange={(v) => setDraft((d) => ({ ...d, status: v }))} />
        </Field>
        <Field label="Scheme">
          <ThemeDropdown<Scheme | null>
            value={draft.scheme}
            options={[null, ...(schemes.data ?? [])]}
            onChange={(v) => setDraft((d) => ({ ...d, scheme: v }))}
            labelOf={(v) => (v ? v.name : "All schemes")}
            keyOf={(v) => (v ? v.id : 0)}
            placeholder="All schemes"
          />
        </Field>
        <FieldRow>
          <DateField label="From date" value={draft.from} onChange={(v) => setDraft((d) => ({ ...d, from: v }))} clearable />
          <DateField label="To date" value={draft.to} onChange={(v) => setDraft((d) => ({ ...d, to: v }))} clearable min={draft.from || undefined} />
        </FieldRow>
        <PrimaryButton
          label="Apply Filters"
          onPress={() => {
            setStatus(draft.status);
            setScheme(draft.scheme);
            setFrom(draft.from);
            setTo(draft.to);
            setSheetOpen(false);
          }}
        />
      </Sheet>
    </Screen>
  );
}
