import { emptyGroupedFilter, gfDate, gfValues, groupedFilterCount, type GFSection, type GroupedFilterValue } from "@/common/components/ui";
import { listBranchesPage } from "@/modules/branches/services/branchService";
import { listCustomersPage } from "@/modules/customers/services/customerService";

// One grouped filter for the Loans list (mirrors web LoansPage's FilterPanel): Status,
// Branch and Customer are all multi-select (a loan matches any selected value within a
// section), plus a Date range on the opened date. The Branch section is left out for a
// one-branch business or a branch-confined role (see use-branch-switch.ts).

export const LOAN_STATUS_OPTIONS = ["Active", "Due Soon", "Overdue", "Defaulted", "Pending Approval", "Auction Eligible", "Closed", "Rejected"] as const;
export type LoanStatusOption = (typeof LOAN_STATUS_OPTIONS)[number];

// Due Soon / Overdue / Defaulted are read-time classifications → `servicing`.
const SERVICING: Partial<Record<LoanStatusOption, string>> = { "Due Soon": "due_soon", Overdue: "overdue", Defaulted: "defaulted" };

export type LoanFilters = GroupedFilterValue;
export const EMPTY_LOAN_FILTERS: LoanFilters = emptyGroupedFilter();

export const loanFilterCount = (f: LoanFilters) => groupedFilterCount(f);

/** The Loans filter sections. `branchIds` narrows the Customer list to those branches (a customer has one home branch). */
export function loanFilterSections(showBranch: boolean, branchIds: string[]): GFSection[] {
  return [
    { kind: "static", key: "status", label: "Status", options: LOAN_STATUS_OPTIONS.map((s) => ({ value: s, label: s })) },
    ...(showBranch
      ? [
          {
            kind: "async" as const,
            key: "branch",
            label: "Branch",
            fetchPage: (p: { q?: string; limit: number; offset: number }) =>
              listBranchesPage({ q: p.q, limit: p.limit, offset: p.offset }).then((r) => ({ items: r.items.map((b) => ({ value: String(b.id), label: b.name })), hasMore: r.hasMore })),
          },
        ]
      : []),
    {
      kind: "async",
      key: "customer",
      label: "Customer",
      deps: [branchIds.join(",")],
      fetchPage: (p) =>
        listCustomersPage({ q: p.q, limit: p.limit, offset: p.offset, ...(branchIds.length ? { branchIds: branchIds.map(Number) } : {}) }).then((r) => ({
          items: r.items.map((c) => ({ value: String(c.id), label: c.code ? `${c.name} (${c.code})` : c.name })),
          hasMore: r.hasMore,
        })),
    },
    { kind: "date", key: "date", label: "Date" },
  ];
}

/** Query params for GET /loans — arrays go comma-joined, as on web. */
export function loanFilterParams(f: LoanFilters, showBranch = true) {
  const statuses = gfValues(f, "status");
  const servicing = statuses.map((s) => SERVICING[s as LoanStatusOption]).filter((s): s is string => !!s);
  const stored = statuses.filter((s) => !SERVICING[s as LoanStatusOption]);
  const branches = showBranch ? gfValues(f, "branch") : [];
  const customers = gfValues(f, "customer");
  const { from, to } = gfDate(f, "date");
  return {
    status: stored.length ? stored.join(",") : undefined,
    servicing: servicing.length ? servicing.join(",") : undefined,
    branchId: branches.length ? branches.join(",") : undefined,
    customerId: customers.length ? customers.join(",") : undefined,
    from: from || undefined,
    to: to || undefined,
  };
}
