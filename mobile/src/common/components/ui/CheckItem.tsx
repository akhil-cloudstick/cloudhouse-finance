import { Pressable, View } from "react-native";
import { Txt } from "./Txt";
import { PIcon } from "./PIcon";
import { s } from "./formHelpers";

type CheckItemProps = {
  checked: boolean;
  onPress: () => void;
  title: string;
  sub?: string;
  variant?: "gold" | "confirm";
};

/** .confirm-toggle-item / .gold-checkbox-item */
export function CheckItem({
  checked,
  onPress,
  title,
  sub,
  variant = "gold",
}: CheckItemProps) {
  return (
    <Pressable onPress={onPress} style={[variant === "confirm" ? s.confirm : s.goldCb, checked && s.cbChecked]}>
      <View style={[s.cbBox, checked && s.cbBoxChecked]}>{checked ? <PIcon name="check" color="#fff" size={14} strokeWidth={3} /> : null}</View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Txt style={variant === "confirm" ? s.confirmTitle : s.cbTitle}>{title}</Txt>
        {sub ? <Txt style={s.cbSub}>{sub}</Txt> : null}
      </View>
    </Pressable>
  );
}
