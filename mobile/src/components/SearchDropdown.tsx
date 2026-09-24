import React from "react";
import { View, Pressable, ScrollView, StyleSheet, ActivityIndicator } from "react-native";
import { GoldTextInput } from "./GoldTextInput";
import { ThemedText } from "./ThemedText";
import { Icon } from "./Icon";
import { colors } from "../theme/colors";

// Search-as-you-type picker. `open` is owned by the screen so it can close every
// dropdown on a tap outside: the screen closes on its own onTouchStart, and this
// component stops its own touches from bubbling up to that handler.
export function SearchDropdown<T>({
  label,
  placeholder,
  query,
  onQueryChange,
  open,
  onOpenChange,
  items,
  keyOf,
  renderItem,
  onSelect,
  loading,
  addLabel,
  onAdd,
  emptyText = "No matches",
}: {
  label?: string;
  placeholder?: string;
  query: string;
  onQueryChange: (q: string) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  items: T[];
  keyOf: (item: T) => string | number;
  renderItem: (item: T) => React.ReactNode;
  onSelect: (item: T) => void;
  loading?: boolean;
  /** Shown as a trailing "+ Add …" row when set (e.g. no exact match for the typed text). */
  addLabel?: string;
  onAdd?: () => void;
  emptyText?: string;
}) {
  return (
    <View onTouchStart={(e) => e.stopPropagation()}>
      <GoldTextInput
        label={label}
        placeholder={placeholder}
        value={query}
        onChangeText={(v) => {
          onQueryChange(v);
          if (!open) onOpenChange(true);
        }}
        onFocus={() => onOpenChange(true)}
        containerStyle={open ? { marginBottom: 0 } : undefined}
        right={
          <Pressable onPress={() => onOpenChange(!open)} hitSlop={12}>
            <View style={{ transform: [{ rotate: open ? "90deg" : "-90deg" }] }}>
              <Icon name="chevronLeft" size={14} color={colors.muted} />
            </View>
          </Pressable>
        }
      />
      {open ? (
        <View style={styles.container}>
          <ScrollView nestedScrollEnabled style={{ maxHeight: 220 }} keyboardShouldPersistTaps="handled">
            {loading && items.length === 0 ? (
              <View style={styles.row}>
                <ActivityIndicator color={colors.brand} />
              </View>
            ) : null}
            {items.map((item, i) => (
              <Pressable
                key={keyOf(item)}
                onPress={() => {
                  onSelect(item);
                  onOpenChange(false);
                }}
                style={[styles.row, i > 0 && styles.divider]}
              >
                {renderItem(item)}
              </Pressable>
            ))}
            {!loading && items.length === 0 && !addLabel ? (
              <View style={styles.row}>
                <ThemedText variant="small" color={colors.muted}>
                  {emptyText}
                </ThemedText>
              </View>
            ) : null}
            {addLabel && onAdd ? (
              <Pressable onPress={onAdd} style={[styles.row, items.length > 0 && styles.divider]}>
                <ThemedText variant="small" color={colors.brandDeep}>
                  {addLabel}
                </ThemedText>
              </Pressable>
            ) : null}
          </ScrollView>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginTop: 6,
    marginBottom: 14,
    backgroundColor: colors.bg,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.line,
    overflow: "hidden",
  },
  row: { paddingVertical: 10, paddingHorizontal: 12 },
  divider: { borderTopWidth: 1, borderTopColor: colors.line },
});
