import React, { useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import {
  Buffering,
  C,
  EmptyText,
  FlatHeader,
  HeroBackground,
  PIcon,
  PScroll,
  PrimaryButton,
  Screen,
  Sheet,
  Spinner,
  StatusChip,
  Txt,
} from "../../../src/components/ui";
import { getBillingStatus, getBranchQuota } from "../../../src/api/billing";
import {
  BILLING_PLANS,
  FEATURES,
  branchLabel,
  findPlanIndex,
  formatRupees,
  type BillingPlan,
} from "../../../src/config/features";

// Billing & Plan — the staff-app twin of the web's Billing plan ladder
// (frontend/product/pages/billing/components/PlanUpgrade.tsx). Plans come
// from the env file (src/config/features.ts) and are branch-count tiers with
// a one-time price; moving up a tier pays only the difference. The upgrade
// is simulated (UI-only for now), so the new plan lives in local state.
// Reached from More, which shows the row only with the Billing permission
// and EXPO_PUBLIC_ENABLE_PLAN_UPGRADE on.

const STEPS = ["Checking your plan", "Confirming payment", "Raising your branch limit"];
const STEP_MS = 850;

type Phase = "confirm" | "processing" | "done";

function UpgradeSheet({
  from,
  to,
  onClose,
  onUpgraded,
}: {
  from: BillingPlan;
  to: BillingPlan | null;
  onClose: () => void;
  onUpgraded: (plan: BillingPlan) => void;
}) {
  const [phase, setPhase] = useState<Phase>("confirm");
  const [step, setStep] = useState(0);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  // The last target stays rendered while the sheet animates closed.
  const [shown, setShown] = useState<BillingPlan | null>(to);
  const [paidFrom, setPaidFrom] = useState(from);
  if (to && to !== shown) {
    setShown(to);
    setPaidFrom(from);
    setPhase("confirm");
    setStep(0);
  }
  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  if (!shown) return null;
  const target = shown;
  const toPay = Math.max(0, target.price - paidFrom.price);

  function run() {
    setPhase("processing");
    STEPS.forEach((_, i) => timers.current.push(setTimeout(() => setStep(i + 1), STEP_MS * (i + 1))));
    timers.current.push(
      setTimeout(() => {
        setPhase("done");
        onUpgraded(target);
      }, STEP_MS * STEPS.length + 400)
    );
  }

  const busy = phase === "processing";
  return (
    <Sheet
      visible={to !== null}
      onClose={busy ? () => {} : onClose}
      title={phase === "confirm" ? "Upgrade plan" : busy ? "Upgrading" : "Plan upgraded"}
      maxHeightPct={80}
    >
      {phase === "confirm" ? (
        <>
          <View style={s.fromTo}>
            <View style={s.tile}>
              <Txt style={s.tileK}>NOW</Txt>
              <Txt style={s.tileN}>{paidFrom.name}</Txt>
              <Txt style={s.tileS}>{branchLabel(paidFrom.branches)}</Txt>
            </View>
            <View style={s.arrow}><PIcon name="chevright" color={C.brandDeep} size={16} /></View>
            <View style={[s.tile, s.tileTo]}>
              <Txt style={s.tileK}>NEW</Txt>
              <Txt style={s.tileN}>{target.name}</Txt>
              <Txt style={s.tileS}>{branchLabel(target.branches)}</Txt>
            </View>
          </View>
          <View style={s.sum}>
            <View style={s.row}><Txt style={s.rowK}>{target.name}</Txt><Txt style={s.rowV}>{formatRupees(target.price)}</Txt></View>
            <View style={[s.row, s.rowLine]}><Txt style={s.rowK}>Already paid</Txt><Txt style={s.rowV}>− {formatRupees(paidFrom.price)}</Txt></View>
            <View style={[s.row, s.rowTotal]}><Txt style={[s.rowK, { color: C.ink }]}>To pay now</Txt><Txt style={s.total}>{formatRupees(toPay)}</Txt></View>
          </View>
          <Txt style={s.fine}>One-time payment. No renewals. Your branches, staff and data stay as they are.</Txt>
          <PrimaryButton label={`Pay ${formatRupees(toPay)} & upgrade`} onPress={run} />
        </>
      ) : busy ? (
        <View style={s.proc}>
          <Spinner size={40} />
          <Txt style={s.procT}>Upgrading to {target.name}</Txt>
          <View style={{ gap: 10, alignSelf: "stretch", paddingHorizontal: 24 }}>
            {STEPS.map((label, i) => (
              <View key={label} style={s.step}>
                <View style={[s.stepDot, i < step && s.stepOk, i === step && s.stepOn]}>
                  {i < step ? <PIcon name="check" color="#fff" size={11} strokeWidth={3} /> : null}
                </View>
                <Txt style={[s.stepTxt, i <= step && { color: C.ink }]}>{label}</Txt>
              </View>
            ))}
          </View>
        </View>
      ) : (
        <>
          <View style={s.proc}>
            <View style={s.doneRing}><View style={s.doneDot}><PIcon name="check" color="#fff" size={22} strokeWidth={3} /></View></View>
            <Txt style={s.procT}>You&apos;re on {target.name}</Txt>
            <Txt style={s.procS}>{target.branches === 0 ? "Open as many branches as you need." : `Your branch limit is now ${target.branches}.`}</Txt>
          </View>
          <PrimaryButton label="Done" onPress={onClose} />
        </>
      )}
    </Sheet>
  );
}

export default function BillingScreen() {
  const status = useQuery({ queryKey: ["billing", "status"], queryFn: getBillingStatus, enabled: FEATURES.planUpgrade });
  // Usage is optional: a role without branch access just doesn't see it.
  const quota = useQuery({ queryKey: ["branches", "quota"], queryFn: getBranchQuota, enabled: FEATURES.planUpgrade, retry: false });
  const [upgradedTo, setUpgradedTo] = useState<number | null>(null);
  const [target, setTarget] = useState<BillingPlan | null>(null);

  const header = <FlatHeader title="Billing & Plan" subtitle="Your plan and branch limit" back />;

  if (!FEATURES.planUpgrade) {
    return <Screen header={header}><EmptyText>Plan upgrades aren&apos;t available yet.</EmptyText></Screen>;
  }
  if (status.isPending) {
    return <Screen header={header}><Buffering style={{ paddingVertical: 30 }} /></Screen>;
  }
  if (status.isError) {
    return <Screen header={header}><EmptyText>Couldn&apos;t load your plan. Go back and open Billing &amp; Plan again.</EmptyText></Screen>;
  }

  const cur = upgradedTo ?? findPlanIndex(status.data.tierName, quota.data?.quota);
  const plan = BILLING_PLANS[cur];
  const unlimited = plan.branches === 0;
  const used = quota.data?.used ?? null;
  const atLimit = !unlimited && used !== null && used >= plan.branches;
  const onTop = cur === BILLING_PLANS.length - 1;
  const fill = unlimited || used === null ? 0 : Math.min(100, (used / plan.branches) * 100);

  return (
    <Screen header={header}>
      <PScroll
        refreshing={status.isRefetching}
        onRefresh={() => { status.refetch(); quota.refetch(); }}
        contentContainerStyle={{ paddingHorizontal: 18, paddingTop: 14, gap: 12 }}
      >
        <View style={s.hero}>
          <HeroBackground />
          <Txt style={s.heroK}>CURRENT PLAN</Txt>
          <Txt style={s.heroN}>{plan.name}</Txt>
          <Txt style={s.heroS}>{unlimited ? "No limit on branches" : `Up to ${branchLabel(plan.branches)}`}</Txt>
          <View style={s.bar}>
            <View style={[s.barFill, { width: `${fill}%` }, atLimit && { backgroundColor: C.accent }]} />
          </View>
          <View style={s.heroRow}>
            <Txt style={s.heroSmall}>
              {used === null ? "" : unlimited ? `${used} branches in use` : `${Math.min(used, plan.branches)} of ${plan.branches} branches in use`}
            </Txt>
            <Txt style={s.heroSmall}>Paid {formatRupees(plan.price)}</Txt>
          </View>
        </View>

        {atLimit && !onTop ? (
          <View style={s.note}>
            <PIcon name="alert" color={C.amber} size={16} />
            <Txt style={s.noteTxt}>You&apos;re using every branch on this plan. Upgrade to open more.</Txt>
          </View>
        ) : null}

        <Txt style={s.label}>PLANS · ONE-TIME PAYMENT</Txt>
        {BILLING_PLANS.map((p, i) => {
          const isCur = i === cur;
          const lower = i < cur;
          return (
            <View key={p.id} style={[s.plan, isCur && s.planCur, lower && { opacity: 0.6 }]}>
              <View style={[s.num, isCur && { backgroundColor: C.brand }]}>
                <Txt style={[s.numTxt, isCur && { color: "#fff" }]}>{p.branches === 0 ? "∞" : p.branches}</Txt>
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Txt style={s.planN}>{p.name}</Txt>
                <Txt style={s.planS}>{formatRupees(p.price)} one-time</Txt>
              </View>
              {isCur ? (
                <StatusChip label="Current" tone="info" />
              ) : lower ? (
                <StatusChip label="Included" tone="closed" />
              ) : (
                <Pressable style={s.upBtn} onPress={() => setTarget(p)} accessibilityLabel={`Upgrade to ${p.name}`}>
                  <Txt style={s.upTxt}>Upgrade</Txt>
                </Pressable>
              )}
            </View>
          );
        })}
        <Txt style={s.hint}>{onTop ? "You're on the highest plan." : "You only pay the difference when you move up a tier."}</Txt>
      </PScroll>

      <UpgradeSheet
        from={plan}
        to={target}
        onClose={() => setTarget(null)}
        onUpgraded={(p) => setUpgradedTo(BILLING_PLANS.indexOf(p))}
      />
    </Screen>
  );
}

const s = StyleSheet.create({
  hero: { borderRadius: 20, padding: 18, overflow: "hidden" },
  heroK: { fontSize: 10, fontWeight: "700", letterSpacing: 2, color: "rgba(255,255,255,0.75)" },
  heroN: { fontSize: 22, fontWeight: "800", color: "#fff", marginTop: 4 },
  heroS: { fontSize: 12.5, color: "rgba(255,255,255,0.8)", marginTop: 2 },
  bar: { height: 7, borderRadius: 7, backgroundColor: "rgba(255,255,255,0.22)", marginTop: 14, marginBottom: 8, overflow: "hidden" },
  barFill: { height: "100%", borderRadius: 7, backgroundColor: "#fff" },
  heroRow: { flexDirection: "row", justifyContent: "space-between" },
  heroSmall: { fontSize: 12, color: "rgba(255,255,255,0.9)" },
  note: { flexDirection: "row", gap: 10, backgroundColor: C.amberBg, borderRadius: 14, padding: 12, alignItems: "flex-start" },
  noteTxt: { flex: 1, color: C.amber, fontSize: 12.5 },
  label: { fontSize: 11, fontWeight: "700", letterSpacing: 0.66, color: C.muted, marginTop: 6 },
  plan: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: C.card, borderWidth: 1, borderColor: C.line, borderRadius: 16, padding: 14 },
  planCur: { borderWidth: 1.5, borderColor: C.brand, backgroundColor: C.brandFaint },
  num: { width: 46, height: 46, borderRadius: 14, backgroundColor: C.brandPale, alignItems: "center", justifyContent: "center" },
  numTxt: { fontSize: 18, fontWeight: "800", color: C.brandDeep },
  planN: { fontSize: 14, fontWeight: "700", color: C.ink },
  planS: { fontSize: 12, color: C.muted, marginTop: 1 },
  upBtn: { height: 34, paddingHorizontal: 14, borderRadius: 10, backgroundColor: C.brand, justifyContent: "center" },
  upTxt: { color: "#fff", fontWeight: "700", fontSize: 12.5 },
  hint: { fontSize: 12, color: C.muted, marginHorizontal: 2 },
  fromTo: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 14 },
  tile: { flex: 1, borderWidth: 1, borderColor: C.line, borderRadius: 12, padding: 10 },
  tileTo: { borderColor: C.brand, backgroundColor: C.brandFaint },
  tileK: { fontSize: 9.5, fontWeight: "700", letterSpacing: 1.6, color: C.muted },
  tileN: { fontSize: 13.5, fontWeight: "700", color: C.ink, marginTop: 2 },
  tileS: { fontSize: 11.5, color: C.muted },
  arrow: { width: 28, height: 28, borderRadius: 14, backgroundColor: C.brandPale, alignItems: "center", justifyContent: "center" },
  sum: { backgroundColor: C.bg, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 4 },
  row: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 9 },
  rowLine: { borderTopWidth: 1, borderTopColor: C.line, borderStyle: "dashed" },
  rowTotal: { borderTopWidth: 1, borderTopColor: C.line, alignItems: "center" },
  rowK: { fontSize: 13, color: C.muted },
  rowV: { fontSize: 13, fontWeight: "600", color: C.ink },
  total: { fontSize: 18, fontWeight: "800", color: C.brandDeep },
  fine: { fontSize: 12, color: C.muted, marginTop: 12, marginBottom: 14 },
  proc: { alignItems: "center", gap: 14, paddingVertical: 18 },
  procT: { fontSize: 17, fontWeight: "800", color: C.ink, textAlign: "center" },
  procS: { fontSize: 13, color: C.muted, textAlign: "center" },
  step: { flexDirection: "row", alignItems: "center", gap: 10 },
  stepDot: { width: 18, height: 18, borderRadius: 9, borderWidth: 2, borderColor: C.line, alignItems: "center", justifyContent: "center" },
  stepOn: { borderColor: C.brand },
  stepOk: { borderColor: C.green, backgroundColor: C.green },
  stepTxt: { fontSize: 13, color: C.muted },
  doneRing: { width: 62, height: 62, borderRadius: 31, backgroundColor: C.greenBg, alignItems: "center", justifyContent: "center" },
  doneDot: { width: 44, height: 44, borderRadius: 22, backgroundColor: C.green, alignItems: "center", justifyContent: "center" },
});
