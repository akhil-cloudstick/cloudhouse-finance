import { Pressable, StyleSheet, View } from "react-native";
import { Txt } from "./Txt";
import { C } from "./base";
import { s } from "./chipTones";

type ChipToggleProps<T extends string> = {
  options: readonly T[];
  value: T;
  onChange: (v: T) => void;
  labels?: Partial<Record<T, string>>;
  wrap?: boolean;
  /** "segmented" (default) is the original single-track toggle; "chips" renders separate bordered pills. */
  variant?: "segmented" | "chips";
};

type ChipMultiSelectProps<T extends string> = {
  options: readonly T[];
  value: readonly T[];
  onChange: (v: T[]) => void;
  labels?: Partial<Record<T, string>>;
};

const cs = StyleSheet.create({
  row: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { paddingVertical: 8, paddingHorizontal: 14, borderRadius: 999, backgroundColor: C.card, borderWidth: 1, borderColor: C.line },
  chipActive: { backgroundColor: C.brandDeep, borderColor: C.brandDeep },
  chipTxt: { fontSize: 12.5, fontWeight: "700", color: C.muted },
  chipTxtActive: { color: "#fff" },
});

// ---- .chip-toggle ---------------------------------------------------------
export function ChipToggle<T extends string>({
  options,
  value,
  onChange,
  labels,
  wrap,
  variant = "segmented",
}: ChipToggleProps<T>) {
  if (variant === "chips") {
    return (
      <View style={cs.row}>
        {options.map((o) => {
          const active = o === value;
          return (
            <Pressable key={o} accessibilityRole="button" accessibilityState={{ selected: active }} onPress={() => onChange(o)} style={[cs.chip, active && cs.chipActive]}>
              <Txt style={[cs.chipTxt, active && cs.chipTxtActive]} numberOfLines={1}>
                {labels?.[o] ?? o}
              </Txt>
            </Pressable>
          );
        })}
      </View>
    );
  }
  return (
    <View style={[s.toggle, wrap && { flexWrap: "wrap" }]}>
      {options.map((o) => {
        const active = o === value;
        return (
          <Pressable key={o} onPress={() => onChange(o)} style={[s.toggleItem, wrap && { minWidth: "45%" }, active && s.toggleItemActive]}>
            <Txt style={[s.toggleTxt, active && s.toggleTxtActive]} numberOfLines={1}>
              {labels?.[o] ?? o}
            </Txt>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Multi-select counterpart of ChipToggle's "chips" look — tap a chip to add / remove it. */
export function ChipMultiSelect<T extends string>({ options, value, onChange, labels }: ChipMultiSelectProps<T>) {
  return (
    <View style={cs.row}>
      {options.map((o) => {
        const active = value.includes(o);
        return (
          <Pressable
            key={o}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            onPress={() => onChange(active ? value.filter((x) => x !== o) : [...value, o])}
            style={[cs.chip, active && cs.chipActive]}
          >
            <Txt style={[cs.chipTxt, active && cs.chipTxtActive]} numberOfLines={1}>
              {labels?.[o] ?? o}
            </Txt>
          </Pressable>
        );
      })}
    </View>
  );
}
