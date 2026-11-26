import { Pressable, View } from "react-native";
import { C } from "./base";
import { Txt } from "./Txt";
import { PIcon } from "./PIcon";
import { s } from "./cardStyles";

type QuickActionProps = { icon: string; label: string; tone: "loan" | "cust" | "pay"; onPress: () => void };

/** .qa-item — quick action circle. */
export function QuickAction({ icon, label, tone, onPress }: QuickActionProps) {
  const bg = tone === "loan" ? C.brandPale : tone === "cust" ? C.brandFaint : C.blueBg;
  const fg = tone === "loan" ? C.brandDeep : tone === "cust" ? C.brand : C.blue;
  return (
    <Pressable style={s.qaItem} onPress={onPress}>
      <View style={[s.qaCircle, { backgroundColor: bg }]}>
        <PIcon name={icon} color={fg} />
      </View>
      <Txt style={s.qaLabel}>{label}</Txt>
    </Pressable>
  );
}
