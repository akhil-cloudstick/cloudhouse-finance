import React, { useEffect, useRef, useState } from "react";
import { Animated, RefreshControl, View } from "react-native";
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
import { useRefetchOnFocus, useResetOnBlur } from "../../src/hooks/useRefetchOnFocus";
import { rateForPurityString, finenessForKarat, rateForFineness } from "../../src/lib/purity";
import { fmt } from "../../src/lib/format";
import { ExpandableTable, type TableColumn } from "../../src/components/ExpandableTable";

const PAGE_SIZE = 10;

// Small left-right wobble, once, exactly when `trigger` flips from false to
// true — mirrors the "flag it, don't block it" purity-hierarchy warning:
// the shake draws the eye without stopping anyone from typing further.
function useShakeAnim(trigger: boolean) {
  const x = useRef(new Animated.Value(0)).current;
  const wasTriggered = useRef(false);
  useEffect(() => {
    if (trigger && !wasTriggered.current) {
      Animated.sequence([
        Animated.timing(x, { toValue: 6, duration: 45, useNativeDriver: true }),
        Animated.timing(x, { toValue: -6, duration: 45, useNativeDriver: true }),
        Animated.timing(x, { toValue: 4, duration: 45, useNativeDriver: true }),
        Animated.timing(x, { toValue: -4, duration: 45, useNativeDriver: true }),
        Animated.timing(x, { toValue: 0, duration: 45, useNativeDriver: true }),
      ]).start();
    }
    wasTriggered.current = trigger;
  }, [trigger, x]);
  return x;
}

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

  // Which karat's rate field staff last actually typed into — the
  // hierarchy warning below only ever flags THIS one, never whichever
  // other karat it happens to be compared against.
  const [lastEdited, setLastEdited] = useState<24 | 22 | 18 | null>(null);

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
    setLastEdited(null);
    setError(null);
  }

  function bulkSetManual() {
    setMode("manual");
    setLastEdited(null);
  }
  function bulkSetAuto() {
    setMode("auto");
    setFineness24Raw("100");
    setFineness22Raw(String(finenessForKarat(22)));
    setFineness18Raw(String(finenessForKarat(18)));
    setRate24Raw(ref24 > 0 ? String(ref24) : "");
    setRate22(ref24 > 0 ? String(rateForFineness(ref24, finenessForKarat(22))) : "");
    setRate18(ref24 > 0 ? String(rateForFineness(ref24, finenessForKarat(18))) : "");
    setLastEdited(null);
  }

  function editRate24(v: string) {
    // Unlike 22K/18K, typing 24K's own rate does NOT switch mode —
    // 24K has no separate reference to fall out of sync with.
    setRate24Raw(v);
    setLastEdited(24);
    // 22K/18K keep tracking 24K live while still in Auto — only 24K's OWN
    // fineness field derives off the frozen ref24 instead, to avoid
    // deriving off itself.
    const k24 = +v;
    if (mode === "auto" && k24 > 0) {
      if (+fineness22 > 0) setRate22(String(rateForFineness(k24, +fineness22)));
      if (+fineness18 > 0) setRate18(String(rateForFineness(k24, +fineness18)));
    }
  }
  function editRate22(v: string) {
    setMode("manual"); // any direct 22K/18K rate edit is all-or-nothing
    setLastEdited(22);
    setRate22(v);
  }
  function editRate18(v: string) {
    setMode("manual");
    setLastEdited(18);
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
    // Off the LIVE 24K rate, not the frozen ref24 — see editRate24.
    if (+rate24 > 0 && +c > 0) setRate22(String(rateForFineness(+rate24, +c)));
  }
  function editFineness18(v: string) {
    const c = clampFineness(v);
    setFineness18Raw(c);
    if (+rate24 > 0 && +c > 0) setRate18(String(rateForFineness(+rate24, +c)));
  }

  // Non-blocking sanity check on Manual entries — 22K/18K priced above a
  // purer karat inverts the usual purity hierarchy. Flagged, never
  // prevented.
  const violation22vs24 = mode === "manual" && +rate22 > 0 && +rate24 > 0 && +rate22 > +rate24;
  const violation18vs22 = mode === "manual" && +rate18 > 0 && +rate22 > 0 && +rate18 > +rate22;
  const violation18vs24 = mode === "manual" && +rate18 > 0 && +rate24 > 0 && +rate18 > +rate24;
  // Only the karat actually being edited gets flagged, never whichever
  // other one it's compared against.
  const invalid24 = lastEdited === 24 && (violation22vs24 || violation18vs24);
  const invalid22 = lastEdited === 22 && violation22vs24;
  const invalid18 = lastEdited === 18 && (violation18vs22 || violation18vs24);
  const shakeX24 = useShakeAnim(invalid24);
  const shakeX22 = useShakeAnim(invalid22);
  const shakeX18 = useShakeAnim(invalid18);

  const { data, isLoading, isError, isFetching, isFetchingNextPage, fetchNextPage, hasNextPage, refetch } = useInfiniteQuery({
    queryKey: ["gold-rates"],
    queryFn: ({ pageParam = 0 }) => listGoldRatesPage({ limit: PAGE_SIZE, offset: pageParam }),
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) => (lastPage.hasMore ? allPages.length * PAGE_SIZE : undefined),
  });

  useRefetchOnFocus(refetch, latest.refetch);

  useResetOnBlur(() => {
    setFormVisible(false);
    setError(null);
  });

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

  // The publish form (Card below) used to sit as a fixed sibling above
  // ExpandableTable, squeezing its flex:1 slot down to almost nothing
  // whenever the form was open — the table's own FlatList scrolled fine,
  // there just wasn't room left to see it. Moved into ExpandableTable's
  // `headerContent` instead, so it scrolls away WITH the table — same fix
  // as customers/[id].tsx's own profile/nominee cards (see that screen's
  // comment and ExpandableTable.tsx's `headerContent` doc comment).
  const formHeader = (
    <>
      <View style={{ paddingTop: 20, marginBottom: 8 }}>
        <GoldButton
          title={formVisible ? "Cancel" : "+ Set today's rate"}
          variant={formVisible ? "outline" : "primary"}
          onPress={() => (formVisible ? setFormVisible(false) : openForm())}
        />
      </View>

      {formVisible ? (
        <Card style={{ marginBottom: 12 }}>
          <ThemedText variant="h3" style={{ marginBottom: 8 }}>
            Set Today&apos;s Gold Rate
          </ThemedText>
          <View style={{ flexDirection: "row", gap: 8, marginBottom: 12 }}>
            <GoldButton title="Auto" variant={mode === "auto" ? "primary" : "outline"} onPress={bulkSetAuto} style={{ flex: 1 }} />
            <GoldButton title="Manual" variant={mode === "manual" ? "primary" : "outline"} onPress={bulkSetManual} style={{ flex: 1 }} />
          </View>

          {mode === "auto" ? (
            <View style={{ marginBottom: 12 }}>
              <ThemedText variant="label" color={colors.muted}>Fineness (100%)</ThemedText>
              <GoldTextInput keyboardType="numeric" value={fineness24} onChangeText={editFineness24} />
            </View>
          ) : null}
          <Animated.View style={{ transform: [{ translateX: shakeX24 }] }}>
            <GoldTextInput label="24K · 999 (₹/g)" keyboardType="numeric" value={rate24} onChangeText={editRate24} invalid={invalid24} />
          </Animated.View>
          {invalid24 ? (
            <ThemedText variant="small" color="#ef4444" style={{ marginTop: -8, marginBottom: 8 }}>
              ⚠ Price hierarchy is wrong.
            </ThemedText>
          ) : null}
          <ThemedText variant="small" color={colors.muted} style={{ marginTop: -8, marginBottom: 8 }}>
            {mode === "manual" ? "set directly" : "adjust directly, or via fineness above"}
          </ThemedText>

          {mode === "auto" ? (
            <View style={{ marginBottom: 12 }}>
              <ThemedText variant="label" color={colors.muted}>Fineness ({finenessForKarat(22)}%)</ThemedText>
              <GoldTextInput keyboardType="numeric" value={fineness22} onChangeText={editFineness22} />
            </View>
          ) : null}
          <Animated.View style={{ transform: [{ translateX: shakeX22 }] }}>
            <GoldTextInput label="22K (₹/g)" keyboardType="numeric" value={rate22} onChangeText={editRate22} invalid={invalid22} />
          </Animated.View>
          {invalid22 ? (
            <ThemedText variant="small" color="#ef4444" style={{ marginTop: -8, marginBottom: 8 }}>
              ⚠ Price hierarchy is wrong.
            </ThemedText>
          ) : null}
          <ThemedText variant="small" color={colors.muted} style={{ marginTop: -8, marginBottom: 8 }}>
            {mode === "manual" ? "set independently of 24K" : "editing this switches to Manual"}
          </ThemedText>

          {mode === "auto" ? (
            <View style={{ marginBottom: 12 }}>
              <ThemedText variant="label" color={colors.muted}>Fineness ({finenessForKarat(18)}%)</ThemedText>
              <GoldTextInput keyboardType="numeric" value={fineness18} onChangeText={editFineness18} />
            </View>
          ) : null}
          <Animated.View style={{ transform: [{ translateX: shakeX18 }] }}>
            <GoldTextInput label="18K (₹/g)" keyboardType="numeric" value={rate18} onChangeText={editRate18} invalid={invalid18} />
          </Animated.View>
          {invalid18 ? (
            <ThemedText variant="small" color="#ef4444" style={{ marginTop: -8, marginBottom: 8 }}>
              ⚠ Price hierarchy is wrong.
            </ThemedText>
          ) : null}
          <ThemedText variant="small" color={colors.muted} style={{ marginTop: -8, marginBottom: 8 }}>
            {mode === "manual" ? "set independently of 24K" : "editing this switches to Manual"}
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
    </>
  );

  return (
    <ScreenContainer style={{ paddingHorizontal: 0 }}>
      <View style={{ flex: 1, paddingHorizontal: 16, paddingTop: 16 }}>
        <ExpandableTable<GoldRate>
          columns={RATE_COLUMNS}
          visibleCount={RATE_COLUMNS.length}
          data={rates}
          keyExtractor={(r) => String(r.id)}
          extraFields={rateExtraFields}
          headerContent={formHeader}
          loading={isLoading}
          emptyText={isError ? "Could not load gold rates." : "No rates published yet."}
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
