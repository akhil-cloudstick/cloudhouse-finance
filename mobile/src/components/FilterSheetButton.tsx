import React, { useState } from "react";
import { View, Pressable, StyleSheet } from "react-native";
import { ThemedText } from "./ThemedText";
import { Icon } from "./Icon";
import { BottomSheetModal } from "./BottomSheetModal";
import { colors } from "../theme/colors";
import { useTheme } from "../theme/ThemeProvider";

// Shared "Filters" trigger + bottom sheet for a page-level status filter —
// replaces a horizontal chip row (ScrollView or ChipSelect's own flex-wrap)
// sitting directly on the screen. Two problems that pattern had once a
// filter list ran past a handful of short options: a horizontal ScrollView
// version could run wider than the screen with no visible affordance that
// there was more off to the side (see Loans.tsx's original bug), and even
// ChipSelect's flex-wrap version ate a full row of vertical space above the
// table permanently, active or not. This collapses to one small button
// (showing the active filter inside itself, if any isn't the
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
  /** The option that counts as "no filter applied" — the button shows its
   * plain label while this is selected, and a tap on an applied filter
   * resets back to it. Defaults to `options[0]`
   * (this app's convention: the least-restrictive option always leads,
   * e.g. Loans' "All" or Auctions' "Auction Eligible"). */
  defaultValue?: T;
}) {
  const { colors } = useTheme();
  const [sheetVisible, setSheetVisible] = useState(false);
  const noFilter = defaultValue ?? options[0];
  const isFiltered = value !== noFilter;

  return (
    <>
      <View style={styles.row}>
        {/* Shows just the current selection (same styling either way).
            Tapping while a filter is applied resets it; with no filter
            applied it opens the options. */}
        <Pressable onPress={() => (isFiltered ? onChange(noFilter) : setSheetVisible(true))} style={[styles.trigger, { borderColor: colors.brandDeep, backgroundColor: colors.brandPale }]}>
          <Icon name="list" size={15} color={colors.brandDeep} />
          <ThemedText variant="label" color={colors.brandDeep} numberOfLines={1}>
            {isFiltered ? value : label}
          </ThemedText>
          {isFiltered ? (
            <ThemedText variant="label" color={colors.brandDeep}>
              ×
            </ThemedText>
          ) : (
            <View style={{ transform: [{ rotate: "-90deg" }] }}>
              <Icon name="chevronLeft" size={11} color={colors.brandDeep} />
            </View>
          )}
        </Pressable>
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
                style={[styles.chip, active && { backgroundColor: colors.brandDeep, borderColor: colors.brandDeep }]}
              >
                <ThemedText variant="small" numberOfLines={1} color={active ? colors.bg : colors.ink}>
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
    borderRadius: 18,
    paddingHorizontal: 14,
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
});
