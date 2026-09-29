import React, { useEffect, useState } from "react";
import { View, Pressable, StyleSheet } from "react-native";
import { ThemedText } from "./ThemedText";
import { GoldTextInput } from "./GoldTextInput";
import { GoldButton } from "./GoldButton";
import { BottomSheetModal, SheetScrollView } from "./BottomSheetModal";
import { colors } from "../theme/colors";
import { useTheme } from "../theme/ThemeProvider";
import { fmt } from "../lib/format";
import type { SplitAmounts } from "../api/investments";

// The backend requires cash + UPI + bank + cheque to add up to the amount
// (platform.ValidateSplit), so every payment/disbursement carries this split.

export const ZERO_SPLIT: SplitAmounts = { cashAmount: 0, upiAmount: 0, bankTransferAmount: 0, chequeAmount: 0 };

const MODES: { key: keyof SplitAmounts; label: string }[] = [
  { key: "cashAmount", label: "Cash" },
  { key: "upiAmount", label: "UPI" },
  { key: "bankTransferAmount", label: "Bank Transfer" },
  { key: "chequeAmount", label: "Cheque" },
];

const round2 = (n: number) => Math.round(n * 100) / 100;
export const splitTotal = (s: SplitAmounts) => round2(s.cashAmount + s.upiAmount + s.bankTransferAmount + s.chequeAmount);
export const isBalanced = (s: SplitAmounts, total: number) => Math.abs(splitTotal(s) - round2(total)) < 0.01;

/** Per-mode breakdown of `total`. A mode chip puts the whole amount in that
 * mode (and keeps following `total` as it changes); typing into any field
 * switches to a manual split. */
export function PaymentSplitInput({
  total,
  value,
  onChange,
}: {
  total: number;
  value: SplitAmounts;
  onChange: (s: SplitAmounts) => void;
}) {
  const { colors } = useTheme();
  const [single, setSingle] = useState<keyof SplitAmounts | null>("cashAmount");
  const [text, setText] = useState<Record<keyof SplitAmounts, string>>({ cashAmount: "", upiAmount: "", bankTransferAmount: "", chequeAmount: "" });

  useEffect(() => {
    if (!single) return;
    const next = { ...ZERO_SPLIT, [single]: round2(total || 0) };
    onChange(next);
    setText({ cashAmount: "", upiAmount: "", bankTransferAmount: "", chequeAmount: "", [single]: total ? String(round2(total)) : "" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [single, total]);

  const remaining = round2((total || 0) - splitTotal(value));

  return (
    <View style={{ marginBottom: 10 }}>
      <ThemedText variant="label" color={colors.muted} style={{ marginBottom: 6 }}>
        Payment breakdown
      </ThemedText>
      <View style={styles.chips}>
        {MODES.map((m) => {
          const on = single === m.key;
          return (
            <Pressable key={m.key} onPress={() => setSingle(m.key)} style={[styles.chip, on && { backgroundColor: colors.brandDeep, borderColor: colors.brandDeep }]}>
              <ThemedText variant="small" color={on ? colors.card : colors.ink}>
                All {m.label}
              </ThemedText>
            </Pressable>
          );
        })}
      </View>
      <View style={styles.grid}>
        {MODES.map((m) => (
          <GoldTextInput
            key={m.key}
            label={m.label}
            keyboardType="numeric"
            placeholder="0"
            value={text[m.key]}
            onChangeText={(v) => {
              setSingle(null);
              setText((t) => ({ ...t, [m.key]: v }));
              onChange({ ...value, [m.key]: Number(v) || 0 });
            }}
            containerStyle={styles.cell}
          />
        ))}
      </View>
      <View style={styles.remainRow}>
        <ThemedText variant="small" color={colors.muted}>
          Total {fmt(total || 0)}
        </ThemedText>
        <ThemedText variant="small" color={Math.abs(remaining) < 0.01 ? colors.green : colors.red} style={{ fontWeight: "600" }}>
          {Math.abs(remaining) < 0.01 ? "Balanced" : remaining > 0 ? `${fmt(remaining)} left to assign` : `${fmt(-remaining)} over`}
        </ThemedText>
      </View>
    </View>
  );
}

/** Rise-up sheet that collects the breakdown for a fixed amount, e.g. a loan
 * disbursement, then confirms. */
export function PaymentBreakdownSheet({
  visible,
  onClose,
  title,
  subtitle,
  total,
  confirmLabel,
  onConfirm,
  loading,
  error,
}: {
  visible: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  total: number;
  confirmLabel: string;
  onConfirm: (split: SplitAmounts) => void;
  loading?: boolean;
  error?: string | null;
}) {
  const [split, setSplit] = useState<SplitAmounts>(ZERO_SPLIT);
  const balanced = isBalanced(split, total);
  return (
    <BottomSheetModal visible={visible} onClose={onClose} maxHeightPct={90}>
      <SheetScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        <ThemedText variant="h3" style={{ marginBottom: 4 }}>
          {title}
        </ThemedText>
        {subtitle ? (
          <ThemedText variant="small" color={colors.muted} style={{ marginBottom: 14 }}>
            {subtitle}
          </ThemedText>
        ) : null}
        <PaymentSplitInput total={total} value={split} onChange={setSplit} />
        {error ? (
          <ThemedText variant="small" color={colors.red} style={{ marginBottom: 10 }}>
            {error}
          </ThemedText>
        ) : null}
        <GoldButton title={confirmLabel} onPress={() => onConfirm(split)} loading={loading} disabled={!balanced} style={{ marginBottom: 8 }} />
      </SheetScrollView>
    </BottomSheetModal>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 12 },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.card,
  },
  grid: { flexDirection: "row", flexWrap: "wrap", columnGap: 8 },
  cell: { width: "48%" },
  remainRow: { flexDirection: "row", justifyContent: "space-between", marginTop: -4 },
});
