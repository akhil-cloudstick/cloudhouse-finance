import { useContext, useEffect, useMemo, useRef, useState } from "react";
import { Animated, Image, Pressable, StyleSheet, View, type HostInstance } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Txt } from "./Txt";
import { PIcon } from "./PIcon";
import { setOverlayOrigin } from "./overlayOrigin";
import { HEADER_LOGO } from "@/common/config/brand";
import { HeroBackground } from "./HeroBackground";import { s, HeroMorphContext } from "./shellContext";
import { onWindowSizeChange } from "@/common/theme/layout";

/** The Dashboard's scroll offset (PScroll `scrollY`, native thread). As the page scrolls up the hero
 * shrinks to its top row — logo, name, search, bell — and grows back when scrolled to the top. */
export const heroScroll = new Animated.Value(0);
// The slim header's bottom padding (s.flatHeader), so the collapsed hero ends where it would.
const COLLAPSED_PAD = 14;
// Last measured sizes, shared by every hero instance. A hero that mounts again (swiping back to the
// Dashboard) starts with its final animation values instead of measuring first and then swapping
// them in mid-swipe — that swap made the header jump for a frame.
let lastFullH = 0;
let lastTopRowBottom = 0;
onWindowSizeChange(() => {
  lastFullH = 0;
  lastTopRowBottom = 0;
});
// Height of a page's (slim) header, measured by HeaderHost. The hero collapses to exactly this, so
// handing over to a page header never shows the bottom edge jump by the few pixels they differ.
let slimH = 0;
export function setSlimHeaderHeight(h: number) {
  slimH = Math.round(h);
}

// Collapsed by scroll (or not) decides how the header changes when the page does: a collapsed hero
// is already a slim header, so it changes like any other page header (a cross-fade, nothing moves);
// an open hero plays its own collapse / grow transition. HeaderHost checks heroCollapsed() when a
// change starts and sets heroMorphGate: 1 = hero transition, 0 = plain header cross-fade.
let lastRange = 0;
let heroY = 0;
let gateCollapsed = false;
export const heroMorphGate = new Animated.Value(1);
/** Fully collapsed = the hero is exactly a slim page header (a partly collapsed one still plays the
 * hero transition, which carries any amount of collapse smoothly). */
export function heroCollapsed() {
  return lastRange > 0 && heroY >= lastRange - 1;
}
/** How far the Dashboard scrolls before its hero is fully slim (0 until measured). */
export function heroCollapseRange() {
  return lastRange;
}
/** The Dashboard's scroll offset as seen on the JS side (the native one drives heroScroll). The gate
 * flips here, as the page scrolls — not when a swipe starts: the pages move a few pixels before JS
 * hears of the swipe, and in those pixels a collapsed header used to begin the hero transition and
 * then snap back to the cross-fade (a bob at the start). */
export function noteHeroScroll(y: number) {
  heroY = y;
  syncHeroGate();
}
/** Sets heroMorphGate from the current collapse; returns whether the hero is fully collapsed. */
export function syncHeroGate() {
  const collapsed = heroCollapsed();
  if (collapsed !== gateCollapsed) {
    gateCollapsed = collapsed;
    heroMorphGate.setValue(collapsed ? 0 : 1);
  }
  return collapsed;
}

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
  cashLabel = "Cash In Hand",
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
  const searchBtn = useRef<HostInstance>(null);
  // While collapsing, the logo stays where the flat header's logo sits, the
  // name and icons fade as the page title fades in over them, and the body
  // (cash, rates, segment) slides up under the rising bottom edge.
  const morph = useContext(HeroMorphContext);

  // Scroll collapse: how far the bottom edge can rise = full height − (top row + slim padding).
  const padTop = insets.top + 12;
  const [fullH, setFullH] = useState(lastFullH);
  const [topRowBottom, setTopRowBottom] = useState(lastTopRowBottom);
  // Whole pixels, so sub-pixel layout noise never rebuilds the animation.
  const measureFull = (h: number) => {
    lastFullH = Math.round(h);
    setFullH(lastFullH);
  };
  const measureTopRow = (bottom: number) => {
    lastTopRowBottom = Math.round(bottom);
    setTopRowBottom(lastTopRowBottom);
  };
  // Collapse to a page header's measured height; until one has been seen, to the top row + padding.
  const target = slimH > 0 ? slimH : topRowBottom > 0 ? padTop + topRowBottom + COLLAPSED_PAD : 0;
  const range = fullH > 0 && target > 0 ? Math.max(0, fullH - target) : 0;
  useEffect(() => {
    if (range > 0) {
      lastRange = range;
      syncHeroGate();
    }
  }, [range]);
  const collapse = useMemo(() => {
    if (range <= 0) return null;
    const rise = heroScroll.interpolate({ inputRange: [0, range], outputRange: [0, range], extrapolate: "clamp" });
    // In the hero transition (gate 1) leaving the Dashboard (morph.p → 1) hands over to that
    // transition's own clip. In a plain cross-fade (gate 0) the collapsed header just stays put.
    const amount = morph
      ? Animated.multiply(
          rise,
          Animated.subtract(1, Animated.multiply(morph.p.interpolate({ inputRange: [0, 1], outputRange: [0, 1], extrapolate: "clamp" }), heroMorphGate))
        )
      : rise;
    return {
      // The edge (this view, rounded + clipped) rises while its content is held in place.
      edge: { transform: [{ translateY: Animated.multiply(amount, -1) }] },
      hold: { transform: [{ translateY: amount }] },
      bodyFade: heroScroll.interpolate({ inputRange: [0, range * 0.7], outputRange: [1, 0], extrapolate: "clamp" }),
      bodyLift: Animated.multiply(amount, -0.5),
    };
  }, [range, morph]);

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
  // The body (cash, rates, segment) slides up and fades as the edge rises over it, and as the
  // hero collapses into another page's header.
  const bodyStyle = useMemo(() => {
    if (!collapse) return fx?.body;
    const opacity = fx ? Animated.multiply(fx.body.opacity, collapse.bodyFade) : collapse.bodyFade;
    const lift = fx ? Animated.add(fx.body.transform[0].translateY, collapse.bodyLift) : collapse.bodyLift;
    return { opacity, transform: [{ translateY: lift }] };
  }, [collapse, fx]);

  return (
    <Animated.View style={[s.aHeader, { paddingTop: padTop }, collapse?.edge]} onLayout={(e) => measureFull(e.nativeEvent.layout.height)}>
      <Animated.View style={[StyleSheet.absoluteFill, collapse?.hold]} pointerEvents="none">
        <HeroBackground />
      </Animated.View>
      <Animated.View style={collapse?.hold}>
      <View style={s.aTopRow} onLayout={(e) => measureTopRow(e.nativeEvent.layout.y + e.nativeEvent.layout.height)}>
        <Pressable style={[s.aId, { flexShrink: 1, minWidth: 0, marginRight: 8 }]} onPress={onAvatar} hitSlop={4}>
          <Image source={HEADER_LOGO} style={s.flatLogo} resizeMode="contain" accessibilityLabel="CloudHouse" />
          <Animated.View style={[{ flexShrink: 1, minWidth: 0 }, fx?.top]}>
            <Txt style={s.aName} numberOfLines={1}>{name}</Txt>
            {branch ? <Txt style={s.aBranch} numberOfLines={1}>{branch}</Txt> : null}
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
      <Animated.View style={bodyStyle} pointerEvents="box-none">
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
      </Animated.View>
    </Animated.View>
  );
}
