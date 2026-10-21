import React, { useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Animated, Easing, View } from "react-native";
import { HeroHeader } from "./HeroHeader";
import { headerStore, HeroMorph, s, HeroMorphContext, setTallHeaderCheck } from "./shellContext";

setTallHeaderCheck((node) => React.isValidElement(node) && node.type === HeroHeader);

// Timed close to the page slide (220ms) so the header and the page finish together.
const HEADER_MS = 280;
const HEADER_EASE = Easing.bezier(0.4, 0, 0.2, 1);
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
/** Mounted once by app/(tabs)/_layout.tsx. Animates the hero header collapsing into/expanding
 * from the page's flat header; the swap is spotted during render so there's no blank frame. */
export function HeaderHost() {
  const node = useSyncExternalStore(headerStore.subscribe, headerStore.get, headerStore.get);
  const tall = React.isValidElement(node) && node.type === HeroHeader;
  const [heights, setHeights] = useState({ tall: 0, short: 0 });
  // Kept per kind so the outgoing header can still be played during a swap.
  const [heroNode, setHeroNode] = useState<React.ReactNode>(tall ? node : null);
  if (tall && heroNode !== node) setHeroNode(node);
  const [flatNode, setFlatNode] = useState<React.ReactNode>(tall ? null : node);
  if (!tall && flatNode !== node) setFlatNode(node);

  const [morph] = useState<HeroMorph>(() => ({ p: new Animated.Value(0), lift: new Animated.Value(0) }));
  // Flat header fades in over the back half of a collapse, out over the front half of an expand.
  const [flatFade] = useState(() => morph.p.interpolate({ inputRange: [0.2, 0.75], outputRange: [0, 1], extrapolate: "clamp" }));
  const [running, setRunning] = useState<Morph | null>(null);
  const started = useRef<Morph | null>(null);

  // Set before the fresh-mounted side (tall/short render different trees) first draws.
  const [prevTall, setPrevTall] = useState(tall);
  if (prevTall !== tall) {
    setPrevTall(tall);
    morph.p.stopAnimation();
    if (!tall && heights.tall && heroNode) {
      morph.p.setValue(0);
      if (heights.short) morph.lift.setValue(heights.tall - heights.short);
      setRunning({ dir: "collapse", hero: heroNode });
    } else if (tall && heights.tall && heights.short && flatNode) {
      morph.p.setValue(1);
      morph.lift.setValue(heights.tall - heights.short);
      setRunning({ dir: "expand", flat: flatNode });
    } else {
      morph.p.setValue(tall ? 0 : 1);
      setRunning(null);
    }
  }

  const onLayout = (h: number) => {
    if (h <= 0) return;
    const kind = tall ? "tall" : "short";
    if (heights[kind] !== h) setHeights((prev) => ({ ...prev, [kind]: h }));
    // Re-aim mid-collapse once the page's real header height lands (it starts toward a placeholder).
    if (running?.dir === "collapse" && started.current === running && heights.tall) morph.lift.setValue(Math.max(0, heights.tall - h));
    if (!running || started.current === running) return;
    started.current = running;
    const lift = tall ? h - heights.short : heights.tall - h;
    morph.lift.setValue(Math.max(0, lift));
    const ran = running;
    Animated.timing(morph.p, { toValue: tall ? 0 : 1, duration: HEADER_MS, easing: HEADER_EASE, useNativeDriver: true }).start(({ finished }) => {
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
