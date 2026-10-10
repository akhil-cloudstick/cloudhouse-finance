import React, { useEffect, useMemo, useState } from "react";
import { View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { AccBtn, C, CheckItem, DateField, FabCorner, FiltersBar, FlatHeader, PillTabs, Screen, SearchInput, ServerFlatList, Sheet, Txt, toast } from "@/common/components/ui";
import { useServerList } from "@/common/hooks/use-server-list";
import { listCashMovementsByBranch } from "@/modules/cash/services/cashService";
import { listCustomersPage } from "@/modules/customers/services/customerService";
import { isUserCancel, userMessage } from "@/common/services/apiErrors";
import { shareBranchLedgerPdf } from "@/common/utils/ledgerExport";
import { dmy, inr } from "@/common/utils/format";
import { useAuth } from "@/common/providers/AuthProvider";
import { useExpenseCategoryIds } from "@/common/components/LedgerList";
import { movementFilterStyles as fs, runningBalances } from "@/common/components/movementLedger";
import { MovementRow } from "@/common/components/MovementRow";
import type { CashMovement } from "@/modules/cash/types/cash-types";
import type { Customer } from "@/modules/customers/types/customer-types";

// Branch ledger — the web's BranchLedger (/ledger-branch/:id) as its own
// screen, opened from the Ledger action on a Branches row (not a sheet).
// Grouped Transaction Type / Customer / Date filter, Net / Total Credit /
// Total Debit, and a PDF Download. Like web, only the date range is applied
// by the server; Type and Customer narrow the loaded page client-side.

const TYPE_OPTIONS = [
  { value: "loans", label: "Loans" },
  { value: "auction", label: "Auction" },
  { value: "personal loan", label: "Personal Loan" },
  { value: "investments", label: "Investments" },
  { value: "expenses", label: "Expenses" },
];

type Filters = { types: string[]; customerIds: number[]; fromDate?: string; toDate?: string };
const EMPTY: Filters = { types: [], customerIds: [] };
const TABS = ["type", "customer", "date"] as const;
type Tab = (typeof TABS)[number];

const filterCount = (f: Filters) => f.types.length + f.customerIds.length + (f.fromDate || f.toDate ? 1 : 0);

function summary(f: Filters): string {
  const dates = f.fromDate && f.toDate ? `${dmy(f.fromDate)} – ${dmy(f.toDate)}` : f.fromDate ? `From ${dmy(f.fromDate)}` : f.toDate ? `Until ${dmy(f.toDate)}` : "All dates";
  return [dates, f.types.length ? `${f.types.length} type${f.types.length === 1 ? "" : "s"}` : null, f.customerIds.length ? `${f.customerIds.length} customer${f.customerIds.length === 1 ? "" : "s"}` : null].filter(Boolean).join(" · ");
}

type BranchFilterSheetProps = { visible: boolean; onClose: () => void; value: Filters; onChange: (f: Filters) => void };

function BranchFilterSheet({ visible, onClose, value, onChange }: BranchFilterSheetProps) {
  const [tab, setTab] = useState<Tab>("type");
  useEffect(() => {
    if (visible) setTab("type");
  }, [visible]);
  const customers = useServerList<Customer>({ key: ["customers", "branch-ledger-filter"], fetchPage: (p) => listCustomersPage(p), enabled: visible && tab === "customer" });
  const toggleType = (v: string) => onChange({ ...value, types: value.types.includes(v) ? value.types.filter((t) => t !== v) : [...value.types, v] });
  const toggleCustomer = (id: number) => onChange({ ...value, customerIds: value.customerIds.includes(id) ? value.customerIds.filter((c) => c !== id) : [...value.customerIds, id] });
  const hasDate = !!(value.fromDate || value.toDate);
  return (
    <Sheet visible={visible} onClose={onClose} title="Filter Ledger" maxHeightPct={80} scroll={false}>
      <View style={fs.filterTabWrap}>
        <PillTabs
          tabs={TABS}
          value={tab}
          onChange={setTab}
          labels={{
            type: `Transaction Type${value.types.length ? ` (${value.types.length})` : ""}`,
            customer: `Customer${value.customerIds.length ? ` (${value.customerIds.length})` : ""}`,
            date: `Date${hasDate ? " (1)" : ""}`,
          }}
          inSheet
        />
      </View>
      {tab === "type" ? (
        <View style={fs.filterList}>
          {TYPE_OPTIONS.map((o) => (
            <CheckItem key={o.value} checked={value.types.includes(o.value)} onPress={() => toggleType(o.value)} title={o.label} />
          ))}
        </View>
      ) : tab === "date" ? (
        <View style={[fs.filterList, { flexDirection: "row", gap: 10 }]}>
          <View style={{ flex: 1 }}>
            <DateField label="From" value={value.fromDate} onChange={(v) => onChange({ ...value, fromDate: v || undefined })} max={value.toDate} clearable />
          </View>
          <View style={{ flex: 1 }}>
            <DateField label="To" value={value.toDate} onChange={(v) => onChange({ ...value, toDate: v || undefined })} min={value.fromDate} clearable />
          </View>
        </View>
      ) : (
        <ServerFlatList
          list={customers}
          items={customers.items}
          inSheet
          keyOf={(c) => `c${c.id}`}
          emptyText="No customers found."
          header={<SearchInput value={customers.search} onChangeText={customers.setSearch} placeholder="Search customer" style={{ paddingHorizontal: 16 }} />}
          renderItem={(c) => <CheckItem checked={value.customerIds.includes(c.id)} onPress={() => toggleCustomer(c.id)} title={c.name} sub={c.code} />}
        />
      )}
      {filterCount(value) > 0 ? (
        <View style={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: 4 }}>
          <AccBtn label="Clear all filters" onPress={() => onChange(EMPTY)} />
        </View>
      ) : null}
    </Sheet>
  );
}

export default function BranchLedgerScreen() {
  const { id, label } = useLocalSearchParams<{ id: string; label?: string }>();
  const branchId = Number(id);
  const canExport = useAuth().can("Ledger_Export", "can_export_ledger");
  const [filters, setFilters] = useState<Filters>(EMPTY);
  const [filterOpen, setFilterOpen] = useState(false);
  const [totals, setTotals] = useState<{ in: number; out: number; net: number } | null>(null);
  const [exporting, setExporting] = useState(false);
  const categoryIds = useExpenseCategoryIds();

  const list = useServerList<CashMovement, Filters>({
    key: ["branch-ledger", branchId],
    fetchPage: (p) =>
      listCashMovementsByBranch(branchId, { limit: p.limit, offset: p.offset, fromDate: p.fromDate, toDate: p.toDate }).then((r) => {
        setTotals({ in: r.totals?.totalIn ?? 0, out: r.totals?.totalOut ?? 0, net: r.totals?.net ?? 0 });
        const items = (r.items ?? []).filter((m) => {
          if (p.types.length && !p.types.some((t) => (m.purpose || "").toLowerCase().includes(t))) return false;
          if (p.customerIds.length && !(m.partyCustomerId && p.customerIds.includes(m.partyCustomerId))) return false;
          return true;
        });
        return { items, hasMore: p.offset + p.limit < r.total, total: r.total };
      }),
    filters,
    enabled: branchId > 0,
    fresh: true,
  });
  const balances = useMemo(() => runningBalances(list.items), [list.items]);

  async function onDownload() {
    if (exporting) return;
    setExporting(true);
    toast.info("Preparing PDF", "The ledger will open in the share sheet.");
    try {
      await shareBranchLedgerPdf(branchId, { fromDate: filters.fromDate, toDate: filters.toDate });
    } catch (e) {
      if (isUserCancel(e)) return;
      toast.error("Download failed", userMessage(e, "Could not download the ledger — try again."));
    } finally {
      setExporting(false);
    }
  }

  const count = filterCount(filters);
  return (
    <Screen header={<FlatHeader title={label ? `${label} — Ledger` : "Branch Ledger"} subtitle="Every cash movement recorded against this branch" back />}>
      <ServerFlatList
        list={list}
        items={list.items}
        keyOf={(m) => `m${m.id}`}
        emptyText={count ? "No entries match your filters." : "No transactions found."}
        header={
          <View style={{ paddingTop: 12 }}>
            <FiltersBar count={count} summary={summary(filters)} onPress={() => setFilterOpen(true)} style={{ marginTop: 0, marginBottom: 10 }} />
            {totals ? (
              <View style={{ flexDirection: "row", justifyContent: "space-between", marginHorizontal: 18, marginBottom: 14, paddingVertical: 10, paddingHorizontal: 12, borderRadius: 10, backgroundColor: C.card, borderWidth: 1, borderColor: C.line }}>
                <Txt style={{ fontSize: 12, color: C.muted }}>
                  Net <Txt style={{ fontWeight: "700", color: totals.net < 0 ? C.red : C.green }}>{inr(totals.net)}</Txt>
                </Txt>
                <Txt style={{ fontSize: 12, color: C.muted }}>
                  Credit <Txt style={{ fontWeight: "700", color: C.green }}>{inr(totals.in)}</Txt>
                </Txt>
                <Txt style={{ fontSize: 12, color: C.muted }}>
                  Debit <Txt style={{ fontWeight: "700", color: C.red }}>{inr(totals.out)}</Txt>
                </Txt>
              </View>
            ) : null}
          </View>
        }
        renderItem={(m, i) => <MovementRow m={m} balance={balances[i] ?? 0} categoryIds={categoryIds} defaultOpen={i === 0} />}
      />
      {list.items.length > 0 && canExport ? <FabCorner icon="download" label="Download ledger PDF" onPress={onDownload} /> : null}
      <BranchFilterSheet visible={filterOpen} onClose={() => setFilterOpen(false)} value={filters} onChange={setFilters} />
    </Screen>
  );
}
