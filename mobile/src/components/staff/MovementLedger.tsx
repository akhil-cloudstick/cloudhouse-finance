import React, { useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { AccBtn, AccRow, Buffering, C, CheckItem, DateField, PillTabs, SearchInput, ServerFlatList, Sheet } from "../ui";
import { useServerList } from "../../hooks/useServerList";
import { listBranches } from "../../api/branches";
import { listCustomersPage } from "../../api/customers";
import { dmy, inr } from "../../lib/format";
import type { CashMovement } from "../../types/cash";
import type { Branch } from "../../types/branch";
import type { Customer } from "../../types/customer";
import { LedgerLink, expenseCategoryOf, modeLink, openLedger, openLoanByNumber } from "./LedgerList";

// The branch-wide movements ledger, shared by the Ledger page (Cash tab's
// Movements) and Reports' Ledger / Statement page: its Branch / Customer /
// Type / Date filter sheet, the row, and the running balance.

// Mirrors backend/internal/cash/repository.go's Category* constants — same
// list web's Cash.tsx/LedgerExportView.tsx Type filter offers.
export const MOVEMENT_TYPE_OPTIONS = [
  { value: "loan", label: "Loan" },
  { value: "auction", label: "Auction" },
  { value: "collection", label: "Collection" },
  { value: "personal loan", label: "Personal Loan" },
  { value: "investment", label: "Investment" },
  { value: "expenses", label: "Expenses" },
];

// Branch/Customer/Type multi-select filter state, server-applied via
// listCashMovementsPage's branchIds/customerIds/types (mirrors web's
// FilterPanel on Cash.tsx). Kept as plain state in the screen (not inside
// useServerList) since it's also read by the Customer picker to narrow its
// own options by the selected branches.
export type MovementFilters = { branchIds: number[]; customerIds: number[]; types: string[]; fromDate?: string; toDate?: string };
export const EMPTY_MOVEMENT_FILTERS: MovementFilters = { branchIds: [], customerIds: [], types: [] };

export function movementFilterCount(f: MovementFilters): number {
  return f.branchIds.length + f.customerIds.length + f.types.length + (f.fromDate || f.toDate ? 1 : 0);
}

export const movementFilterStyles = StyleSheet.create({
  filterBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 11,
    borderWidth: 1,
    borderColor: C.line,
    backgroundColor: C.card,
  },
  filterBtnTxt: { fontSize: 13, fontWeight: "700", color: C.ink },
  filterBadge: {
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 4,
    backgroundColor: C.brandDeep,
    alignItems: "center",
    justifyContent: "center",
  },
  filterBadgeTxt: { fontSize: 10.5, fontWeight: "700", color: "#fff" },
  filterTabWrap: { paddingHorizontal: 16, paddingTop: 4 },
  filterList: { paddingHorizontal: 16, paddingTop: 8, gap: 2 },
});
const fs = movementFilterStyles;

// loanRefFor pulls the loan number back out of `purpose` — every
// loan-related movement's Purpose carries it as a "… — LN-00049" suffix
// (see cash.MovementService.RecordLoanDisbursementCashOut/
// RecordLoanPaymentCashIn/etc) — same regex web's Cash.tsx uses. Falls back
// to the transaction group id / movement id for a movement with no loan
// number (manual top-ups, expenses, gold sales, …).
const LOAN_NUMBER_RE = /—\s*(LN-\S+)\s*$/;
function loanRefFor(m: CashMovement): string {
  const match = m.purpose ? LOAN_NUMBER_RE.exec(m.purpose) : null;
  return match?.[1] || m.transactionGroupId || String(m.id);
}

// Running balance over the currently loaded (paginated) page only — same
// best-effort approach web's Cash.tsx/LedgerExportView.tsx use, not a true
// running balance across the whole filtered set. Items are newest-first
// (occurred_on desc from the backend), so this walks oldest→newest to
// accumulate, then re-reverses to line back up with `items`' own order.
export function runningBalances(items: CashMovement[]): number[] {
  const chronological = [...items].reverse();
  let running = 0;
  const balances = chronological.map((m) => {
    running += m.type === "out" ? -m.amount : m.amount;
    return running;
  });
  return balances.reverse();
}

/** One movement: amount, purpose, in/out, and its Date / Ref / Mode / Debit /
 * Credit / Balance plus links to the loan, bank, customer and category. */
export function MovementRow({
  m,
  balance,
  categoryIds,
  defaultOpen,
}: {
  m: CashMovement;
  balance: number;
  categoryIds: Record<string, number>;
  defaultOpen?: boolean;
}) {
  const ref = loanRefFor(m);
  const bankName = m.bankRef?.name || m.bank || "Bank";
  const category = expenseCategoryOf(m.purpose);
  const categoryId = category ? categoryIds[category.toLowerCase()] : undefined;
  return (
    <AccRow
      defaultOpen={defaultOpen}
      name={inr(m.amount)}
      sub={m.purpose || m.source}
      status={m.type === "in" ? "Cash in" : "Cash out"}
      statusTone={m.type === "in" ? "active" : "due"}
      details={[
        { k: "Date", v: dmy(m.occurredOn) },
        { k: "Ref No", v: ref.startsWith("LN-") ? <LedgerLink label={ref} onPress={() => openLoanByNumber(ref)} /> : ref },
        { k: "Mode", v: modeLink(m.mode) },
        { k: "Debit", v: m.type === "out" ? inr(m.amount) : "—" },
        { k: "Credit", v: m.type === "in" ? inr(m.amount) : "—" },
        { k: "Balance", v: inr(balance) },
        m.bankId
          ? { k: "Bank", v: <LedgerLink label={bankName} onPress={() => openLedger("bank", m.bankId!, bankName)} /> }
          : m.bank
            ? { k: "Bank", v: m.bank }
            : { k: "Branch", v: m.branch?.name || "—" },
        ...(m.partyCustomerId
          ? [{ k: "Customer", v: <LedgerLink label={m.partyCustomer?.name || "Customer"} onPress={() => openLedger("customer", m.partyCustomerId!, m.partyCustomer?.name || "Customer")} /> }]
          : []),
        ...(categoryId ? [{ k: "Category", v: <LedgerLink label={category!} onPress={() => openLedger("category", categoryId, category!)} /> }] : []),
        ...(m.status ? [{ k: "Status", v: m.status }] : []),
      ]}
    />
  );
}

const FILTER_TABS = ["branch", "customer", "type", "date"] as const;
type FilterTab = (typeof FILTER_TABS)[number];

/** Branch/Customer/Type/Date multi-select filter — mirrors web's
 * FilterPanel (Cash.tsx) as tabs of checkable rows inside one sheet
 * (mobile has no direct FilterPanel equivalent). Selecting a Branch narrows
 * the Customer tab's own list to customers whose home branch is one of
 * those (a customer belongs to exactly one branch), same cross-filter rule
 * as web. Applies immediately (no separate "Apply" step) since each toggle
 * already re-queries the (debounced) list underneath via useServerList's
 * `filters`. */
export function MovementFilterSheet({
  visible,
  onClose,
  value,
  onChange,
  title = "Filter Movements",
}: {
  visible: boolean;
  onClose: () => void;
  value: MovementFilters;
  onChange: (next: MovementFilters) => void;
  title?: string;
}) {
  const [filterTab, setFilterTab] = useState<FilterTab>("branch");
  useEffect(() => {
    if (visible) setFilterTab("branch");
  }, [visible]);

  const branches = useQuery({ queryKey: ["branches", "all"], queryFn: listBranches, enabled: visible });
  const customers = useServerList<Customer, { branchIds?: number[] }>({
    key: ["customers", "filter-picker"],
    fetchPage: (p) => listCustomersPage(p),
    filters: value.branchIds.length ? { branchIds: value.branchIds } : {},
    enabled: visible && filterTab === "customer",
  });

  function toggleBranch(id: number) {
    onChange({
      ...value,
      branchIds: value.branchIds.includes(id) ? value.branchIds.filter((b) => b !== id) : [...value.branchIds, id],
    });
  }
  function toggleCustomer(id: number) {
    onChange({
      ...value,
      customerIds: value.customerIds.includes(id) ? value.customerIds.filter((c) => c !== id) : [...value.customerIds, id],
    });
  }
  function toggleType(v: string) {
    onChange({ ...value, types: value.types.includes(v) ? value.types.filter((t) => t !== v) : [...value.types, v] });
  }

  const hasDate = !!(value.fromDate || value.toDate);
  const count = movementFilterCount(value);

  return (
    <Sheet visible={visible} onClose={onClose} title={title} maxHeightPct={80} scroll={false}>
      <View style={fs.filterTabWrap}>
        <PillTabs
          tabs={FILTER_TABS}
          value={filterTab}
          onChange={setFilterTab}
          labels={{ branch: `Branch${value.branchIds.length ? ` (${value.branchIds.length})` : ""}`, customer: `Customer${value.customerIds.length ? ` (${value.customerIds.length})` : ""}`, type: `Type${value.types.length ? ` (${value.types.length})` : ""}`, date: `Date${hasDate ? " (1)" : ""}` }}
          inSheet
        />
      </View>
      {filterTab === "branch" ? (
        <View style={fs.filterList}>
          {branches.isLoading ? (
            <Buffering style={{ paddingVertical: 20 }} />
          ) : (
            (branches.data ?? []).map((b: Branch) => (
              <CheckItem key={b.id} checked={value.branchIds.includes(b.id)} onPress={() => toggleBranch(b.id)} title={b.name} />
            ))
          )}
        </View>
      ) : filterTab === "type" ? (
        <View style={fs.filterList}>
          {MOVEMENT_TYPE_OPTIONS.map((o) => (
            <CheckItem key={o.value} checked={value.types.includes(o.value)} onPress={() => toggleType(o.value)} title={o.label} />
          ))}
        </View>
      ) : filterTab === "date" ? (
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
          emptyText={value.branchIds.length ? "No customers in the selected branch(es)." : "No customers found."}
          header={<SearchInput value={customers.search} onChangeText={customers.setSearch} placeholder="Search customer" style={{ paddingHorizontal: 16 }} />}
          renderItem={(c) => (
            <CheckItem checked={value.customerIds.includes(c.id)} onPress={() => toggleCustomer(c.id)} title={c.name} sub={c.code} />
          )}
        />
      )}
      {count > 0 ? (
        <View style={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: 4 }}>
          <AccBtn label="Clear all filters" onPress={() => onChange(EMPTY_MOVEMENT_FILTERS)} />
        </View>
      ) : null}
    </Sheet>
  );
}
