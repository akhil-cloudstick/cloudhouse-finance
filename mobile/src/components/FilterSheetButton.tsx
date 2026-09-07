import React, { useState } from "react";
import { View, Pressable, StyleSheet } from "react-native";
import { ThemedText } from "./ThemedText";
import { Icon } from "./Icon";
import { BottomSheetModal } from "./BottomSheetModal";
import { colors } from "../theme/colors";

// Shared "Filters" trigger + bottom sheet for a page-level status filter —
// replaces a horizontal chip row (ScrollView or ChipSelect's own flex-wrap)
// sitting directly on the screen. Two problems that pattern had once a
// filter list ran past a handful of short options: a horizontal ScrollView
// version could run wider than the screen with no visible affordance that
// there was more off to the side (see Loans.tsx's original bug), and even
// ChipSelect's flex-wrap version ate a full row of vertical space above the
// table permanently, active or not. This collapses to one small button
// (plus a dismissible pill showing the active filter, if any isn't the
// default) regardless of how many options there are, and the picker itself
// gets the whole sheet to lay out in rather than squeezing sideways.
//
// Not for a 2-option view-mode toggle (Active Cases/Auction History-style
// tabs) — those stay ChipSelect, since collapsing something you flip
// between constantly behind an extra tap is a regression, not an
// improvement. This is for an actual filter: several options, one of which
// ("All"/the first option) is the common "no filter" case most sessions
// never change away from.
export function FilterSheetButton<T extends string>({
  label = "Filters",
  options,
  value,
  onChange,
  defaultValue,
}: {
  /** Trigger button text — defaults to "Filters"; pass e.g. "Filter" to
   * match a specific screen's existing wording. */
  label?: string;
  options: readonly T[];
  value: T;
  onChange: (v: T) => void;
  /** The option that counts as "no filter applied" — suppresses the active-
   * filter pill and is what its × clears back to. Defaults to `options[0]`
   * (this app's convention: the least-restrictive option always leads,
   * e.g. Loans' "All" or Auctions' "Auction Eligible"). */
  defaultValue?: T;
}) {
  const [sheetVisible, setSheetVisible] = useState(false);
  const noFilter = defaultValue ?? options[0];
  const isFiltered = value !== noFilter;

  return (
    <>
      <View style={styles.row}>
        <Pressable onPress={() => setSheetVisible(true)} style={styles.trigger}>
          <Icon name="list" size={15} color={colors.goldDeep} />
          <ThemedText variant="label" color={colors.goldDeep}>
            {label}
          </ThemedText>
        </Pressable>
        {isFiltered ? (
          <Pressable onPress={() => onChange(noFilter)} style={styles.activePill}>
            <ThemedText variant="small" numberOfLines={1} color={colors.ivory}>
              {value}
            </ThemedText>
            <ThemedText variant="small" color={colors.ivory} style={{ marginLeft: 6 }}>
              ×
            </ThemedText>
          </Pressable>
        ) : null}
      </View>

      <BottomSheetModal visible={sheetVisible} onClose={() => setSheetVisible(false)}>
        <ThemedText variant="h3" style={{ marginBottom: 12 }}>
          {label === "Filters" ? "Filter by Status" : label}
        </ThemedText>
        <View style={styles.grid}>
          {options.map((opt) => {
            const active = opt === value;
            return (
              <Pressable
                key={opt}
                onPress={() => {
                  onChange(opt);
                  setSheetVisible(false);
                }}
                style={[styles.chip, active && styles.chipActive]}
              >
                <ThemedText variant="small" numberOfLines={1} color={active ? colors.ivory : colors.ink}>
                  {opt}
                </ThemedText>
              </Pressable>
            );
          })}
        </View>
      </BottomSheetModal>
    </>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 8 },
  trigger: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    height: 36,
    borderWidth: 1,
    borderColor: colors.goldDeep,
    backgroundColor: colors.goldPale,
    borderRadius: 18,
    paddingHorizontal: 14,
  },
  activePill: {
    flexDirection: "row",
    alignItems: "center",
    height: 36,
    borderRadius: 18,
    paddingHorizontal: 12,
    backgroundColor: colors.goldDeep,
  },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 8, paddingBottom: 8 },
  chip: {
    flexShrink: 0,
    height: 36,
    justifyContent: "center",
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.card,
    borderRadius: 18,
    paddingHorizontal: 14,
  },
  chipActive: { backgroundColor: colors.goldDeep, borderColor: colors.goldDeep },
});
