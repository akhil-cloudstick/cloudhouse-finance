import React from "react";
import { Pressable, ScrollView, RefreshControl } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { ScreenContainer } from "../../../src/components/ScreenContainer";
import { Card } from "../../../src/components/Card";
import { ThemedText } from "../../../src/components/ThemedText";
import { colors } from "../../../src/theme/colors";
import { getCustomer } from "../../../src/api/customers";
import { listLoans } from "../../../src/api/loans";
import { Loan } from "../../../src/types/loan";
import { useRefetchOnFocus } from "../../../src/hooks/useRefetchOnFocus";

export default function CustomerDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const customerId = Number(id);

  const { data, isLoading, isError, refetch, isRefetching } = useQuery({
    queryKey: ["customer", id],
    queryFn: () => getCustomer(customerId),
    enabled: !!id,
  });

  // GET /customers/:id does not embed loans (customer/handler.go's Get just
  // returns rec.ToResponse()) — fetched separately via the customerId filter
  // loan/handler.go already supports (handler.go:174-176).
  const {
    data: loans,
    isLoading: loansLoading,
    isError: loansError,
    refetch: refetchLoans,
    isRefetching: isRefetchingLoans,
  } = useQuery({
    queryKey: ["loans", "customer", customerId],
    queryFn: () => listLoans({ customerId }),
    enabled: !!id,
  });

  useRefetchOnFocus(refetch, refetchLoans);

  return (
    <ScreenContainer>
      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={isRefetching || isRefetchingLoans}
            onRefresh={() => {
              refetch();
              refetchLoans();
            }}
          />
        }
      >
      {isLoading ? (
        <ThemedText color={colors.muted}>Loading…</ThemedText>
      ) : isError || !data ? (
        <ThemedText color={colors.red}>Could not load this customer.</ThemedText>
      ) : (
        <>
          <Card>
            <ThemedText variant="h2" color={colors.goldDeep}>
              {data.name}
            </ThemedText>
            <ThemedText variant="body" style={{ marginTop: 8 }}>
              {data.code} · {data.phone}
            </ThemedText>
            {data.dob ? (
              <ThemedText variant="small" style={{ marginTop: 4 }} color={colors.muted}>
                DOB {new Date(data.dob).toLocaleDateString("en-IN")}
              </ThemedText>
            ) : null}
            <ThemedText variant="body" style={{ marginTop: 4 }} color={colors.muted}>
              {data.address}
            </ThemedText>
            {data.branch?.name ? (
              <ThemedText variant="small" style={{ marginTop: 4 }} color={colors.muted}>
                Branch: {data.branch.name}
              </ThemedText>
            ) : null}
            <ThemedText variant="label" style={{ marginTop: 12 }}>
              KYC {data.kycStatus} · PAN {data.panStatus} · Aadhaar {data.aadhaarStatus}
            </ThemedText>
            {data.pan ? (
              <ThemedText variant="small" style={{ marginTop: 4 }} color={colors.muted}>
                PAN {data.pan}
              </ThemedText>
            ) : null}
            {data.aadhaarLast4 ? (
              <ThemedText variant="small" style={{ marginTop: 4 }} color={colors.muted}>
                Aadhaar ••••{data.aadhaarLast4}
              </ThemedText>
            ) : null}
          </Card>

          {data.nomineeName ? (
            <Card>
              <ThemedText variant="h3" style={{ marginBottom: 8 }}>
                Nominee
              </ThemedText>
              <ThemedText variant="body">{data.nomineeName}</ThemedText>
              <ThemedText variant="small" color={colors.muted} style={{ marginTop: 4 }}>
                {data.nomineeRelation} · {data.nomineePhone}
              </ThemedText>
            </Card>
          ) : null}

          <Card>
            <ThemedText variant="h3" style={{ marginBottom: 8 }}>
              Loans
            </ThemedText>
            {loansLoading ? (
              <ThemedText color={colors.muted}>Loading…</ThemedText>
            ) : loansError ? (
              <ThemedText color={colors.red}>Could not load loans.</ThemedText>
            ) : !loans || loans.length === 0 ? (
              <ThemedText color={colors.muted}>No loans found.</ThemedText>
            ) : (
              loans.map((loan: Loan, index: number) => (
                <Pressable
                  key={loan.id}
                  onPress={() => router.push(`/loans/${loan.id}`)}
                  style={{
                    paddingVertical: 10,
                    borderTopWidth: index === 0 ? 0 : 1,
                    borderTopColor: colors.line,
                  }}
                >
                  <ThemedText variant="body">{loan.loanNumber}</ThemedText>
                  <ThemedText variant="small" color={colors.muted} style={{ marginTop: 2 }}>
                    {loan.status} · ₹{loan.outstandingAmount?.toLocaleString("en-IN")} outstanding
                  </ThemedText>
                </Pressable>
              ))
            )}
          </Card>
        </>
      )}
      </ScrollView>
    </ScreenContainer>
  );
}
