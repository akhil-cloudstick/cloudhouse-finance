import { Pressable, View } from "react-native";
import { Txt } from "./Txt";
import { s } from "./chipTones";

type SubTabsProps<T extends string> = { tabs: readonly T[]; value: T; onChange: (v: T) => void; labels?: Partial<Record<T, string>> };

// ---- .subtab-row ----------------------------------------------------------
export function SubTabs<T extends string>({ tabs, value, onChange, labels }: SubTabsProps<T>) {
  // Equal widths so every option stays on screen, however long its label.
  return (
    <View style={s.subRow}>
      {tabs.map((t) => {
        const active = t === value;
        return (
          <Pressable key={t} onPress={() => onChange(t)} style={[s.subTab, { flex: 1, alignItems: "center" }, active && s.subTabActive]}>
            <Txt style={[s.subTabTxt, active && s.subTabTxtActive]} numberOfLines={1} adjustsFontSizeToFit>
              {labels?.[t] ?? t}
            </Txt>
          </Pressable>
        );
      })}
    </View>
  );
}
