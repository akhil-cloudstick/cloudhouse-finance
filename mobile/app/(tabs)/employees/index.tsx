import React from "react";
import { RefreshControl, View } from "react-native";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { ScreenContainer } from "../../../src/components/ScreenContainer";
import { ThemedText } from "../../../src/components/ThemedText";
import { GoldButton } from "../../../src/components/GoldButton";
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

  const { data, isLoading, isError, isFetching, isFetchingNextPage, fetchNextPage, hasNextPage, refetch } = useInfiniteQuery({
    queryKey: ["employees"],
    queryFn: ({ pageParam = 0 }) => listEmployeesPage({ limit: PAGE_SIZE, offset: pageParam }),
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) => (lastPage.hasMore ? allPages.length * PAGE_SIZE : undefined),
  });

  useRefetchOnFocus(refetch);

  const employees = data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <ScreenContainer style={{ paddingHorizontal: 0 }}>
      <View style={{ flex: 1, paddingHorizontal: 16 }}>
        <ExpandableTable<Employee>
          headerContent={
            <View style={{ paddingTop: 20, marginBottom: 16 }}>
              <GoldButton title="Add employee" variant="outline" onPress={() => router.push("/employees/new")} />
            </View>
          }
          columns={EMPLOYEE_COLUMNS}
          visibleCount={EMPLOYEE_VISIBLE_COUNT}
          data={employees}
          keyExtractor={(e) => String(e.id)}
          extraFields={employeeExtraFields}
          onViewDescription={(e) => router.push(`/employees/${e.id}`)}
          loading={isLoading}
          emptyText={isError ? "Could not load employees." : "No employees found."}
          refreshControl={<RefreshControl refreshing={isFetching && !isFetchingNextPage && !isLoading} onRefresh={refetch} />}
          onEndReached={() => {
            if (hasNextPage && !isFetchingNextPage) fetchNextPage();
          }}
          isFetchingNextPage={isFetchingNextPage}
        />
      </View>
    </ScreenContainer>
  );
}
