import React from "react";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ScreenContainer } from "../../../src/components/ScreenContainer";
import { Card } from "../../../src/components/Card";
import { ThemedText } from "../../../src/components/ThemedText";
import { GoldButton } from "../../../src/components/GoldButton";
import { colors } from "../../../src/theme/colors";
import { getEmployee, deleteEmployee } from "../../../src/api/employees";

export default function EmployeeDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const employeeId = Number(id);
  const router = useRouter();
  const queryClient = useQueryClient();

  const { data, isLoading, isError } = useQuery({
    queryKey: ["employee", id],
    queryFn: () => getEmployee(employeeId),
    enabled: !!id,
  });

  const remove = useMutation({
    mutationFn: () => deleteEmployee(employeeId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["employees"] });
      router.back();
    },
  });

  return (
    <ScreenContainer>
      {isLoading ? (
        <ThemedText color={colors.muted}>Loading…</ThemedText>
      ) : isError || !data ? (
        <ThemedText color={colors.red}>Could not load this employee.</ThemedText>
      ) : (
        <Card>
          <ThemedText variant="h2" color={colors.goldDeep}>
            {data.name}
          </ThemedText>
          <ThemedText variant="body" style={{ marginTop: 8 }}>
            {data.code} · {data.role}
          </ThemedText>
          <ThemedText variant="small" color={colors.muted} style={{ marginTop: 4 }}>
            {data.phone ?? "No phone set"}
          </ThemedText>
          <ThemedText variant="small" color={colors.muted} style={{ marginTop: 8 }}>
            Loans processed {data.loansProcessed} · Collections ₹{data.collections.toLocaleString("en-IN")}
          </ThemedText>
          <GoldButton
            title="Remove employee"
            variant="outline"
            onPress={() => remove.mutate()}
            loading={remove.isPending}
          />
        </Card>
      )}
    </ScreenContainer>
  );
}
