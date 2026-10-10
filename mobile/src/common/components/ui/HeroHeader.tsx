import { useContext, useMemo, useRef } from "react";
import { Animated, Image, Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Txt } from "./Txt";
import { PIcon } from "./PIcon";
import { setOverlayOrigin } from "./overlayOrigin";
import { HEADER_LOGO } from "@/common/config/brand";
import { HeroBackground } from "./HeroBackground";
import { s, HeroMorphContext } from "./shellContext";

type HeroHeaderProps = {
  /** No longer shown (the profile avatar was removed from the header). */
  initials?: string;
  name: string;
  branch?: string;
  cashLabel?: string;
  cashValue: string;
  rates: { k: string; v: string }[];
  rateChange?: string;
  onRatePress?: () => void;
  onSearch: () => void;
  /** Omitted → no bell (the user can't view reminders). */
  onBell?: () => void;
  bellDot?: boolean;
  onAvatar?: () => void;
  segments: string[];
  activeSegment: string;
  onSegment: (s: string) => void;
};

/** .a-header — Dashboard hero: identity row, cash in hand, gold rate row,
 * Overview / Activity segment. */
export function HeroHeader({
  name,
  branch,
  cashLabel = "Cash in hand",
  cashValue,
  rates,
  rateChange,
  onRatePress,
  onSearch,
  onBell,
  bellDot,
  onAvatar,
  segments,
  activeSegment,
  onSegment,
}: HeroHeaderProps) {
  const insets = useSafeAreaInsets();
  const searchBtn = useRef<View>(null);
  // While collapsing, the logo stays where the flat header's logo sits, the
  // name and icons fade as the page title fades in over them, and the body
  // (cash, rates, segment) slides up under the rising bottom edge.
  const morph = useContext(HeroMorphContext);
  const fx = useMemo(
    () =>
      morph && {
        top: { opacity: morph.p.interpolate({ inputRange: [0, 0.5], outputRange: [1, 0], extrapolate: "clamp" }) },
        body: {
          opacity: morph.p.interpolate({ inputRange: [0, 0.6], outputRange: [1, 0], extrapolate: "clamp" }),
          transform: [{ translateY: Animated.multiply(Animated.multiply(morph.p, morph.lift), -0.5) }],
        },
      },
    [morph]
  );
  return (
    <View style={[s.aHeader, { paddingTop: insets.top + 12 }]}>
      <HeroBackground />
      <View style={s.aTopRow}>
        <Pressable style={s.aId} onPress={onAvatar} hitSlop={4}>
          <Image source={HEADER_LOGO} style={s.flatLogo} resizeMode="contain" accessibilityLabel="CloudHouse" />
          <Animated.View style={fx?.top}>
            <Txt style={s.aName}>{name}</Txt>
            {branch ? <Txt style={s.aBranch}>{branch}</Txt> : null}
          </Animated.View>
        </Pressable>
        <Animated.View style={[s.aIcons, fx?.top]}>
          <Pressable
            ref={searchBtn}
            style={s.aIcBtn}
            onPressIn={() =>
              // The search panel grows out of this icon.
              searchBtn.current?.measureInWindow((x, y, w, h) => setOverlayOrigin({ x: x + w / 2, y: y + h / 2 }))
            }
            onPress={onSearch}
            accessibilityLabel="Search"
          >
            <PIcon name="search" color="#fff" />
          </Pressable>
          {onBell ? (
            <Pressable style={s.aIcBtn} onPress={onBell} accessibilityLabel="Reminders">
              <PIcon name="bell" color="#fff" />
              {bellDot ? <View style={s.aDot} /> : null}
            </Pressable>
          ) : null}
        </Animated.View>
      </View>
      <Animated.View style={fx?.body}>
      <View style={s.aHero}>
        <Txt style={s.aHeroL}>{cashLabel}</Txt>
        <Txt style={s.aHeroV}>{cashValue}</Txt>
      </View>
      <Pressable style={s.rateRow} onPress={onRatePress}>
        <View style={{ flexDirection: "row", flexShrink: 1 }}>
          {rates.map((r, i) => (
            <View key={r.k} style={[s.rateSeg, i > 0 && s.rateSegNext]}>
              <Txt style={s.rateK}>{r.k}</Txt>
              <Txt style={s.rateV}>{r.v}</Txt>
            </View>
          ))}
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          {rateChange ? <Txt style={s.rateChange}>{rateChange}</Txt> : null}
          <View style={{ opacity: 0.7 }}>
            <PIcon name="chevron" color="#fff" />
          </View>
        </View>
      </Pressable>
      <View style={s.aSegment}>
        {segments.map((seg) => {
          const active = seg === activeSegment;
          return (
            <Pressable key={seg} style={[s.aSegItem, active && s.aSegItemActive]} onPress={() => onSegment(seg)}>
              <Txt style={[s.aSegTxt, active && s.aSegTxtActive]}>{seg}</Txt>
            </Pressable>
          );
        })}
      </View>
      </Animated.View>
    </View>
  );
}
