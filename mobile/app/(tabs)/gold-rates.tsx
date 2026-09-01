import React, { useState } from "react";
import { ScrollView, RefreshControl, View } from "react-native";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { ScreenContainer } from "../../src/components/ScreenContainer";
import { Card } from "../../src/components/Card";
import { ThemedText } from "../../src/components/ThemedText";
import { GoldTextInput } from "../../src/components/GoldTextInput";
import { GoldButton } from "../../src/components/GoldButton";
import { Pager } from "../../src/components/Pager";
import { colors } from "../../src/theme/colors";
import { listGoldRatesPage, publishGoldRate } from "../../src/api/goldRates";
import { GoldRate } from "../../src/types/goldRate";
import { ApiError } from "../../src/api/client";
import { useAuth } from "../../src/auth/AuthContext";
import { useRefetchOnFocus } from "../../src/hooks/useRefetchOnFocus";
import { rateForPurityString } from "../../src/lib/purity";
import { fmt } from "../../src/lib/format";
import { ExpandableTable, type TableColumn } from "../../src/components/ExpandableTable";

const PAGE_SIZE = 10;

const RATE_COLUMNS: TableColumn<GoldRate>[] = [
  { key: "date", label: "Date", render: (r) => new Date(r.date).toLocaleDateString("en-IN") },
  { key: "k24", label: "24K Rate", render: (r) => fmt(r.k24) },
  { key: "setBy", label: "Set By", render: (r) => r.setBy },
];

// Every other purity's rate is derived, not stored — showing what 22K/18K/
// 91.6% actually price out to (same math NewLoan.tsx's ornament rows use)
// is more useful in the expand strip than repeating the raw fields above.
function rateExtraFields(r: GoldRate) {
  const k22 = rateForPurityString(r.k24, "22K");
  const k18 = rateForPurityString(r.k24, "18K");
  const fineness = rateForPurityString(r.k24, "91.6%");
  return [
    { label: "22K", value: k22 != null ? fmt(k22) : "—" },
    { label: "18K", value: k18 != null ? fmt(k18) : "—" },
    { label: "91.6%", value: fineness != null ? fmt(fineness) : "—" },
  ];
}

// Read-only list — the backend already returns rates newest-first (each
// publish is append-only, see backend/internal/goldrate/model.go); no
// client-side sort/filter is applied here per the plan's server-side rule.
// The form below mirrors frontend/components/Dashboard.tsx's RateModalContent
// (POST /gold-rates — only the 24K benchmark is entered, setBy is the signed-
// in employee's name, date defaults server-side to today when omitted).
export default function GoldRatesScreen() {
  const queryClient = useQueryClient();
  const { employee } = useAuth();
  const [formVisible, setFormVisible] = useState(false);
  const [k24, setK24] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);

  const { data, isLoading, isError, isFetching, refetch } = useQuery({
    queryKey: ["gold-rates", page],
    queryFn: () => listGoldRatesPage({ limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE }),
  });

  useRefetchOnFocus(refetch);

  const rates = data?.items ?? [];

  const publish = useMutation({
    mutationFn: () =>
      publishGoldRate({ k24: Number(k24), setBy: employee?.name ?? "Mobile App" }),
    onSuccess: () => {
      setK24("");
      setError(null);
      setFormVisible(false);
      setPage(1);
      queryClient.invalidateQueries({ queryKey: ["gold-rates"] });
      queryClient.invalidateQueries({ queryKey: ["gold-rates", "latest"] });
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Could not publish rate."),
  });

  return (
    <ScreenContainer style={{ paddingHorizontal: 0 }}>
      <View style={{ paddingHorizontal: 16, marginBottom: 8 }}>
        <GoldButton
          title={formVisible ? "Cancel" : "+ Set today's rate"}
          variant={formVisible ? "outline" : "primary"}
          onPress={() => setFormVisible((v) => !v)}
        />
      </View>

      {formVisible ? (
        <Card style={{ marginHorizontal: 16 }}>
          <ThemedText variant="h3" style={{ marginBottom: 8 }}>
            Set today&apos;s 24K rate
          </ThemedText>
          <GoldTextInput
            label="24K rate (₹ per gram)"
            keyboardType="numeric"
            value={k24}
            onChangeText={setK24}
          />
          {error ? (
            <ThemedText variant="small" color={colors.red} style={{ marginBottom: 8 }}>
              {error}
            </ThemedText>
          ) : null}
          <GoldButton
            title={publish.isPending ? "Publishing…" : "Publish"}
            onPress={() => publish.mutate()}
            loading={publish.isPending}
            disabled={!k24 || Number(k24) <= 0}
          />
        </Card>
      ) : null}

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ padding: 16 }}
        refreshControl={<RefreshControl refreshing={isFetching && !isLoading} onRefresh={refetch} />}
      >
        <ExpandableTable<GoldRate>
          columns={RATE_COLUMNS}
          visibleCount={RATE_COLUMNS.length}
          data={rates}
          keyExtractor={(r) => String(r.id)}
          extraFields={rateExtraFields}
          emptyText={isLoading ? "Loading…" : isError ? "Could not load gold rates." : "No rates published yet."}
        />
        <Pager page={page} hasMore={!!data?.hasMore} onChange={setPage} loading={isFetching} />
      </ScrollView>
    </ScreenContainer>
  );
}
