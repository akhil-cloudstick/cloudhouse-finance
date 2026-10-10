import { Pressable, View } from "react-native";
import { Txt } from "./Txt";
import { s } from "./chipTones";

type GrmTabsProps<T extends string> = { tabs: readonly T[]; value: T; onChange: (v: T) => void; labels?: Partial<Record<T, string>> };

// ---- .grm-tabs (equal-width tabs inside a modal) --------------------------
export function GrmTabs<T extends string>({ tabs, value, onChange, labels }: GrmTabsProps<T>) {
  return (
    <View style={s.grmTabs}>
      {tabs.map((t) => {
        const active = t === value;
        return (
          <Pressable key={t} onPress={() => onChange(t)} style={[s.grmTab, active && s.grmTabActive]}>
            <Txt style={[s.grmTabTxt, active && { color: "#fff" }]}>{labels?.[t] ?? t}</Txt>
          </Pressable>
        );
      })}
    </View>
  );
}
