import { usePersistedState } from "@/common/hooks/use-persisted-state";
import React, { useState } from "react";
import {
  AccRow,
  C,
  ChipMultiSelect,
  DateField,
  Field,
  FieldRow,
  FiltersBar,
  FlatHeader,
  PrimaryButton,
  Screen,
  SearchInput,
  ServerFlatList,
  Sheet,
  SummaryCard,
  type ChipTone,
  openPage,
} from "@/common/components/ui";
import { View } from "react-native";
import { useServerList } from "@/common/hooks/use-server-list";
import { listLoanRiskAssessmentPage, RISK_STATUSES } from "@/modules/loans/services/loanService";
import { type LoanRiskCounts, type LoanRiskLevel, type LoanRiskRow } from "@/modules/loans/types/loan-types";
import { inr } from "@/common/utils/format";

// Loan Risk — not drawn in the prototype; built from its list language
// (FlatHeader back, SummaryCard, FiltersBar + filter Sheet, SearchInput,
// server-paged AccRows). riskLevel is classified server-side
// (Service.ClassifyRisk); every filter and the search are backend params on
// GET /loans/risk-assessment.

// Status and risk level each take any number of ticked values; none ticked means no restriction.
const STATUS_FILTERS = RISK_STATUSES;

const LEVEL_FILTERS = ["Loss", "At Risk", "Safe"] as const;
type LevelFilter = (typeof LEVEL_FILTERS)[number];
const LEVEL_PARAM: Record<LevelFilter, LoanRiskLevel> = { Loss: "Loss", "At Risk": "AtRisk", Safe: "Safe" };

const RISK_TONE: Record<LoanRiskLevel, ChipTone> = { Safe: "active", AtRisk: "due", Loss: "overdue" };
const RISK_LABEL: Record<LoanRiskLevel, string> = { Safe: "Safe", AtRisk: "At Risk", Loss: "Loss" };

// status and riskLevel are comma-separated lists (the server accepts one or several).
type Filters = { status?: string; riskLevel?: string; from?: string; to?: string };
type RiskPage = { items: LoanRiskRow[]; hasMore: boolean; total: number; counts: LoanRiskCounts };

export default function LoanRiskScreen() {
  const [status, setStatus] = usePersistedState<string[]>("loanrisk:statuses", []);
  const [level, setLevel] = usePersistedState<string[]>("loanrisk:levels", []);
  const [from, setFrom] = usePersistedState("loanrisk:from", "");
  const [to, setTo] = usePersistedState("loanrisk:to", "");
  const [sheetOpen, setSheetOpen] = useState(false);
  const [draft, setDraft] = useState({ status, level, from, to });
  // Counts come back on every page — keep the latest server figures.
  const [counts, setCounts] = useState<LoanRiskCounts | null>(null);

  const filters: Filters = {
    status: status.length ? status.join(",") : undefined,
    riskLevel: level.length ? level.map((l) => LEVEL_PARAM[l as LevelFilter]).join(",") : undefined,
    from: from || undefined,
    to: to || undefined,
  };
  const list = useServerList<LoanRiskRow, Filters>({
    key: ["loan-risk", "list"],
    filters,
    fetchPage: async (p) => {
      const page = (await listLoanRiskAssessmentPage(p)) as RiskPage;
      if (page.counts) setCounts(page.counts);
      return page;
    },
  });

  const activeCount = status.length + level.length + (from || to ? 1 : 0);
  const summary = `${level.length ? level.join(", ") : "All levels"}${status.length ? ` · ${status.join(", ")}` : ""} · ${list.total ?? list.items.length}`;

  return (
    <Screen header={<FlatHeader title="Loan Risk" subtitle="Risk assessment across active loans" />}>
      <ServerFlatList
        list={list}
        items={list.items}
        keyOf={(r) => String(r.loanId)}
        emptyText={
          list.error
            ? "Could not load risk assessment. A gold rate may not be published yet."
            : list.search
              ? "No loans match your search."
              : "No loans found."
        }
        header={
          <>
            <View style={{ paddingTop: 14 }}>
              <SummaryCard
                title="Gold-value risk"
                stats={[
                  { n: String(counts?.loss ?? 0), l: "Loss" },
                  { n: String(counts?.atRisk ?? 0), l: "At risk" },
                  { n: String(counts?.safe ?? 0), l: "Safe" },
                ]}
              />
            </View>
            <FiltersBar
              count={activeCount}
              summary={summary}
              onPress={() => {
                setDraft({ status, level, from, to });
                setSheetOpen(true);
              }}
            />
            <SearchInput
              value={list.search}
              onChangeText={list.setSearch}
              placeholder="Search by loan ID, customer name or ID"
              style={{ paddingTop: 8 }}
            />
          </>
        }
        renderItem={(r, i) => {
          const margin = r.currentGoldValue - r.principalAmount;
          return (
            <AccRow
              defaultOpen={i === 0}
              id={r.loanNumber}
              name={r.customerName}
              sub={r.status}
              amount={inr(r.principalAmount)}
              status={RISK_LABEL[r.riskLevel] ?? r.riskLevel}
              statusTone={RISK_TONE[r.riskLevel]}
              details={[
                { k: "Gold weight", v: `${Number(r.totalNetWeight ?? 0).toFixed(2)} g` },
                { k: "Gold value today", v: inr(r.currentGoldValue) },
                { k: "Outstanding", v: inr(r.principalAmount) },
                { k: "Margin", v: `${margin >= 0 ? "+" : "−"}${inr(Math.abs(margin))}`, color: margin >= 0 ? C.green : C.red },
              ]}
              actions={[{ label: "View Loan", primary: true, onPress: () => openPage(`/loans/${r.loanId}`) }]}
            />
          );
        }}
      />

      <Sheet visible={sheetOpen} onClose={() => setSheetOpen(false)} title="Filter Loan Risk" maxHeightPct={80}>
        <Field label="Risk level">
          <ChipMultiSelect options={LEVEL_FILTERS} value={draft.level} onChange={(v) => setDraft((d) => ({ ...d, level: v }))} />
        </Field>
        <Field label="Loan status">
          <ChipMultiSelect options={STATUS_FILTERS} value={draft.status} onChange={(v) => setDraft((d) => ({ ...d, status: v }))} />
        </Field>
        <FieldRow>
          <DateField label="Opened from" value={draft.from} onChange={(v) => setDraft((d) => ({ ...d, from: v }))} clearable />
          <DateField label="Opened to" value={draft.to} onChange={(v) => setDraft((d) => ({ ...d, to: v }))} clearable min={draft.from || undefined} />
        </FieldRow>
        <PrimaryButton
          label="Apply Filters"
          onPress={() => {
            setStatus(draft.status);
            setLevel(draft.level);
            setFrom(draft.from);
            setTo(draft.to);
            setSheetOpen(false);
          }}
        />
      </Sheet>
    </Screen>
  );
}
