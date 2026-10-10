import { Pressable, View } from "react-native";
import { initialsOf } from "./base";
import { Txt } from "./Txt";
import { s } from "./rowContext";

type ActItemProps = { title: string; sub: string; amount?: string; amountColor?: string; avatar?: string; first?: boolean; onPress?: () => void };

/** .act-item — dashboard activity / stored packets. */
export function ActItem({ title, sub, amount, amountColor, avatar, first, onPress }: ActItemProps) {
  return (
    <Pressable disabled={!onPress} onPress={onPress} style={[s.act, !first && s.actBorder]}>
      <View style={s.actAvatar}>
        <Txt style={s.actAvatarTxt}>{avatar ?? initialsOf(title)}</Txt>
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Txt style={s.actTitle} numberOfLines={1}>
          {title}
        </Txt>
        <Txt style={s.actSub} numberOfLines={1}>
          {sub}
        </Txt>
      </View>
      {amount ? <Txt style={[s.actAmt, amountColor ? { color: amountColor } : null]}>{amount}</Txt> : null}
    </Pressable>
  );
}
