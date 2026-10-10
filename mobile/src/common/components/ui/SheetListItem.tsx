import React from "react";
import { Pressable, View } from "react-native";
import { C } from "./base";
import { Txt } from "./Txt";
import { PIcon } from "./PIcon";
import { s } from "./rowContext";

type SheetListItemProps = {
  icon: string;
  title: string;
  sub?: string;
  onPress: () => void;
  warn?: boolean;
  first?: boolean;
  right?: React.ReactNode;
};

/** .sheet-list-item — actions / documents / More / cash actions. */
export function SheetListItem({
  icon,
  title,
  sub,
  onPress,
  warn,
  first,
  right,
}: SheetListItemProps) {
  return (
    <Pressable style={[s.sli, !first && s.sliBorder]} onPress={onPress}>
      <View style={[s.sliIc, warn && { backgroundColor: C.redBg }]}>
        <PIcon name={icon} color={warn ? C.red : C.brandDeep} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Txt style={s.sliTitle}>{title}</Txt>
        {sub ? <Txt style={s.sliSub}>{sub}</Txt> : null}
      </View>
      {right ?? <PIcon name="chevright" color={C.muted} />}
    </Pressable>
  );
}
