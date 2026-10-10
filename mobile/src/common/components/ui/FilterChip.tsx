import { Pressable } from "react-native";
import { Txt } from "./Txt";
import { s } from "./chipTones";

type FilterChipProps = { label: string; active?: boolean; onPress: () => void };

// ---- .filter-chip / .filter-chip-row --------------------------------------
export function FilterChip({ label, active, onPress }: FilterChipProps) {
  return (
    <Pressable onPress={onPress} style={[s.fchip, active && s.fchipActive]}>
      <Txt style={[s.fchipTxt, active && s.fchipTxtActive]}>{label}</Txt>
    </Pressable>
  );
}
