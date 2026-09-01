import React, { useState } from "react";
import { ScrollView, RefreshControl, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { ScreenContainer } from "../../../src/components/ScreenContainer";
import { ThemedText } from "../../../src/components/ThemedText";
import { GoldButton } from "../../../src/components/GoldButton";
import { Pager } from "../../../src/components/Pager";
import { colors } from "../../../src/theme/colors";
import { listEmployeesPage } from "../../../src/api/employees";
import { Employee } from "../../../src/types/employee";
import { useRefetchOnFocus } from "../../../src/hooks/useRefetchOnFocus";
import { fmt } from "../../../src/lib/format";
import { ExpandableTable, defaultVisibleCount, type TableColumn } from "../../../src/components/ExpandableTable";

const PAGE_SIZE = 10;

// 3 columns + 5 detail-only fields (Code/Phone/Collections/Followups/
// Pending) = 8 total — "large", so Name/Role/Branch stay visible and the
// performance counters fold into the expand strip.
const EMPLOYEE_COLUMNS: TableColumn<Employee>[] = [
  { key: "name", label: "Name", render: (e) => e.name, weight: 1.3 },
  { key: "role", label: "Role", render: (e) => e.role, weight: 1.1 },
  { key: "branch", label: "Branch", render: (e) => e.branch?.name || "—" },
];
const EMPLOYEE_VISIBLE_COUNT = defaultVisibleCount(EMPLOYEE_COLUMNS.length + 5);

function employeeExtraFields(e: Employee) {
  return [
    { label: "Code", value: e.code },
    { label: "Phone", value: e.phone || "—" },
    { label: "Loans Processed", value: String(e.loansProcessed) },
    { label: "Collections", value: fmt(e.collections) },
    { label: "Follow-ups / Pending", value: `${e.followups} / ${e.pending}` },
  ];
}

// No server-side search on this endpoint today (see src/api/employees.ts) —
// list is already branch-scoped, paginated 10/page.
export default function EmployeesScreen() {
  const router = useRouter();
  const [page, setPage] = useState(1);

  const { data, isLoading, isError, isFetching, refetch } = useQuery({
    queryKey: ["employees", page],
    queryFn: () => listEmployeesPage({ limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE }),
  });

  useRefetchOnFocus(refetch);

  const employees = data?.items ?? [];

  return (
    <ScreenContainer style={{ paddingHorizontal: 0 }}>
      <View style={{ paddingHorizontal: 16 }}>
        <GoldButton title="Add employee" variant="outline" onPress={() => router.push("/employees/new")} />
      </View>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ padding: 16 }}
        refreshControl={<RefreshControl refreshing={isFetching && !isLoading} onRefresh={refetch} />}
      >
        <ExpandableTable<Employee>
          columns={EMPLOYEE_COLUMNS}
          visibleCount={EMPLOYEE_VISIBLE_COUNT}
          data={employees}
          keyExtractor={(e) => String(e.id)}
          extraFields={employeeExtraFields}
          onViewDescription={(e) => router.push(`/employees/${e.id}`)}
          emptyText={isLoading ? "Loading…" : isError ? "Could not load employees." : "No employees found."}
        />
        <Pager page={page} hasMore={!!data?.hasMore} onChange={setPage} loading={isFetching} />
      </ScrollView>
    </ScreenContainer>
  );
}
