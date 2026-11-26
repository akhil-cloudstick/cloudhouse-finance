import { ScrollView, type StyleProp, type ViewStyle } from "react-native";
import { FilterChip } from "./FilterChip";
import { s } from "./chipTones";

type FilterChipRowProps<T extends string> = {
  options: readonly T[];
  value: T;
  onChange: (v: T) => void;
  labels?: Partial<Record<T, string>>;
  style?: StyleProp<ViewStyle>;
};

export function FilterChipRow<T extends string>({
  options,
  value,
  onChange,
  labels,
  style,
}: FilterChipRowProps<T>) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={[s.fchipRow, style]} keyboardShouldPersistTaps="handled">
      {options.map((o) => (
        <FilterChip key={o} label={labels?.[o] ?? o} active={o === value} onPress={() => onChange(o)} />
      ))}
    </ScrollView>
  );
}
