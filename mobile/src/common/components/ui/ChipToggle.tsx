import { Pressable, View } from "react-native";
import { Txt } from "./Txt";
import { s } from "./chipTones";

type ChipToggleProps<T extends string> = {
  options: readonly T[];
  value: T;
  onChange: (v: T) => void;
  labels?: Partial<Record<T, string>>;
  wrap?: boolean;
};

// ---- .chip-toggle ---------------------------------------------------------
export function ChipToggle<T extends string>({
  options,
  value,
  onChange,
  labels,
  wrap,
}: ChipToggleProps<T>) {
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
