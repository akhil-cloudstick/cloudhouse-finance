import { Pressable, View } from "react-native";
import { C } from "./base";
import { Txt } from "./Txt";
import { PIcon } from "./PIcon";
import { Avatar } from "./Avatar";
import { s } from "./rowContext";

type CustRowProps = { name: string; sub: string; onPress: () => void };

/** .cust-row */
export function CustRow({ name, sub, onPress }: CustRowProps) {
  return (
    <Pressable style={s.custRow} onPress={onPress}>
      <Avatar name={name} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Txt style={s.custName} numberOfLines={1}>
          {name}
        </Txt>
        <Txt style={s.custSub} numberOfLines={1}>
          {sub}
        </Txt>
      </View>
      <PIcon name="chevright" color={C.muted} />
    </Pressable>
  );
}
