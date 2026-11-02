import React, { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Animated, Easing, View } from "react-native";
import { HeroHeader } from "./HeroHeader";
import { headerStore, HeroMorph, s, HeroMorphContext, setTallHeaderCheck, tabsRef } from "./shellContext";
import { PRIMARY_ROUTES, swipe } from "./swipeStore";

setTallHeaderCheck((node) => React.isValidElement(node) && node.type === HeroHeader);

// Material "standard" curve: eases in and out, so the header neither jumps
// off at the start nor stops dead at the end. Close to the page slide (220ms)
// so the header and the page finish together.
// Whether the previous focused page was a primary tab (see HeaderHost).
const track = { prev: true };
const HEADER_MS = 170;
const HEADER_EASE = Easing.out(Easing.cubic);
type HeroClipProps = {
  morph: HeroMorph;
  style?: object;
  pointerEvents?: "box-none" | "none";
  onLayout?: (h: number) => void;
  children: React.ReactNode;
};

/** The hero inside a clip whose bottom edge rises by `lift × p` while the
 * hero itself stays put (the clip moves up, its content moves back down by
 * the same amount). HeroHeader reads the same values to slide its body. */
function HeroClip({
  morph,
  style,
  pointerEvents = "box-none",
  onLayout,
  children,
}: HeroClipProps) {
  const shift = useMemo(() => {
    const d = Animated.multiply(morph.p, morph.lift);
    return { up: Animated.multiply(d, -1), down: d };
  }, [morph]);
  return (
    <Animated.View
      pointerEvents={pointerEvents}
      style={[s.heroClip, style, { transform: [{ translateY: shift.up }] }]}
      onLayout={onLayout && ((e) => onLayout(e.nativeEvent.layout.height))}
    >
      <Animated.View pointerEvents={pointerEvents} style={{ transform: [{ translateY: shift.down }] }}>
        <HeroMorphContext.Provider value={morph}>{children}</HeroMorphContext.Provider>
      </Animated.View>
    </Animated.View>
  );
}
type Morph = { dir: "collapse"; hero: React.ReactNode } | { dir: "expand"; flat: React.ReactNode };
/** Mounted once by app/(tabs)/_layout.tsx, after the navigator.
 *
 * Leaving the Dashboard, the hero collapses into the page's flat header: its
 * bottom edge rises to the flat header's bottom while the cash / rates /
 * segment body slides up under it and fades, the logo holds still (it sits
 * in the same spot in both headers), and the page's title fades in over the
 * hero's name. Coming back plays the same thing in reverse — the edge drops,
 * the body slides down into view and the page header fades off the top.
 * The swap is spotted during render (the node's type changes), so the
 * outgoing header is kept in that same frame — no blank header between.
 * Every animation runs on the native driver, so a heavy page mounting
 * underneath can't make the header stutter. */
export function HeaderHost() {
  const node = useSyncExternalStore(headerStore.subscribe, headerStore.get, headerStore.get);
  const tall = React.isValidElement(node) && node.type === HeroHeader;
  // Last measured height of each kind of header (0 until first seen).
  const [heights, setHeights] = useState({ tall: 0, short: 0 });
  // The most recent header of each kind, kept to play the outgoing side.
  const [heroNode, setHeroNode] = useState<React.ReactNode>(tall ? node : null);
  if (tall && heroNode !== node) setHeroNode(node);
  const [flatNode, setFlatNode] = useState<React.ReactNode>(tall ? null : node);
  if (!tall && flatNode !== node) setFlatNode(node);

  // p = timed + driven. Between two primary tabs the page position (swipe.pos)
  // IS the hero's progress — the hero collapses and drops exactly with the
  // page, whether swiped or tapped. Only transitions with a More page, which
  // slides by the navigator's own clock, use the timed part.
  const [timed] = useState(() => new Animated.Value(0));
  const [morph] = useState<HeroMorph>(() => ({
    p: Animated.add(timed, swipe.pos.interpolate({ inputRange: [0, 1], outputRange: [0, 1], extrapolate: 'clamp' })),
    lift: new Animated.Value(0),
  }));
  const focusedPrimary = () => {
    const st = tabsRef.state;
    return !!st && PRIMARY_ROUTES.includes(st.routes[st.index]?.name);
  };
  // With both heights known the hero's travel is fixed, so it can follow the page from the first frame of a swipe.
  useEffect(() => {
    if (heights.tall && heights.short) morph.lift.setValue(heights.tall - heights.short);
  }, [heights, morph]);
  // The flat header fades in over the back half of a collapse (and out over
  // the front half of an expand).
  const [flatFade] = useState(() => morph.p.interpolate({ inputRange: [0.2, 0.75], outputRange: [0, 1], extrapolate: "clamp" }));
  const [running, setRunning] = useState<Morph | null>(null);
  const started = useRef<Morph | null>(null);

  // Each side mounts fresh on a swap (tall and short render different trees),
  // so the values set here are already in place on the frame it first draws.
  const [prevTall, setPrevTall] = useState(tall);
  if (prevTall !== tall) {
    setPrevTall(tall);
    timed.stopAnimation();
    const driven = track.prev && focusedPrimary();
    if (!tall && heights.tall && heroNode) {
      timed.setValue(0);
      if (heights.short) morph.lift.setValue(heights.tall - heights.short);
      setRunning({ dir: "collapse", hero: heroNode });
    } else if (tall && heights.tall && heights.short && flatNode) {
      timed.setValue(driven ? 0 : 1);
      morph.lift.setValue(heights.tall - heights.short);
      setRunning({ dir: "expand", flat: flatNode });
    } else {
      timed.setValue(tall ? 0 : 1);
      setRunning(null);
    }
  }

  const onLayout = (h: number) => {
    if (h <= 0) return;
    const kind = tall ? "tall" : "short";
    if (heights[kind] !== h) setHeights((prev) => ({ ...prev, [kind]: h }));
    // The collapse starts toward a plain placeholder header; the page's real header (subtitle,
    // back button) can be a different height once it lands — re-aim the edge mid-collapse.
    if (running?.dir === "collapse" && started.current === running && heights.tall) morph.lift.setValue(Math.max(0, heights.tall - h));
    // Starts once the incoming header has a height to aim for.
    if (!running || started.current === running) return;
    started.current = running;
    const driven = track.prev && focusedPrimary();
    track.prev = focusedPrimary();
    const lift = tall ? h - heights.short : heights.tall - h;
    morph.lift.setValue(Math.max(0, lift));
    const ran = running;
    if (driven) {
      // The page position carries the hero; just retire the curtain once the slide is done.
      timed.setValue(0);
      setTimeout(() => setRunning((cur) => (cur === ran ? null : cur)), 320);
      return;
    }
    Animated.timing(timed, { toValue: tall ? 0 : 1, duration: HEADER_MS, easing: HEADER_EASE, useNativeDriver: true }).start(({ finished }) => {
      if (finished) setRunning((cur) => (cur === ran ? null : cur));
    });
  };

  return (
    <View style={s.headerHost} pointerEvents="box-none">
      {tall ? (
        <HeroClip key="tall" morph={morph} onLayout={onLayout}>
          {node}
        </HeroClip>
      ) : (
        <>
          {running?.dir === "collapse" ? (
            <HeroClip morph={morph} style={s.headerCurtain} pointerEvents="none">
              {running.hero}
            </HeroClip>
          ) : null}
          <Animated.View
            key="short"
            pointerEvents="box-none"
            style={{ opacity: running?.dir === "collapse" ? flatFade : 1 }}
            onLayout={(e) => onLayout(e.nativeEvent.layout.height)}
          >
            {node}
          </Animated.View>
        </>
      )}
      {tall && running?.dir === "expand" ? (
        <Animated.View pointerEvents="none" style={[s.headerCurtain, { opacity: flatFade }]}>
          {running.flat}
        </Animated.View>
      ) : null}
    </View>
  );
}
