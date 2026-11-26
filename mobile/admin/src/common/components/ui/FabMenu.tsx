import { useState } from "react";
import { Animated, Pressable, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { C } from "./base";
import { Txt } from "./Txt";
import { PIcon } from "./PIcon";
import { tabBarLift } from "@/common/theme/layout";
import { FabMenuAction, FAB_CAPTION_H, s } from "./shellContext";

type FabMenuProps = {
  actions: FabMenuAction[];
  label?: string;
  /** Extra lift, to clear an ActionsBar showing under the button. */
  raise?: number;
};

export function FabMenu({
  actions,
  label = "More actions",
  raise = 0,
}: FabMenuProps) {
  const insets = useSafeAreaInsets();
  const [open, setOpen] = useState(false);
  const [anim] = useState(() => new Animated.Value(0));
  const toggle = (next: boolean) => {
    setOpen(next);
    Animated.spring(anim, {
      toValue: next ? 1 : 0,
      damping: 20,
      stiffness: 260,
      mass: 0.9,
      overshootClamping: !next,
      useNativeDriver: true,
    }).start();
  };
  const bottom = 96 + FAB_CAPTION_H + tabBarLift(insets.bottom) + raise;
  return (
    <>
      {open ? <Pressable style={[StyleSheet.absoluteFill, { zIndex: 44 }]} onPress={() => toggle(false)} accessibilityLabel="Close actions" /> : null}
      <Animated.View
        pointerEvents={open ? "auto" : "none"}
        style={[
          s.fabMenu,
          { bottom: bottom - 6 },
          {
            opacity: anim.interpolate({ inputRange: [0, 0.4, 1], outputRange: [0, 1, 1] }),
            transformOrigin: "bottom",
            transform: [
              { translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [16, 0] }) },
              { scaleY: anim.interpolate({ inputRange: [0, 1], outputRange: [0.35, 1] }) },
              { scaleX: anim.interpolate({ inputRange: [0, 1], outputRange: [0.85, 1] }) },
            ],
          },
        ]}
      >
        {actions.map((a) => (
          <Pressable
            key={a.label}
            style={({ pressed }) => [s.fabMenuItem, pressed && { opacity: 0.6 }]}
            onPress={() => {
              toggle(false);
              a.onPress();
            }}
            accessibilityLabel={a.label}
            accessibilityState={a.active ? { selected: true } : undefined}
          >
            <View style={[s.fabMenuIc, a.active && s.fabMenuIcOn]}>
              <PIcon name={a.icon} color={a.active ? "#fff" : C.brandDeep} />
              {a.dot ? <View style={s.fabMenuDot} /> : null}
            </View>
            <Txt style={[s.fabMenuLbl, a.active && { color: C.brand }]} numberOfLines={2}>
              {a.label}
            </Txt>
          </Pressable>
        ))}
        {/* room for the toggle button, which sits over the panel's foot */}
        <View style={{ height: 58 }} />
      </Animated.View>
      <Pressable style={[s.fab, { bottom }]} onPress={() => toggle(!open)} accessibilityLabel={open ? "Close actions" : label}>
        <Animated.View style={{ transform: [{ rotate: anim.interpolate({ inputRange: [0, 1], outputRange: ["180deg", "0deg"] }) }] }}>
          <PIcon name="chevdown" color="#fff" />
        </Animated.View>
      </Pressable>
    </>
  );
}
