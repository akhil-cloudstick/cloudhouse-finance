
import { StyleSheet } from "react-native";
import { C } from "@/common/components/ui";
import type { CashMovement } from "@/modules/cash/types/cash-types";

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
