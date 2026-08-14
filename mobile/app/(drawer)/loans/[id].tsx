import React, { useState } from "react";
import { ScrollView } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ScreenContainer } from "../../../src/components/ScreenContainer";
import { Card } from "../../../src/components/Card";
import { ThemedText } from "../../../src/components/ThemedText";
import { GoldTextInput } from "../../../src/components/GoldTextInput";
import { GoldButton } from "../../../src/components/GoldButton";
import { colors } from "../../../src/theme/colors";
import { getLoan } from "../../../src/api/loans";
import {
  getAuction,
  markAuctionEligible,
  issueAuctionNotice,
  scheduleAuction,
  recordAuctionSale,
  settleAuction,
} from "../../../src/api/auctions";
import { ApiError } from "../../../src/api/client";

// v1: read-only loan fields + the auction workflow (eligible → notice →
// schedule → sale → settle), each stage's action only enabled once its
// AuctionRecord is in the right stage — mirrors the backend's own stage
// gating rather than re-deriving it client-side. Payments/approval-chain/
// bank-pledge actions are still the next slice of loan-detail work.
export default function LoanDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const loanId = Number(id);
  const queryClient = useQueryClient();

  const loan = useQuery({ queryKey: ["loan", id], queryFn: () => getLoan(loanId), enabled: !!id });
  const auction = useQuery({
    queryKey: ["auction", id],
    queryFn: () => getAuction(loanId),
    enabled: !!id,
    retry: false,
  });

  const [error, setError] = useState<string | null>(null);
  const [auctionDate, setAuctionDate] = useState("");
  const [referenceNumber, setReferenceNumber] = useState("");
  const [saleAmount, setSaleAmount] = useState("");
  const [auctionExpenses, setAuctionExpenses] = useState("");

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ["auction", id] });
    queryClient.invalidateQueries({ queryKey: ["loan", id] });
  }
  function onError(err: unknown) {
    setError(err instanceof ApiError ? err.message : "Could not complete that action.");
  }

  const eligible = useMutation({
    mutationFn: () => markAuctionEligible(loanId),
    onSuccess: () => {
      setError(null);
      invalidate();
    },
    onError,
  });
  const notice = useMutation({
    mutationFn: () => issueAuctionNotice(loanId),
    onSuccess: () => {
      setError(null);
      invalidate();
    },
    onError,
  });
  const schedule = useMutation({
    mutationFn: () => scheduleAuction(loanId, auctionDate, referenceNumber || undefined),
    onSuccess: () => {
      setError(null);
      invalidate();
    },
    onError,
  });
  const sale = useMutation({
    mutationFn: () => recordAuctionSale(loanId, Number(saleAmount), auctionExpenses ? Number(auctionExpenses) : undefined),
    onSuccess: () => {
      setError(null);
      invalidate();
    },
    onError,
  });
  const settle = useMutation({
    mutationFn: (status: string) => settleAuction(loanId, status),
    onSuccess: () => {
      setError(null);
      invalidate();
    },
    onError,
  });

  return (
    <ScreenContainer>
      <ScrollView showsVerticalScrollIndicator={false}>
        {loan.isLoading ? (
          <ThemedText color={colors.muted}>Loading…</ThemedText>
        ) : loan.isError || !loan.data ? (
          <ThemedText color={colors.red}>Could not load this loan.</ThemedText>
        ) : (
          <>
            <Card>
              <ThemedText variant="h2" color={colors.goldDeep}>
                {loan.data.loanNumber}
              </ThemedText>
              <ThemedText variant="body" style={{ marginTop: 8 }}>
                {loan.data.customer?.name ?? `Customer #${loan.data.customerId}`}
              </ThemedText>
              <ThemedText variant="label" style={{ marginTop: 12 }}>
                Status: {loan.data.status}
              </ThemedText>
              <ThemedText variant="body" style={{ marginTop: 4 }}>
                Principal ₹{loan.data.principalAmount.toLocaleString("en-IN")}
              </ThemedText>
              <ThemedText variant="body" color={colors.muted}>
                Outstanding ₹{loan.data.outstandingAmount.toLocaleString("en-IN")}
              </ThemedText>
              <ThemedText variant="small" color={colors.muted} style={{ marginTop: 8 }}>
                Due {new Date(loan.data.dueDate).toDateString()}
              </ThemedText>
            </Card>

            <Card>
              <ThemedText variant="h3" style={{ marginBottom: 8 }}>
                Auction
              </ThemedText>
              {error ? (
                <ThemedText variant="small" color={colors.red} style={{ marginBottom: 8 }}>
                  {error}
                </ThemedText>
              ) : null}

              {!auction.data ? (
                <GoldButton
                  title="Mark auction eligible"
                  onPress={() => eligible.mutate()}
                  loading={eligible.isPending}
                />
              ) : (
                <>
                  <ThemedText variant="label" style={{ marginBottom: 8 }}>
                    Stage: {auction.data.stage}
                  </ThemedText>

                  {auction.data.stage === "AuctionEligible" ? (
                    <GoldButton title="Issue notice" onPress={() => notice.mutate()} loading={notice.isPending} />
                  ) : null}

                  {auction.data.stage === "NoticeIssued" ? (
                    <>
                      <GoldTextInput
                        label="Auction date (YYYY-MM-DD)"
                        value={auctionDate}
                        onChangeText={setAuctionDate}
                      />
                      <GoldTextInput
                        label="Reference number"
                        value={referenceNumber}
                        onChangeText={setReferenceNumber}
                      />
                      <GoldButton
                        title="Schedule auction"
                        onPress={() => schedule.mutate()}
                        loading={schedule.isPending}
                        disabled={!auctionDate}
                      />
                    </>
                  ) : null}

                  {auction.data.stage === "AuctionScheduled" ? (
                    <>
                      <GoldTextInput
                        label="Sale amount"
                        keyboardType="numeric"
                        value={saleAmount}
                        onChangeText={setSaleAmount}
                      />
                      <GoldTextInput
                        label="Auction expenses"
                        keyboardType="numeric"
                        value={auctionExpenses}
                        onChangeText={setAuctionExpenses}
                      />
                      <GoldButton
                        title="Record sale"
                        onPress={() => sale.mutate()}
                        loading={sale.isPending}
                        disabled={!saleAmount}
                      />
                    </>
                  ) : null}

                  {auction.data.stage === "Auctioned" ? (
                    <>
                      <ThemedText variant="body" style={{ marginBottom: 8 }}>
                        Sale ₹{auction.data.saleAmount?.toLocaleString("en-IN")} · Surplus/Shortfall{" "}
                        ₹{auction.data.surplusShortfall?.toLocaleString("en-IN")}
                      </ThemedText>
                      <GoldButton
                        title="Settle to customer"
                        onPress={() => settle.mutate("SettledToCustomer")}
                        loading={settle.isPending}
                      />
                      <GoldButton
                        title="Settle to loan company"
                        variant="outline"
                        onPress={() => settle.mutate("SettledToLoanCo")}
                        loading={settle.isPending}
                      />
                    </>
                  ) : null}

                  {auction.data.stage === "Settled" ? (
                    <ThemedText variant="body" color={colors.green}>
                      Settled — {auction.data.finalSettlementStatus}
                    </ThemedText>
                  ) : null}
                </>
              )}
            </Card>
          </>
        )}
      </ScrollView>
    </ScreenContainer>
  );
}
