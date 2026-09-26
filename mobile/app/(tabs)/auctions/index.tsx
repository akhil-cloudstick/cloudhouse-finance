import React, { useState } from "react";
import { View } from "react-native";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import {
  AccRow,
  AsyncSelect,
  C,
  Field,
  FilterChipRow,
  FiltersBar,
  FlatHeader,
  PillTabs,
  PrimaryButton,
  Screen,
  SearchInput,
  ServerFlatList,
  Sheet,
  SubTabs,
  Txt,
} from "../../../src/components/ui";
import { AuctionFlowSheet } from "../../../src/components/staff/AuctionFlowSheet";
import { useServerList } from "../../../src/hooks/useServerList";
import { listLoansPage } from "../../../src/api/loans";
import { listConcludedAuctions, markAuctionEligible } from "../../../src/api/auctions";
import { useAuth } from "../../../src/auth/AuthContext";
import { ApiError } from "../../../src/api/client";
import { inr } from "../../../src/lib/format";
import type { Loan } from "../../../src/types/loan";
import { AUCTION_OUTCOME_LABELS, type ConcludedAuctionRow } from "../../../src/types/auction";

// Auctions — prototype #header-auctions + #page-auctions, the auction filter
// sheet and the Auction Flow sheet. Active Cases are loans bucketed
// server-side by `auctionCase` (eligible | defaulted | auctioned_balance_due);
// Auction History is GET /loans/auctions/concluded split by `hasSale`.

const TABS = ["active", "history"] as const;
type Tab = (typeof TABS)[number];
const TAB_LABELS: Record<Tab, string> = { active: "Active Cases", history: "Auction History" };

const CASES = ["Auction Eligible", "Defaulted", "Auctioned - Balance Due"] as const;
type CaseType = (typeof CASES)[number];
const CASE_PARAM: Record<CaseType, string> = {
  "Auction Eligible": "eligible",
  Defaulted: "defaulted",
  "Auctioned - Balance Due": "auctioned_balance_due",
};

const HIST = ["conducted", "closed"] as const;
type Hist = (typeof HIST)[number];
const HIST_LABELS: Record<Hist, string> = { conducted: "Auctions Conducted", closed: "Closed Without Auction" };

// Pushing the list first keeps the Loans stack's history sane (back lands
// on the list, not stuck on the detail).
function useOpenLoan() {
  const router = useRouter();
  return (id: number) => {
    router.push("/loans" as never);
    router.push(`/loans/${id}` as never);
  };
}

export default function AuctionsScreen() {
  const [tab, setTab] = useState<Tab>("active");
  const tabs = <PillTabs tabs={TABS} value={tab} onChange={setTab} labels={TAB_LABELS} />;
  return (
    <Screen header={<FlatHeader title="Auctions" subtitle="Active cases & history" back />}>
      {tab === "active" ? <ActiveCases tabs={tabs} /> : <AuctionHistory tabs={tabs} />}
    </Screen>
  );
}

function ActiveCases({ tabs }: { tabs: React.ReactNode }) {
  const openLoan = useOpenLoan();
  const qc = useQueryClient();
  const { can } = useAuth();
  const canAct = can("Loan_Management", "can_update_loan");

  const [caseType, setCaseType] = useState<CaseType>("Auction Eligible");
  const [sheetOpen, setSheetOpen] = useState(false);
  const [draft, setDraft] = useState<CaseType>(caseType);
  const [flowLoan, setFlowLoan] = useState<Loan | null>(null);

  // "Mark a loan as Auction Eligible" — picker limited server-side to
  // defaulted loans (the only ones the backend lets you mark).
  const [markLoan, setMarkLoan] = useState<Loan | null>(null);
  const [markMsg, setMarkMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const mark = useMutation({
    mutationFn: (l: Loan) => markAuctionEligible(l.id),
    onSuccess: (_r, l) => {
      setMarkMsg({ ok: true, text: `${l.loanNumber} marked Auction Eligible.` });
      setMarkLoan(null);
      qc.invalidateQueries({ queryKey: ["loans"] });
      qc.invalidateQueries({ queryKey: ["auction", String(l.id)] });
      qc.invalidateQueries({ queryKey: ["loan", String(l.id)] });
    },
    onError: (err) => setMarkMsg({ ok: false, text: err instanceof ApiError ? err.message : "Could not mark the loan Auction Eligible." }),
  });

  const list = useServerList<Loan, { auctionCase: string }>({
    key: ["loans", "auctions"],
    filters: { auctionCase: CASE_PARAM[caseType] },
    fetchPage: (p) => listLoansPage(p),
  });

  const caseSub = (l: Loan) => (l.status === "Auction Eligible" || l.status === "Auctioned - Balance Due" ? l.status : "Defaulted");

  return (
    <>
      <ServerFlatList
        list={list}
        items={list.items}
        keyOf={(l) => String(l.id)}
        emptyText="No auction cases match your search."
        header={
          <>
            {tabs}
            <SearchInput value={list.search} onChangeText={list.setSearch} placeholder="Search by loan ID or customer name" style={{ paddingTop: 12, paddingBottom: 8 }} />
            <FiltersBar
              count={1}
              summary={`${caseType} · ${list.total ?? list.items.length}`}
              style={{ marginTop: 0, marginBottom: 14 }}
              onPress={() => {
                setDraft(caseType);
                setMarkMsg(null);
                setSheetOpen(true);
              }}
            />
          </>
        }
        renderItem={(l, i) => {
          const days = l.daysOverdue ?? 0;
          const overdue = !!l.isOverdue || days > 0;
          return (
            <AccRow
              defaultOpen={i === 0}
              id={l.loanNumber}
              name={l.customer?.name ?? `Customer #${l.customerId}`}
              sub={caseSub(l)}
              amount={inr(l.totalOutstandingBalance ?? l.outstandingAmount)}
              status={overdue ? "Overdue" : l.status}
              details={[
                { k: "Gold weight", v: l.totalNetWeight != null ? `${+Number(l.totalNetWeight).toFixed(2)} g` : "—" },
                { k: "Days overdue", v: `${days} day${days === 1 ? "" : "s"}`, color: days > 0 ? C.red : undefined },
              ]}
              actions={[
                { label: "View Loan", onPress: () => openLoan(l.id) },
                { label: "Start Auction Flow", primary: true, onPress: () => setFlowLoan(l) },
              ]}
            />
          );
        }}
      />

      <Sheet visible={sheetOpen} onClose={() => setSheetOpen(false)} title="Filter Auction Cases" maxHeightPct={70}>
        <Field label="Case type">
          <FilterChipRow options={CASES} value={draft} onChange={setDraft} />
        </Field>
        {canAct ? (
          <>
            <AsyncSelect<Loan>
              label="Mark a loan as Auction Eligible"
              placeholder="Search customer or LN number"
              queryKey={["loans", "auction-mark-picker"]}
              fetcher={async (q) => (await listLoansPage({ q: q || undefined, auctionCase: "defaulted", limit: 20, offset: 0 })).items ?? []}
              selectedLabel={markLoan ? `${markLoan.loanNumber} · ${markLoan.customer?.name ?? ""}` : undefined}
              onClear={() => setMarkLoan(null)}
              onSelect={(l) => {
                setMarkLoan(l);
                setMarkMsg(null);
              }}
              keyOf={(l) => l.id}
              renderItem={(l) => ({ title: `${l.loanNumber} · ${l.customer?.name ?? ""}`, sub: `${l.daysOverdue ?? 0} days overdue · ${inr(l.totalOutstandingBalance ?? l.outstandingAmount)}` })}
            />
            {markMsg ? <Txt style={{ fontSize: 12, color: markMsg.ok ? C.green : C.red, marginBottom: 10 }}>{markMsg.text}</Txt> : null}
            <PrimaryButton
              label="Mark Loan Auction Eligible"
              variant="outline"
              style={{ marginBottom: 14 }}
              disabled={!markLoan}
              loading={mark.isPending}
              onPress={() => markLoan && mark.mutate(markLoan)}
            />
          </>
        ) : null}
        <PrimaryButton
          label="Apply Filters"
          onPress={() => {
            setCaseType(draft);
            setSheetOpen(false);
          }}
        />
      </Sheet>

      <AuctionFlowSheet loan={flowLoan} visible={!!flowLoan} onClose={() => setFlowLoan(null)} />
    </>
  );
}

function AuctionHistory({ tabs }: { tabs: React.ReactNode }) {
  const openLoan = useOpenLoan();
  const [hist, setHist] = useState<Hist>("conducted");
  const list = useServerList<ConcludedAuctionRow, { hasSale: boolean }>({
    key: ["auctionHistory"],
    filters: { hasSale: hist === "conducted" },
    fetchPage: async (p) => listConcludedAuctions(p),
  });

  return (
    <ServerFlatList
      list={list}
      items={list.items}
      keyOf={(r) => String(r.id)}
      emptyText="No auction history matches your search."
      header={
        <>
          {tabs}
          <SearchInput value={list.search} onChangeText={list.setSearch} placeholder="Search by loan ID or customer name" style={{ paddingTop: 12, paddingBottom: 8 }} />
          <View style={{ paddingHorizontal: 18 }}>
            <SubTabs tabs={HIST} value={hist} onChange={setHist} labels={HIST_LABELS} />
          </View>
        </>
      }
      renderItem={(r) => {
        if (r.stage === "Withdrawn" || !r.saleAmount) {
          return (
            <AccRow
              id={r.loanNumber}
              name="Withdrawn"
              sub="Settled before auction"
              amount={inr(0)}
              status="Closed"
              statusTone="active"
              details={[
                { k: "Customer", v: r.customerName || "—" },
                { k: "Stage", v: r.stage === "Withdrawn" ? "Withdrawn — customer settled" : r.stage },
              ]}
              actions={[{ label: "View Loan", onPress: () => openLoan(r.loanId) }]}
            />
          );
        }
        const ss = r.surplusShortfall ?? 0;
        return (
          <AccRow
            id={r.loanNumber}
            name="Auctioned"
            sub={`Sale ${inr(r.saleAmount)}`}
            amount={`${ss >= 0 ? "+" : "−"}${inr(Math.abs(ss))}`}
            amountColor={ss >= 0 ? C.green : C.red}
            status={ss >= 0 ? "Surplus" : "Shortfall"}
            statusTone={ss >= 0 ? "closed" : "overdue"}
            details={[
              { k: "Customer", v: r.customerName || "—" },
              { k: "Stage", v: r.stage === "Settled" ? "Sale completed" : r.stage },
              { k: "Outcome", v: AUCTION_OUTCOME_LABELS[r.finalSettlementStatus ?? "Pending"] },
            ]}
            actions={[{ label: "View Loan", onPress: () => openLoan(r.loanId) }]}
          />
        );
      }}
    />
  );
}
