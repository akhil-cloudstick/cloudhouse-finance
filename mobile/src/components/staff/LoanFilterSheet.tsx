import React from "react";
import { useQuery } from "@tanstack/react-query";
import { AccBtn, AsyncSelect, ChipToggle, DateField, Field, FieldRow, Sheet, ThemeDropdown } from "../ui";
import { listBranches } from "../../api/branches";
import { listCustomersPage } from "../../api/customers";
import type { Branch } from "../../types/branch";
import type { Customer } from "../../types/customer";

// One grouped filter for the Loans list (mirrors web Loans.tsx's FilterPanel):
// Status (single), Branch (single, hidden for single-branch businesses),
// Customer (single, backend-searched), Date range. Selected values are shown
// by name inside the sheet; one "Reset all" clears everything.

export const LOAN_STATUS_OPTIONS = ["All", "Active", "Due Soon", "Overdue", "Defaulted", "Pending Approval", "Auction Eligible", "Closed", "Rejected"] as const;
export type LoanStatusOption = (typeof LOAN_STATUS_OPTIONS)[number];

// Due Soon / Overdue / Defaulted are read-time classifications → `servicing`.
const SERVICING: Partial<Record<LoanStatusOption, string>> = { "Due Soon": "due_soon", Overdue: "overdue", Defaulted: "defaulted" };

export type LoanFilters = {
  status: LoanStatusOption;
  branch: { id: number; name: string } | null;
  customer: { id: number; label: string } | null;
  from: string;
  to: string;
};
export const EMPTY_LOAN_FILTERS: LoanFilters = { status: "All", branch: null, customer: null, from: "", to: "" };

export function loanFilterCount(f: LoanFilters) {
  return (f.status !== "All" ? 1 : 0) + (f.branch ? 1 : 0) + (f.customer ? 1 : 0) + (f.from || f.to ? 1 : 0);
}

/** Query params for GET /loans. */
export function loanFilterParams(f: LoanFilters) {
  const servicing = SERVICING[f.status];
  return {
    status: f.status === "All" || servicing ? undefined : f.status,
    servicing,
    branchId: f.branch?.id,
    customerId: f.customer?.id,
    from: f.from || undefined,
    to: f.to || undefined,
  };
}

export function loanFilterSummary(f: LoanFilters) {
  const parts = [
    f.status !== "All" ? f.status : null,
    f.branch?.name,
    f.customer?.label,
    f.from || f.to ? "Date range" : null,
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : "All loans";
}

const customerLabel = (c: Customer) => (c.code ? `${c.name} (${c.code})` : c.name);

export function LoanFilterSheet({
  visible,
  onClose,
  value,
  onChange,
}: {
  visible: boolean;
  onClose: () => void;
  value: LoanFilters;
  onChange: (next: LoanFilters) => void;
}) {
  const branches = useQuery({ queryKey: ["branches", "all"], queryFn: listBranches, enabled: visible });
  const showBranch = (branches.data?.length ?? 0) > 1;
  const set = (patch: Partial<LoanFilters>) => onChange({ ...value, ...patch });

  return (
    <Sheet visible={visible} onClose={onClose} title="Filter Loans" maxHeightPct={85}>
      <Field label="Status">
        <ChipToggle<LoanStatusOption> options={LOAN_STATUS_OPTIONS} value={value.status} onChange={(v) => set({ status: v })} wrap />
      </Field>
      {showBranch ? (
        <Field label="Branch">
          <ThemeDropdown<Branch | null>
            value={value.branch ? ((branches.data ?? []).find((b) => b.id === value.branch!.id) ?? null) : null}
            options={[null, ...(branches.data ?? [])]}
            onChange={(b) => set({ branch: b ? { id: b.id, name: b.name } : null })}
            labelOf={(b) => (b ? b.name : "All branches")}
            keyOf={(b) => (b ? b.id : 0)}
            placeholder="All branches"
          />
        </Field>
      ) : null}
      <AsyncSelect<Customer>
        label="Customer"
        placeholder="Search customer by name or ID"
        queryKey={["customers", "loan-filter-picker"]}
        fetcher={async (q) => (await listCustomersPage({ q: q || undefined, limit: 30, offset: 0 })).items ?? []}
        selectedLabel={value.customer?.label}
        onSelect={(c) => set({ customer: { id: c.id, label: customerLabel(c) } })}
        onClear={() => set({ customer: null })}
        keyOf={(c) => c.id}
        renderItem={(c) => ({ title: c.name, sub: c.code })}
      />
      <FieldRow>
        <DateField label="From date" value={value.from} onChange={(v) => set({ from: v })} clearable max={value.to || undefined} />
        <DateField label="To date" value={value.to} onChange={(v) => set({ to: v })} clearable min={value.from || undefined} />
      </FieldRow>
      {loanFilterCount(value) > 0 ? <AccBtn label="Reset all" onPress={() => onChange(EMPTY_LOAN_FILTERS)} /> : null}
    </Sheet>
  );
}
