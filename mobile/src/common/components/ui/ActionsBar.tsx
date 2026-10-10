import { Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { C } from "./base";
import { Txt } from "./Txt";
import { PIcon } from "./PIcon";
import { tabBarLift } from "@/common/theme/layout";
import { s } from "./shellContext";

type ActionsBarProps = {
  actions: { label: string; icon?: string; onPress: () => void; primary?: boolean; disabled?: boolean; tone?: "danger" }[];
};

/** .ld-actions-bar — floating pair (or trio) of buttons above the tab bar. */
export function ActionsBar({
  actions,
}: ActionsBarProps) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[s.ldBar, { bottom: 116 + tabBarLift(insets.bottom) }]} pointerEvents="box-none">
      {actions.map((a) => {
        const fg = a.primary ? "#fff" : a.tone === "danger" ? C.red : C.brandDeep;
        return (
          <Pressable
            key={a.label}
            disabled={a.disabled}
            onPress={a.onPress}
            style={[s.ldBtn, a.primary && s.ldBtnPrimary, a.disabled && { opacity: 0.45 }]}
          >
            {a.icon ? <PIcon name={a.icon} color={fg} /> : null}
            <Txt style={[s.ldBtnTxt, { color: fg }]}>{a.label}</Txt>
          </Pressable>
        );
      })}
    </View>
  );
}
