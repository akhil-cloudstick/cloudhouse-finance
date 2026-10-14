import { useEffect, useState } from "react";
import { ScrollView, View } from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Buffering, C, CenterModal, ChipToggle, Field, GrmTabs, Input, PrimaryButton, RepayItem, ReviewWarning, ServerFlatList, Txt, WarningBanner, toast } from "@/common/components/ui";
import { useServerList } from "@/common/hooks/use-server-list";
import { latestGoldRate, listGoldRatesPage, publishGoldRates } from "@/modules/gold-rates/services/goldRateService";
import { useAuth } from "@/common/providers/AuthProvider";
import { dmy, inr } from "@/common/utils/format";
import { finenessFromRate, rateForFineness, FINENESS_24K } from "@/common/utils/purity";
import type { GoldRate } from "@/modules/gold-rates/types/gold-rate-types";
import { userMessage } from "@/common/services/apiErrors";
import { s } from "./shellModalsShared";

// ---------------------------------------------------------------------------
// Gold Rate (prototype #gold-modal): Set Rate / History
//
// Same rules as the web RateModal and the pre-redesign mobile screen. Mode
// is all-or-nothing across the three karats:
// - Auto (default): 22K/18K derive live off 24K at an editable fineness %
//   (prefilled with karat/24). 24K's fineness is fixed at 99.9% (999) and
//   read-only — it labels the reference rate rather than scaling it.
// - Manual: every karat is typed independently. Typing straight into the
//   22K or 18K rate switches to Manual; typing 24K does not.
// Only karats whose rate actually changed are published, together as one history row.
//
// Set Rate lets staff set all three karats (Auto derives 22K/18K off 24K;
// Manual types each independently); the History tab lists all three karats with who published them.
// ---------------------------------------------------------------------------
type RateMode = "Auto" | "Manual";
type Karat = 24 | 22 | 18;
const KARAT_ROWS: { k: Karat; label: string }[] = [
  { k: 24, label: "24K · 999" },
  { k: 22, label: "22K · 916" },
  { k: 18, label: "18K · 750" },
];
// Fineness isn't stored — restore what the last published rates imply
// (rate ÷ 24K) rather than the standard karat/24 ratio, so a custom fineness
// set earlier is still showing when the modal is reopened.
const savedFineness = (k: Karat, k24: number, rate: number) => (k === 24 ? String(FINENESS_24K) : String(finenessFromRate(k24, rate, k)));
const clampFineness = (v: string) => (v !== "" && +v > 100 ? "100" : v);
type GoldRateModalProps = { visible: boolean; onClose: () => void };

export function GoldRateModal({ visible, onClose }: GoldRateModalProps) {
  const qc = useQueryClient();
  const { employee, can } = useAuth();
  // Without "can create gold rate" the modal is history-only.
  const canSetRate = can("Gold_Rate_Management", "can_create_gold_rate");
  const [tab, setTab] = useState<"set" | "history">(canSetRate ? "set" : "history");
  const latest = useQuery({ queryKey: ["gold-rates", "latest"], queryFn: latestGoldRate, enabled: visible });
  const now: Record<Karat, number> = { 24: latest.data?.k24 ?? 0, 22: latest.data?.k22 ?? 0, 18: latest.data?.k18 ?? 0 };

  const [mode, setMode] = useState<RateMode>("Auto");
  const [ref24, setRef24] = useState(0);
  const [rates, setRates] = useState<Record<Karat, string>>({ 24: "", 22: "", 18: "" });
  const [fin, setFin] = useState<Record<Karat, string>>({ 24: String(FINENESS_24K), 22: savedFineness(22, now[24], now[22]), 18: savedFineness(18, now[24], now[18]) });
  const [lastEdited, setLastEdited] = useState<Karat | null>(null);
  const [error, setError] = useState<string | null>(null);

  const resetAuto = (k24: number) => {
    setMode("Auto");
    setRef24(k24);
    const f22 = savedFineness(22, now[24], now[22]);
    const f18 = savedFineness(18, now[24], now[18]);
    setFin({ 24: String(FINENESS_24K), 22: f22, 18: f18 });
    setRates({
      24: k24 > 0 ? String(Math.round(k24)) : "",
      22: k24 > 0 ? String(rateForFineness(k24, +f22)) : "",
      18: k24 > 0 ? String(rateForFineness(k24, +f18)) : "",
    });
    setLastEdited(null);
    setError(null);
  };

  useEffect(() => {
    if (!visible) return;
    setTab(canSetRate ? "set" : "history");
    if (latest.data) resetAuto(latest.data.k24 || 0);
  }, [visible, latest.data, canSetRate]);

  const switchMode = (m: RateMode) => {
    if (m === "Auto") resetAuto(ref24 || now[24]);
    else {
      setMode("Manual");
      setLastEdited(null);
    }
  };

  const editRate = (k: Karat, v: string) => {
    setError(null);
    setLastEdited(k);
    if (k !== 24) {
      setMode("Manual");
      setRates((r) => ({ ...r, [k]: v }));
      return;
    }
    const k24 = +v;
    setRates((r) =>
      mode === "Auto" && k24 > 0
        ? {
            24: v,
            22: +fin[22] > 0 ? String(rateForFineness(k24, +fin[22])) : r[22],
            18: +fin[18] > 0 ? String(rateForFineness(k24, +fin[18])) : r[18],
          }
        : { ...r, 24: v }
    );
  };

  // 22K/18K only — 24K's fineness is fixed (FINENESS_24K, read-only field).
  const editFineness = (k: Karat, v: string) => {
    if (k === 24) return;
    const c = clampFineness(v);
    setError(null);
    setFin((f) => ({ ...f, [k]: c }));
    if (!(+c > 0)) return;
    setRates((r) => (+r[24] > 0 ? { ...r, [k]: String(rateForFineness(+r[24], +c)) } : r));
  };

  // Non-blocking sanity check (Manual only): a lower karat priced above a
  // purer one inverts the purity hierarchy. Flagged on the field just typed.
  const n: Record<Karat, number> = { 24: +rates[24], 22: +rates[22], 18: +rates[18] };
  const bad2224 = mode === "Manual" && n[22] > 0 && n[24] > 0 && n[22] > n[24];
  const bad1822 = mode === "Manual" && n[18] > 0 && n[22] > 0 && n[18] > n[22];
  const bad1824 = mode === "Manual" && n[18] > 0 && n[24] > 0 && n[18] > n[24];
  const invalid: Record<Karat, boolean> = {
    24: lastEdited === 24 && (bad2224 || bad1824),
    22: lastEdited === 22 && bad2224,
    18: lastEdited === 18 && (bad1822 || bad1824),
  };
  const hierarchyMsg = bad2224 ? "22K is priced above 24K." : bad1822 ? "18K is priced above 22K." : bad1824 ? "18K is priced above 24K." : null;

  const history = useServerList<GoldRate>({
    key: ["gold-rates", "history"],
    fetchPage: (p) => listGoldRatesPage({ limit: p.limit, offset: p.offset }),
    enabled: visible && tab === "history",
  });

  const save = useMutation({
    mutationFn: async () => {
      const setBy = employee?.name ?? "Mobile App";
      const jobs = KARAT_ROWS.filter(({ k }) => n[k] > 0 && Math.round(n[k]) !== Math.round(now[k])).map(({ k }) => ({ karat: k, rate: n[k] }));
      if (!jobs.length) throw new Error("Nothing has changed from the current rates.");
      await publishGoldRates(Object.fromEntries(jobs.map((j) => [j.karat, j.rate])), setBy);
      return jobs;
    },
    onSuccess: (jobs) => {
      qc.invalidateQueries({ queryKey: ["gold-rates"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      toast.success("Gold rate updated", `${jobs.map((j) => `${j.karat}K ${inr(j.rate)}`).join(" · ")} per gram`);
      onClose();
    },
    onError: (e: Error) => setError(userMessage(e, "Could not save the rate — try again.")),
  });

  const canPublish = n[24] > 0 && n[22] > 0 && n[18] > 0;
  // Height the Set Rate tab laid out at — the History tab reuses it.
  const [setTabH, setSetTabH] = useState(0);

  return (
    <CenterModal visible={visible} onClose={onClose} title="Gold Rate">
      {canSetRate ? <GrmTabs tabs={["set", "history"] as const} value={tab} onChange={setTab} labels={{ set: "Set Rate", history: "History" }} /> : null}
      {tab === "set" && canSetRate ? (
        latest.isLoading ? (
          <Buffering block />
        ) : (
          <View style={{ flexShrink: 1 }} onLayout={(e) => setSetTabH(e.nativeEvent.layout.height)}>
          <ScrollView
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            style={{ flexShrink: 1 }}
            contentContainerStyle={{ paddingTop: 14, paddingHorizontal: 16, paddingBottom: 10 }}
          >
            <View style={s.rateNow}>
              {KARAT_ROWS.map(({ k }) => (
                <View key={k} style={{ flex: 1, alignItems: "center" }}>
                  <Txt style={s.rateNowK}>{k}K now</Txt>
                  <Txt style={s.rateNowV}>{now[k] ? inr(Math.round(now[k])) : "—"}</Txt>
                </View>
              ))}
            </View>
            <Field label="Mode">
              <ChipToggle options={["Auto", "Manual"] as const} value={mode} onChange={switchMode} />
            </Field>
            <Txt style={s.modeHint}>
              {mode === "Auto" ? "22K and 18K follow 24K at their fineness %. Typing a 22K/18K rate switches to Manual." : "Each karat is set independently of 24K."}
            </Txt>
            {KARAT_ROWS.map(({ k, label }) => (
              <View key={k} style={[s.karatRow, invalid[k] && { borderColor: C.red }]}>
                <Txt style={s.karatLbl}>{label}</Txt>
                <View style={{ flexDirection: "row", gap: 10 }}>
                  {mode === "Auto" ? (
                    <Field label="Fineness %" style={{ flex: 1, marginBottom: 0 }}>
                      <Input keyboardType="decimal-pad" value={fin[k]} onChangeText={(v) => editFineness(k, v)} editable={k !== 24} />
                    </Field>
                  ) : null}
                  <Field label="Rate (₹/g)" style={{ flex: 1.3, marginBottom: 0 }}>
                    <Input keyboardType="decimal-pad" value={rates[k]} onChangeText={(v) => editRate(k, v)} style={invalid[k] ? { borderColor: C.red } : undefined} />
                  </Field>
                </View>
              </View>
            ))}
            {hierarchyMsg ? <ReviewWarning>{`Price hierarchy looks wrong: ${hierarchyMsg} You can still save if this is intended.`}</ReviewWarning> : null}
            {error ? <WarningBanner>{error}</WarningBanner> : null}
          </ScrollView>
          {/* Sticky footer — the fields scroll, the button stays put. */}
          <View style={s.modalFooter}>
            <PrimaryButton label="Save New Rate" onPress={() => save.mutate()} loading={save.isPending} disabled={!canPublish} />
          </View>
          </View>
        )
      ) : (
        // Same height as the Set Rate tab, so switching tabs never resizes
        // the pop-up (both stay within the card's 76% screen cap).
        <View style={setTabH ? { height: setTabH } : { maxHeight: 420 }}>
          <ServerFlatList
            list={history}
            items={history.items}
            inSheet
            gutter={16}
            emptyText="No rate history yet."
            keyOf={(r) => String(r.id)}
            renderItem={(r, i) => (
              <RepayItem
                first={i === 0}
                label={`${dmy(r.date || r.createdAt)}${r.setBy ? ` · ${r.setBy}` : ""}`}
                value={`24K ${inr(r.k24)} · 22K ${inr(r.k22)} · 18K ${inr(r.k18)}`}
                valueColor={C.ink}
                style={s.histRow}
              />
            )}
          />
        </View>
      )}
    </CenterModal>
  );
}
