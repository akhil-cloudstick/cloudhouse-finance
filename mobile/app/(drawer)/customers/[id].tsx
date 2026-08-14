import React from "react";
import { useLocalSearchParams } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { ScreenContainer } from "../../../src/components/ScreenContainer";
import { Card } from "../../../src/components/Card";
import { ThemedText } from "../../../src/components/ThemedText";
import { colors } from "../../../src/theme/colors";
import { getCustomer } from "../../../src/api/customers";

export default function CustomerDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data, isLoading, isError } = useQuery({
    queryKey: ["customer", id],
    queryFn: () => getCustomer(Number(id)),
    enabled: !!id,
  });

  return (
    <ScreenContainer>
      {isLoading ? (
        <ThemedText color={colors.muted}>Loading…</ThemedText>
      ) : isError || !data ? (
        <ThemedText color={colors.red}>Could not load this customer.</ThemedText>
      ) : (
        <Card>
          <ThemedText variant="h2" color={colors.goldDeep}>
            {data.name}
          </ThemedText>
          <ThemedText variant="body" style={{ marginTop: 8 }}>
            {data.code} · {data.phone}
          </ThemedText>
          <ThemedText variant="body" style={{ marginTop: 4 }} color={colors.muted}>
            {data.address}
          </ThemedText>
          <ThemedText variant="label" style={{ marginTop: 12 }}>
            KYC {data.kycStatus} · PAN {data.panStatus} · Aadhaar {data.aadhaarStatus}
          </ThemedText>
        </Card>
      )}
    </ScreenContainer>
  );
}
