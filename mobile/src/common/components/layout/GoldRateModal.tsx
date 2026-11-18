import { useEffect, useState } from "react";
import { ScrollView, View } from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Buffering, C, CenterModal, ChipToggle, Field, Input, PrimaryButton, ReviewWarning, Txt, openPage, toast } from "@/common/components/ui";
import { latestGoldRate, publishGoldRates } from "@/modules/gold-rates/services/goldRateService";
import { useAuth } from "@/common/providers/AuthProvider";
import { inr } from "@/common/utils/format";
import { finenessFromRate, rateForFineness, FINENESS_24K } from "@/common/utils/purity";
import { userMessage } from "@/common/services/apiErrors";
import { FieldErr } from "@/common/components/ErrorText";
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
// Manual types each independently) for today — there is no date to pick. The rate history, with its search and
// Set By / Date filters, is the Gold Rates page (src/modules/gold-rates/pages/GoldRatesScreen.tsx), linked below the form.
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
  // Without "can create gold rate" there is nothing to set: the Gold Rates page (rates + history) opens instead.
  const canSetRate = can("Gold_Rate_Management", "can_create_gold_rate");
  const latest = useQuery({ queryKey: ["gold-rates", "latest"], queryFn: latestGoldRate, enabled: visible && canSetRate });
  const now: Record<Karat, number> = { 24: latest.data?.k24 ?? 0, 22: latest.data?.k22 ?? 0, 18: latest.data?.k18 ?? 0 };

  const [mode, setMode] = useState<RateMode>("Auto");
  const [ref24, setRef24] = useState(0);
  const [rates, setRates] = useState<Record<Karat, string>>({ 24: "", 22: "", 18: "" });
  const [fin, setFin] = useState<Record<Karat, string>>({ 24: String(FINENESS_24K), 22: savedFineness(22, now[24], now[22]), 18: savedFineness(18, now[24], now[18]) });
  const [lastEdited, setLastEdited] = useState<Karat | null>(null);
  const [tried, setTried] = useState(false);

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
    setTried(false);
  };

  useEffect(() => {
    if (!visible) return;
    if (!canSetRate) {
      onClose();
      openPage("/gold-rates");
      return;
    }
    if (latest.data) resetAuto(latest.data.k24 || 0);
  }, [visible, latest.data, canSetRate]);

  const openHistory = () => {
    onClose();
    openPage("/gold-rates");
  };

  const switchMode = (m: RateMode) => {
    if (m === "Auto") resetAuto(ref24 || now[24]);
    else {
      setMode("Manual");
      setLastEdited(null);
    }
  };

  const editRate = (k: Karat, v: string) => {
    setTried(false);
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
    setTried(false);
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
  const hierarchyMsg = bad2224 ? "22K above 24K." : bad1822 ? "18K above 22K." : bad1824 ? "18K above 24K." : null;

  const save = useMutation({
    mutationFn: async () => {
      const setBy = employee?.name ?? "Mobile App";
      // All three rates are published for today, even when they equal the current ones.
      const jobs = KARAT_ROWS.filter(({ k }) => n[k] > 0).map(({ k }) => ({ karat: k, rate: n[k] }));
      await publishGoldRates(Object.fromEntries(jobs.map((j) => [j.karat, j.rate])), setBy);
      return jobs;
    },
    onSuccess: (jobs) => {
      qc.invalidateQueries({ queryKey: ["gold-rates"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      toast.success("Gold rate updated", `${jobs.map((j) => `${j.karat}K ${inr(j.rate)}`).join(" · ")} per gram`);
      onClose();
    },
    onError: (e: Error) => toast.error(userMessage(e, "Save failed.")),
  });

  const canPublish = n[24] > 0 && n[22] > 0 && n[18] > 0;

  return (
    <CenterModal visible={visible} onClose={onClose} title="Gold Rate">
      {!canSetRate ? null : latest.isLoading ? (
          <Buffering block />
        ) : (
          <View style={{ flexShrink: 1 }}>
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
                <FieldErr m={tried && !(n[k] > 0) ? `Enter the ${k}K rate.` : undefined} />
              </View>
            ))}
            {hierarchyMsg ? <ReviewWarning>{hierarchyMsg}</ReviewWarning> : null}
            {/* The full rate history — search plus Set By / Date filters — is its own page. */}
            <PrimaryButton label="View Rate History" variant="outline" onPress={openHistory} style={{ marginTop: 6 }} />
          </ScrollView>
          {/* Sticky footer — the fields scroll, the button stays put. */}
          <View style={s.modalFooter}>
            <PrimaryButton label="Save New Rate" onPress={() => (canPublish ? save.mutate() : setTried(true))} loading={save.isPending} />
          </View>
          </View>
        )}
    </CenterModal>
  );
}
