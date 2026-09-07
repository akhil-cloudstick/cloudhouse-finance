import React, { useMemo, useState } from "react";
import { ScrollView, RefreshControl, View, Pressable, Alert } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { ScreenContainer } from "../../../src/components/ScreenContainer";
import { Card } from "../../../src/components/Card";
import { ThemedText } from "../../../src/components/ThemedText";
import { GoldTextInput } from "../../../src/components/GoldTextInput";
import { GoldButton } from "../../../src/components/GoldButton";
import { GoldDatePicker } from "../../../src/components/GoldDatePicker";
import { BottomSheetModal } from "../../../src/components/BottomSheetModal";
import { colors } from "../../../src/theme/colors";
import { getScheme, toggleSchemeActive, calculateSchemeEligibility } from "../../../src/api/schemes";
import { listLoansPage } from "../../../src/api/loans";
import { downloadSchemeStatement } from "../../../src/utils/schemeStatement";
import { useRefetchOnFocus } from "../../../src/hooks/useRefetchOnFocus";

function firstOfMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}
function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export default function SchemeDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const schemeId = Number(id);
  const queryClient = useQueryClient();

  const { data, isLoading, isError, refetch, isRefetching } = useQuery({
    queryKey: ["scheme", id],
    queryFn: () => getScheme(schemeId),
    enabled: !!id,
  });

  useRefetchOnFocus(refetch);

  const toggle = useMutation({
    mutationFn: () => toggleSchemeActive(schemeId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["scheme", id] });
      queryClient.invalidateQueries({ queryKey: ["schemes"] });
    },
  });

  // Download Statement — a bottom sheet with the same date-range + loan
  // filters as the web Schemes page's SchemeStatementModal, downloading
  // from the same GET /schemes/:id/statement endpoint (see
  // src/utils/schemeStatement.ts) rather than re-building PDF/xlsx on-device.
  const [statementOpen, setStatementOpen] = useState(false);
  const [stmtFrom, setStmtFrom] = useState(firstOfMonth());
  const [stmtTo, setStmtTo] = useState(today());
  const [selectedLoanIds, setSelectedLoanIds] = useState<Set<number>>(new Set());
  const [downloading, setDownloading] = useState<"pdf" | "xlsx" | null>(null);

  const loansQuery = useQuery({
    queryKey: ["scheme-loans", schemeId, stmtFrom, stmtTo],
    queryFn: () => listLoansPage({ schemeId, from: stmtFrom, to: stmtTo, limit: 50, offset: 0 }),
    enabled: statementOpen,
  });
  const loans = loansQuery.data?.items ?? [];
  const totalCollected = useMemo(
    () => loans.reduce((sum, l) => sum + (l.payments ?? []).reduce((s, p) => s + p.amount, 0), 0),
    [loans]
  );

  function toggleLoan(id: number) {
    setSelectedLoanIds((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleDownload(format: "pdf" | "xlsx") {
    setDownloading(format);
    try {
      await downloadSchemeStatement(schemeId, format, {
        from: stmtFrom,
        to: stmtTo,
        loanIds: selectedLoanIds.size ? Array.from(selectedLoanIds) : undefined,
      });
    } catch (e) {
      Alert.alert("Download failed", e instanceof Error ? e.message : "Could not download statement.");
    } finally {
      setDownloading(null);
    }
  }

  const [goldWeight, setGoldWeight] = useState("");
  const [goldRate, setGoldRate] = useState("");
  const [eligible, setEligible] = useState<number | null>(null);
  const calculate = useMutation({
    mutationFn: () => calculateSchemeEligibility(schemeId, Number(goldWeight), Number(goldRate)),
    onSuccess: (res) => setEligible(res.eligibleAmount),
  });

  return (
    <ScreenContainer style={{ padding: 0 }}>
      <View style={{ flex: 1, paddingHorizontal: 8, paddingTop: 20 }}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} />}
      >
        {isLoading ? (
          <ThemedText color={colors.muted}>Loading…</ThemedText>
        ) : isError || !data ? (
          <ThemedText color={colors.red}>Could not load this scheme.</ThemedText>
        ) : (
          <>
            <Card>
              <ThemedText variant="h2" color={colors.brandDeep}>
                {data.name}
              </ThemedText>
              <ThemedText variant="small" color={colors.muted} style={{ marginTop: 4 }}>
                {data.code}
              </ThemedText>
              <ThemedText variant="body" style={{ marginTop: 12 }}>
                Interest {data.interestRate}% · {data.durationMonths} months · LTV {data.ltvPercent}%
              </ThemedText>
              {data.conditions ? (
                <ThemedText variant="small" color={colors.muted} style={{ marginTop: 8 }}>
                  {data.conditions}
                </ThemedText>
              ) : null}
              <GoldButton
                title={data.isActive ? "Deactivate" : "Activate"}
                variant="outline"
                onPress={() => toggle.mutate()}
                loading={toggle.isPending}
              />
              <GoldButton
                title="Download Statement"
                variant="outline"
                onPress={() => setStatementOpen(true)}
                style={{ marginTop: 8 }}
              />
            </Card>

            <Card>
              <ThemedText variant="h3" style={{ marginBottom: 8 }}>
                Eligibility calculator
              </ThemedText>
              <GoldTextInput
                label="Gold weight (g)"
                keyboardType="numeric"
                value={goldWeight}
                onChangeText={setGoldWeight}
              />
              <GoldTextInput
                label="Gold rate (₹/g)"
                keyboardType="numeric"
                value={goldRate}
                onChangeText={setGoldRate}
              />
              <GoldButton
                title="Calculate"
                onPress={() => calculate.mutate()}
                loading={calculate.isPending}
                disabled={!goldWeight || !goldRate}
              />
              {eligible !== null ? (
                <ThemedText variant="h3" color={colors.brandDeep} style={{ marginTop: 8 }}>
                  Eligible: ₹{eligible.toLocaleString("en-IN")}
                </ThemedText>
              ) : null}
            </Card>
          </>
        )}
      </ScrollView>
      </View>

      <BottomSheetModal visible={statementOpen} onClose={() => setStatementOpen(false)}>
        <ThemedText variant="h3" style={{ marginBottom: 12 }}>
          Download Statement
        </ThemedText>
        <View style={{ flexDirection: "row", gap: 12 }}>
          <View style={{ flex: 1 }}>
            <GoldDatePicker label="From" value={stmtFrom} onChange={setStmtFrom} max={stmtTo} />
          </View>
          <View style={{ flex: 1 }}>
            <GoldDatePicker label="To" value={stmtTo} onChange={setStmtTo} min={stmtFrom} max={today()} />
          </View>
        </View>

        <ThemedText variant="small" color={colors.muted} style={{ marginTop: 8, marginBottom: 4 }}>
          Loans {selectedLoanIds.size > 0 ? `(${selectedLoanIds.size} selected)` : "(all loans in range)"}
        </ThemedText>
        {loansQuery.isLoading ? (
          <ThemedText color={colors.muted}>Loading loans…</ThemedText>
        ) : loans.length === 0 ? (
          <ThemedText color={colors.muted}>No loans opened under this scheme in that range.</ThemedText>
        ) : (
          <ScrollView style={{ maxHeight: 220 }}>
            {loans.map((l) => (
              <Pressable
                key={l.id}
                onPress={() => toggleLoan(l.id)}
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  paddingVertical: 8,
                  borderBottomWidth: 1,
                  borderBottomColor: colors.line,
                }}
              >
                <View
                  style={{
                    width: 18,
                    height: 18,
                    borderRadius: 4,
                    borderWidth: 1.5,
                    borderColor: colors.goldDeep,
                    marginRight: 10,
                    backgroundColor: selectedLoanIds.has(l.id) ? colors.goldDeep : "transparent",
                  }}
                />
                <ThemedText style={{ flex: 1 }}>
                  {l.loanNumber} — {l.customer?.name ?? "—"}
                </ThemedText>
                <ThemedText color={colors.muted}>₹{l.principalAmount.toLocaleString("en-IN")}</ThemedText>
              </Pressable>
            ))}
          </ScrollView>
        )}

        {loans.length > 0 ? (
          <ThemedText variant="small" color={colors.muted} style={{ marginTop: 10 }}>
            {loans.length} loan{loans.length === 1 ? "" : "s"} · ₹{totalCollected.toLocaleString("en-IN")} collected in range
          </ThemedText>
        ) : null}

        <View style={{ flexDirection: "row", gap: 12, marginTop: 16 }}>
          <View style={{ flex: 1 }}>
            <GoldButton
              title={downloading === "xlsx" ? "Preparing…" : "Excel"}
              variant="outline"
              onPress={() => handleDownload("xlsx")}
              disabled={downloading !== null}
            />
          </View>
          <View style={{ flex: 1 }}>
            <GoldButton
              title={downloading === "pdf" ? "Preparing…" : "PDF"}
              onPress={() => handleDownload("pdf")}
              disabled={downloading !== null}
            />
          </View>
        </View>
      </BottomSheetModal>
    </ScreenContainer>  );
}
