import { useEffect, useState } from "react";
import { Animated, Easing, Pressable, ScrollView, View, type StyleProp, type ViewStyle } from "react-native";
import { Txt } from "./Txt";
import { s } from "./chipTones";

type PillTabsProps<T extends string> = {
  tabs: readonly T[];
  value: T;
  onChange: (v: T) => void;
  labels?: Partial<Record<T, string>>;
  style?: StyleProp<ViewStyle>;
  /** Inside a modal body: static, no gutter/border (pl-detail tabs). */
  inSheet?: boolean;
};

// ---- .cust-tabs (sticky pill tabs) ----------------------------------------
export function PillTabs<T extends string>({
  tabs,
  value,
  onChange,
  labels,
  style,
  inSheet,
}: PillTabsProps<T>) {
  // Two or three tabs split the width equally with a sliding highlight;
  // longer sets keep the horizontally scrolling pills.
  if (tabs.length <= 3) return <SegmentTabs tabs={tabs} value={value} onChange={onChange} labels={labels} style={style} inSheet={inSheet} />;
  return (
    <View style={[inSheet ? s.pillTabsSheet : s.pillTabs, style]}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={[s.pillTabsInner, inSheet && { paddingHorizontal: 0 }]}>
        {tabs.map((t) => {
          const active = t === value;
          return (
            <Pressable key={t} onPress={() => onChange(t)} style={[s.pillTab, active && s.pillTabActive]}>
              <Txt style={[s.pillTabTxt, active && s.pillTabTxtActive]}>{labels?.[t] ?? t}</Txt>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}
type SegmentTabsProps<T extends string> = {
  tabs: readonly T[];
  value: T;
  onChange: (v: T) => void;
  labels?: Partial<Record<T, string>>;
  style?: StyleProp<ViewStyle>;
  inSheet?: boolean;
};

/** Equal-width segmented tabs; the active highlight glides between them. */
function SegmentTabs<T extends string>({
  tabs,
  value,
  onChange,
  labels,
  style,
  inSheet,
}: SegmentTabsProps<T>) {
  const [w, setW] = useState(0);
  const idx = Math.max(0, tabs.indexOf(value));
  const [x] = useState(() => new Animated.Value(idx));
  useEffect(() => {
    Animated.timing(x, { toValue: idx, duration: 240, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, [idx, x]);
  const seg = w > 0 ? (w - 6) / tabs.length : 0;
  return (
    <View style={[inSheet ? s.pillTabsSheet : s.pillTabs, style]}>
      <View style={[s.segTrack, inSheet && { marginHorizontal: 0 }]} onLayout={(e) => setW(e.nativeEvent.layout.width)}>
        {seg > 0 ? (
          <Animated.View
            pointerEvents="none"
            style={[s.segThumb, { width: seg, transform: [{ translateX: x.interpolate({ inputRange: [0, 1], outputRange: [0, seg] }) }] }]}
          />
        ) : null}
        {tabs.map((t) => {
          const active = t === value;
          return (
            <Pressable key={t} onPress={() => onChange(t)} style={s.segItem} accessibilityRole="tab" accessibilityState={{ selected: active }}>
              <Txt style={[s.pillTabTxt, active && s.pillTabTxtActive]} numberOfLines={1}>
                {labels?.[t] ?? t}
              </Txt>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
