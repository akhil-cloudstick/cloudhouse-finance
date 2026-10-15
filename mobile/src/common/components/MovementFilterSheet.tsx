import { useEffect, useState } from "react";
import { Pressable, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { Buffering, C, CheckItem, DateField, PillTabs, SearchInput, ServerFlatList, Sheet, Txt } from "@/common/components/ui";
import { useServerList } from "@/common/hooks/use-server-list";
import { useShowBranchFilter } from "@/common/hooks/use-branch-switch";
import { listBranches } from "@/modules/branches/services/branchService";
import { listCustomersPage } from "@/modules/customers/services/customerService";
import type { Branch } from "@/modules/branches/types/branch-types";
import type { Customer } from "@/modules/customers/types/customer-types";
import { MovementFilters, movementFilterCount, MOVEMENT_TYPE_OPTIONS, MOVEMENT_MODE_OPTIONS, EMPTY_MOVEMENT_FILTERS, movementFilterStyles } from "./movementLedger";

const fs = movementFilterStyles;
const ALL_FILTER_TABS = ["branch", "customer", "type", "mode", "date"] as const;
type FilterTab = (typeof ALL_FILTER_TABS)[number];
type MovementFilterSheetProps = {
  visible: boolean;
  onClose: () => void;
  value: MovementFilters;
  onChange: (next: MovementFilters) => void;
  title?: string;
};

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
}: MovementFilterSheetProps) {
  // No Branch tab for a one-branch business or a branch-confined role (same rule as web).
  const showBranch = useShowBranchFilter();
  const filterTabs = ALL_FILTER_TABS.filter((t) => t !== "branch" || showBranch);
  const firstTab: FilterTab = filterTabs[0];
  const [filterTab, setFilterTab] = useState<FilterTab>(firstTab);
  useEffect(() => {
    if (visible) setFilterTab(firstTab);
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

  function toggleMode(v: string) {
    onChange({ ...value, modes: value.modes.includes(v) ? value.modes.filter((m) => m !== v) : [...value.modes, v] });
  }

  const hasDate = !!(value.fromDate || value.toDate);
  const count = movementFilterCount(value);

  return (
    <Sheet visible={visible} onClose={onClose} title={
        <View style={{ flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
          <Txt style={{ fontWeight: "700", fontSize: 15, flexShrink: 1 }} numberOfLines={1}>{title}</Txt>
          {count > 0 ? (
            <Pressable onPress={() => onChange(EMPTY_MOVEMENT_FILTERS)} hitSlop={10} accessibilityRole="button">
              <Txt style={{ fontSize: 13, fontWeight: "700", color: C.brand }}>Clear all</Txt>
            </Pressable>
          ) : null}
        </View>
      }
      maxHeightPct={65}
      scroll={false}
    >
      <View style={fs.filterTabWrap}>
        <PillTabs
          tabs={filterTabs}
          value={filterTab}
          onChange={setFilterTab}
          labels={{ branch: `Branch${value.branchIds.length ? ` (${value.branchIds.length})` : ""}`, customer: `Customer${value.customerIds.length ? ` (${value.customerIds.length})` : ""}`, type: `Type${value.types.length ? ` (${value.types.length})` : ""}`, mode: `Mode${value.modes.length ? ` (${value.modes.length})` : ""}`, date: `Date${hasDate ? " (1)" : ""}` }}
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
      ) : filterTab === "mode" ? (
        <View style={fs.filterList}>
          {MOVEMENT_MODE_OPTIONS.map((o) => (
            <CheckItem key={o.value} checked={value.modes.includes(o.value)} onPress={() => toggleMode(o.value)} title={o.label} />
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
    </Sheet>
  );
}
