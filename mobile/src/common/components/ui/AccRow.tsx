import React, { useContext, useId, useState } from "react";
import { LayoutAnimation, Pressable, View, type StyleProp, type ViewStyle } from "react-native";
import { C } from "./base";
import { Txt } from "./Txt";
import { PIcon } from "./PIcon";
import { type ChipTone } from "./chipTones";
import { StatusChip } from "./StatusChip";
import { AccDetail, AccAction, AccGroupContext, AccRowKey, s } from "./rowContext";
import { AccBtn } from "./AccBtn";

const expandAnim = () => LayoutAnimation.configureNext(LayoutAnimation.create(250, "easeInEaseOut", "opacity"));
type AccRowProps = {
  id?: string;
  idColor?: string;
  name: React.ReactNode;
  sub?: React.ReactNode;
  amount?: string;
  amountColor?: string;
  status?: string;
  statusTone?: ChipTone;
  details?: AccDetail[];
  actions?: AccAction[];
  defaultOpen?: boolean;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
};

/** .acc-row — the accordion table row every list in the prototype uses:
 * id | name + sub | amount + status chip | chevron, expanding to a 2-col
 * detail grid with action buttons. Pass `onPress` for rows that open a
 * detail sheet instead of expanding (lockers). */
export function AccRow({
  id,
  idColor,
  name,
  sub,
  amount,
  amountColor,
  status,
  statusTone,
  details,
  actions,
  defaultOpen,
  onPress,
  style,
}: AccRowProps) {
  const group = useContext(AccGroupContext);
  const itemKey = useContext(AccRowKey);
  const autoId = useId();
  const rowKey = itemKey ?? autoId;
  const [ownOpen, setOwnOpen] = useState(!!defaultOpen);
  const open = group ? (group.open === undefined ? !!defaultOpen : group.open === rowKey) : ownOpen;
  const setOpen = (next: boolean) => (group ? group.setOpen(next ? rowKey : null) : setOwnOpen(next));
  const expandable = !onPress && ((details && details.length > 0) || (actions && actions.length > 0));
  return (
    <View style={[s.row, style]}>
      <Pressable
        style={s.head}
        onPress={() => {
          if (onPress) return onPress();
          if (!expandable) return;
          expandAnim();
          setOpen(!open);
        }}
      >
        {id ? (
          <View style={s.lid}>
            <Txt style={[s.lidTxt, idColor ? { color: idColor } : null]} numberOfLines={1}>
              {id}
            </Txt>
          </View>
        ) : null}
        <View style={s.main}>
          {typeof name === "string" ? (
            <Txt style={s.name} numberOfLines={1}>
              {name}
            </Txt>
          ) : (
            name
          )}
          {sub ? (
            typeof sub === "string" ? (
              <Txt style={s.nameSub} numberOfLines={1}>
                {sub}
              </Txt>
            ) : (
              sub
            )
          ) : null}
        </View>
        {amount || status ? (
          <View style={s.right}>
            {amount ? <Txt style={[s.amt, amountColor ? { color: amountColor } : null]}>{amount}</Txt> : null}
            {status ? <StatusChip label={status} tone={statusTone} style={amount ? { marginTop: 5, alignSelf: "flex-end" } : { alignSelf: "flex-end" }} /> : null}
          </View>
        ) : null}
        <View style={[s.chev, open && { transform: [{ rotate: "90deg" }] }]}>
          <PIcon name="chevright" color={C.muted} />
        </View>
      </Pressable>
      {open && expandable ? (
        <View style={s.body}>
          <View style={s.detail}>
            {details?.map((d) => (
              <View key={d.k} style={s.detailCell}>
                <Txt style={s.k}>{d.k}</Txt>
                {typeof d.v === "string" || typeof d.v === "number" ? (
                  <Txt style={[s.v, d.color ? { color: d.color } : null]}>{d.v}</Txt>
                ) : (
                  d.v
                )}
              </View>
            ))}
            {actions && actions.length ? (
              <View style={s.actions}>
                {actions.map((a) => (
                  <AccBtn key={a.label} {...a} />
                ))}
              </View>
            ) : null}
          </View>
        </View>
      ) : null}
    </View>
  );
}
