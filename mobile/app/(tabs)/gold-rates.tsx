import React, { useState } from "react";
import { RefreshControl, View } from "react-native";
import { useInfiniteQuery, useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { ScreenContainer } from "../../src/components/ScreenContainer";
import { Card } from "../../src/components/Card";
import { ThemedText } from "../../src/components/ThemedText";
import { GoldTextInput } from "../../src/components/GoldTextInput";
import { GoldButton } from "../../src/components/GoldButton";
import { colors } from "../../src/theme/colors";
import { listGoldRatesPage, publishGoldRate, latestGoldRate } from "../../src/api/goldRates";
import { GoldRate } from "../../src/types/goldRate";
import { ApiError } from "../../src/api/client";
import { useAuth } from "../../src/auth/AuthContext";
import { useRefetchOnFocus } from "../../src/hooks/useRefetchOnFocus";
import { rateForPurityString, finenessForKarat, rateForFineness } from "../../src/lib/purity";
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
    { label: "22K (stored)", value: fmt(r.k22 || 0) },
    { label: "18K (stored)", value: fmt(r.k18 || 0) },
    { label: "22K (computed)", value: k22 != null ? fmt(k22) : "—" },
    { label: "18K (computed)", value: k18 != null ? fmt(k18) : "—" },
    { label: "91.6%", value: fineness != null ? fmt(fineness) : "—" },
  ];
}

type Mode = "auto" | "manual";

/* Brought to parity with frontend/common/components/modals/RateModal.tsx —
 * a single 24K/22K/18K row (matching the original layout) instead of a
 * karat-picker + one field. Mode is all-or-nothing across all three
 * karats, not per-karat:
 * - Auto (default): every karat's rate derives live off 24K at an
 *   editable fineness% (prefilled with the standard karat/24 ratio).
 *   Typing the fineness recomputes the rate live.
 * - Typing directly into 22K's or 18K's rate switches ALL THREE karats to
 *   Manual at once — same as pressing the top "Manual" pill. 24K's rate
 *   is the exception: typing it directly does NOT trigger the switch.
 * Only karats whose effective rate changed from the latest published row
 * get published, each its own call, in 24→22→18 order. */
export default function GoldRatesScreen() {
  const queryClient = useQueryClient();
  const { employee } = useAuth();
  const [formVisible, setFormVisible] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const latest = useQuery({ queryKey: ["gold-rates", "latest"], queryFn: () => latestGoldRate(), retry: false });
  const k24Now = latest.data?.k24 ?? 0;
  const k22Now = latest.data?.k22 ?? 0;
  const k18Now = latest.data?.k18 ?? 0;

  // Frozen when the form opens — the "999 reference" every Auto karat
  // (24K included) derives its fineness-adjusted rate off. Re-deriving off
  // a live-edited rate24 would make 24K's own fineness field circular.
  const [ref24, setRef24] = useState(0);

  const [mode, setMode] = useState<Mode>("auto");
  const [rate24, setRate24Raw] = useState("");
  const [fineness24, setFineness24Raw] = useState("100");
  const [rate22, setRate22] = useState("");
  const [fineness22, setFineness22Raw] = useState(String(finenessForKarat(22)));
  const [rate18, setRate18] = useState("");
  const [fineness18, setFineness18Raw] = useState(String(finenessForKarat(18)));

  function openForm() {
    setFormVisible(true);
    setRef24(k24Now || 0);
    setMode("auto");
    setFineness24Raw("100");
    setFineness22Raw(String(finenessForKarat(22)));
    setFineness18Raw(String(finenessForKarat(18)));
    setRate24Raw(k24Now ? String(k24Now) : "");
    setRate22(k24Now > 0 ? String(rateForFineness(k24Now, finenessForKarat(22))) : "");
    setRate18(k24Now > 0 ? String(rateForFineness(k24Now, finenessForKarat(18))) : "");
    setError(null);
  }

  function bulkSetManual() {
    setMode("manual");
  }
  function bulkSetAuto() {
    setMode("auto");
    setFineness24Raw("100");
    setFineness22Raw(String(finenessForKarat(22)));
    setFineness18Raw(String(finenessForKarat(18)));
    setRate24Raw(ref24 > 0 ? String(ref24) : "");
    setRate22(ref24 > 0 ? String(rateForFineness(ref24, finenessForKarat(22))) : "");
    setRate18(ref24 > 0 ? String(rateForFineness(ref24, finenessForKarat(18))) : "");
  }

  function editRate24(v: string) {
    // Unlike 22K/18K, typing 24K's own rate does NOT switch mode —
    // 24K has no separate reference to fall out of sync with.
    setRate24Raw(v);
  }
  function editRate22(v: string) {
    setMode("manual"); // any direct 22K/18K rate edit is all-or-nothing
    setRate22(v);
  }
  function editRate18(v: string) {
    setMode("manual");
    setRate18(v);
  }
  // Fineness is a purity percentage — never meaningfully above 100%.
  // Clamped, not rejected.
  function clampFineness(v: string): string {
    return v !== "" && +v > 100 ? "100" : v;
  }
  function editFineness24(v: string) {
    const c = clampFineness(v);
    setFineness24Raw(c);
    if (ref24 > 0 && +c > 0) setRate24Raw(String(rateForFineness(ref24, +c)));
  }
  function editFineness22(v: string) {
    const c = clampFineness(v);
    setFineness22Raw(c);
    if (ref24 > 0 && +c > 0) setRate22(String(rateForFineness(ref24, +c)));
  }
  function editFineness18(v: string) {
    const c = clampFineness(v);
    setFineness18Raw(c);
    if (ref24 > 0 && +c > 0) setRate18(String(rateForFineness(ref24, +c)));
  }

  // Non-blocking sanity check on Manual entries — 22K/18K priced above a
  // purer karat inverts the usual purity hierarchy. Flagged, never
  // prevented.
  const hierarchyWarning =
    mode === "manual" && +rate22 > 0 && +rate24 > 0 && +rate22 > +rate24
      ? "22K is priced higher than 24K."
      : mode === "manual" && +rate18 > 0 && +rate22 > 0 && +rate18 > +rate22
        ? "18K is priced higher than 22K."
        : mode === "manual" && +rate18 > 0 && +rate24 > 0 && +rate18 > +rate24
          ? "18K is priced higher than 24K."
          : "";

  const { data, isLoading, isError, isFetching, isFetchingNextPage, fetchNextPage, hasNextPage, refetch } = useInfiniteQuery({
    queryKey: ["gold-rates"],
    queryFn: ({ pageParam = 0 }) => listGoldRatesPage({ limit: PAGE_SIZE, offset: pageParam }),
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) => (lastPage.hasMore ? allPages.length * PAGE_SIZE : undefined),
  });

  useRefetchOnFocus(refetch, latest.refetch);

  const rates = data?.pages.flatMap((p) => p.items) ?? [];

  function onSaved(msg: string) {
    setError(null);
    setFormVisible(false);
    queryClient.invalidateQueries({ queryKey: ["gold-rates"] });
    queryClient.invalidateQueries({ queryKey: ["gold-rates", "latest"] });
  }
  function onFailed(err: unknown) {
    setError(err instanceof ApiError ? err.message : "Could not publish rate.");
  }

  const publish = useMutation({
    mutationFn: async () => {
      const setBy = employee?.name ?? "Mobile App";
      const jobs: { karat: 24 | 22 | 18; rate: number }[] = [];
      if (Math.round(+rate24) !== Math.round(k24Now || 0)) jobs.push({ karat: 24, rate: +rate24 });
      if (Math.round(+rate22) !== Math.round(k22Now || 0)) jobs.push({ karat: 22, rate: +rate22 });
      if (Math.round(+rate18) !== Math.round(k18Now || 0)) jobs.push({ karat: 18, rate: +rate18 });
      if (jobs.length === 0) throw new Error("Nothing has changed from today's published rates.");
      for (const j of jobs) {
        await publishGoldRate({ karat: j.karat, rate: j.rate, setBy });
      }
      return jobs;
    },
    onSuccess: (jobs) => onSaved(`${jobs.map((j) => `${j.karat}K`).join(", ")} published`),
    onError: onFailed,
  });

  const canPublish = +rate24 > 0 && +rate22 > 0 && +rate18 > 0;

  return (
    <ScreenContainer style={{ paddingHorizontal: 0 }}>
      <View style={{ paddingHorizontal: 16, paddingTop: 20, marginBottom: 8 }}>
        <GoldButton
          title={formVisible ? "Cancel" : "+ Set today's rate"}
          variant={formVisible ? "outline" : "primary"}
          onPress={() => (formVisible ? setFormVisible(false) : openForm())}
        />
      </View>

      {formVisible ? (
        <Card style={{ marginHorizontal: 16 }}>
          <ThemedText variant="h3" style={{ marginBottom: 8 }}>
            Set Today&apos;s Gold Rate
          </ThemedText>
          <View style={{ flexDirection: "row", gap: 8, marginBottom: 12 }}>
            <GoldButton title="Auto" variant={mode === "auto" ? "primary" : "outline"} onPress={bulkSetAuto} style={{ flex: 1 }} />
            <GoldButton title="Manual" variant={mode === "manual" ? "primary" : "outline"} onPress={bulkSetManual} style={{ flex: 1 }} />
          </View>

          <GoldTextInput label="24K · 999 (₹/g)" keyboardType="numeric" value={rate24} onChangeText={editRate24} />
          <ThemedText variant="small" color={colors.muted} style={{ marginTop: -8, marginBottom: 8 }}>
            {mode === "manual" ? "set directly" : "adjust directly, or via fineness below"}
          </ThemedText>
          {mode === "auto" ? (
            <>
              <ThemedText variant="label" color={colors.muted}>Fineness (%)</ThemedText>
              <GoldTextInput keyboardType="numeric" value={fineness24} onChangeText={editFineness24} />
              <ThemedText variant="small" color={colors.muted} style={{ marginBottom: 8 }}>standard 100%</ThemedText>
            </>
          ) : null}

          <GoldTextInput label="22K (₹/g)" keyboardType="numeric" value={rate22} onChangeText={editRate22} />
          <ThemedText variant="small" color={colors.muted} style={{ marginTop: -8, marginBottom: 8 }}>
            {mode === "manual" ? "set independently of 24K" : "editing this switches to Manual ↓"}
          </ThemedText>
          {mode === "auto" ? (
            <>
              <ThemedText variant="label" color={colors.muted}>Fineness (%)</ThemedText>
              <GoldTextInput keyboardType="numeric" value={fineness22} onChangeText={editFineness22} />
              <ThemedText variant="small" color={colors.muted} style={{ marginBottom: 8 }}>standard {finenessForKarat(22)}%</ThemedText>
            </>
          ) : null}

          <GoldTextInput label="18K (₹/g)" keyboardType="numeric" value={rate18} onChangeText={editRate18} />
          <ThemedText variant="small" color={colors.muted} style={{ marginTop: -8, marginBottom: 8 }}>
            {mode === "manual" ? "set independently of 24K" : "editing this switches to Manual ↓"}
          </ThemedText>
          {mode === "auto" ? (
            <>
              <ThemedText variant="label" color={colors.muted}>Fineness (%)</ThemedText>
              <GoldTextInput keyboardType="numeric" value={fineness18} onChangeText={editFineness18} />
              <ThemedText variant="small" color={colors.muted} style={{ marginBottom: 8 }}>standard {finenessForKarat(18)}%</ThemedText>
            </>
          ) : null}

          {hierarchyWarning ? (
            <ThemedText variant="small" color={colors.amber} style={{ marginBottom: 8 }}>
              ⚠ {hierarchyWarning} You can still publish this if intentional.
            </ThemedText>
          ) : null}

          <ThemedText variant="small" color={colors.muted} style={{ marginBottom: 8 }}>
            Typing 22K/18K&apos;s rate switches the whole form to Manual; 24K&apos;s never does.
          </ThemedText>
          {error ? (
            <ThemedText variant="small" color={colors.red} style={{ marginBottom: 8 }}>
              {error}
            </ThemedText>
          ) : null}
          <GoldButton
            title={publish.isPending ? "Publishing…" : "Publish"}
            onPress={() => publish.mutate()}
            loading={publish.isPending}
            disabled={!canPublish}
          />
        </Card>
      ) : null}

      <View style={{ paddingHorizontal: 16, marginBottom: 4, marginTop: formVisible ? 12 : 0 }}>
        <ThemedText variant="small" color={colors.muted}>
          24K is always published directly. 22K/18K can be published directly too (Manual mode) or derived from
          24K at a chosen purity (Auto mode). Any other purity is resolved per-ornament, at pledge time.
        </ThemedText>
      </View>

      <View style={{ flex: 1, paddingHorizontal: 16, paddingTop: 16 }}>
        <ExpandableTable<GoldRate>
          columns={RATE_COLUMNS}
          visibleCount={RATE_COLUMNS.length}
          data={rates}
          keyExtractor={(r) => String(r.id)}
          extraFields={rateExtraFields}
          emptyText={isLoading ? "Loading…" : isError ? "Could not load gold rates." : "No rates published yet."}
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
