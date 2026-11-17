import React, { useState } from "react";
import { Pressable, View } from "react-native";
import { C, PIcon, Sheet, SheetListItem, Txt } from "@/common/components/ui";

export type GroupAction = { key: string; label: string; icon?: React.ComponentProps<typeof PIcon>["name"]; onPress: () => void; busy?: boolean; primary?: boolean; danger?: boolean };

type ActionGroupProps = { actions: GroupAction[]; style?: React.ComponentProps<typeof View>["style"]; maxVisible?: number; moreTitle?: string };

// Actions joined into one bordered bar (segments split by hairlines). Beyond `maxVisible`, the rest go behind a
// "More" segment that opens them in a sheet — still one grouped control.
export function ActionGroup({ actions, style, maxVisible = 3, moreTitle = "More actions" }: ActionGroupProps) {
  const [moreOpen, setMoreOpen] = useState(false);
  if (!actions.length) return null;
  const overflow = actions.length > maxVisible;
  const shown = overflow ? actions.slice(0, maxVisible - 1) : actions;
  const rest = overflow ? actions.slice(maxVisible - 1) : [];
  const segs: GroupAction[] = overflow ? [...shown, { key: "__more", label: "More", icon: "layers", onPress: () => setMoreOpen(true) }] : shown;
  return (
    <>
      <View style={[{ flexDirection: "row", borderWidth: 1, borderColor: C.line, borderRadius: 12, overflow: "hidden", backgroundColor: C.card }, style]}>
        {segs.map((a, i) => {
          const color = a.primary ? "#fff" : a.danger ? C.red : C.brandDeep;
          return (
            <Pressable
              key={a.key}
              onPress={a.onPress}
              disabled={a.busy}
              accessibilityRole="button"
              accessibilityLabel={a.label}
              style={{ flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 12, borderLeftWidth: i ? 1 : 0, borderLeftColor: C.line, backgroundColor: a.primary ? C.brandDeep : "transparent", opacity: a.busy ? 0.6 : 1 }}
            >
              {a.icon ? <PIcon name={a.icon} color={color} /> : null}
              <Txt style={{ fontSize: 12.5, fontWeight: "700", color }} numberOfLines={1}>{a.label}</Txt>
            </Pressable>
          );
        })}
      </View>
      {overflow ? (
        <Sheet visible={moreOpen} onClose={() => setMoreOpen(false)} title={moreTitle} maxHeightPct={60}>
          {rest.map((a, i) => (
            <SheetListItem
              key={a.key}
              first={i === 0}
              icon={a.icon ?? "doc"}
              title={a.label}
              onPress={() => {
                setMoreOpen(false);
                // Let the sheet close before the action opens its own.
                setTimeout(a.onPress, 250);
              }}
            />
          ))}
        </Sheet>
      ) : null}
    </>
  );
}
