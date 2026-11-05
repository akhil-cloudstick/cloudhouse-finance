import React, { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Animated, Easing, View } from "react-native";
import { HeroHeader, heroMorphGate, setSlimHeaderHeight, syncHeroGate } from "./HeroHeader";
import { FlatHeader } from "./FlatHeader";
import { headerStore, HeroMorph, jumpTarget, s, HeroMorphContext, setBlankHeader, setTallHeaderCheck, tabsRef, TitleTransitionContext } from "./shellContext";
import { PRIMARY_ROUTES, swipe, whenSwipeSettled } from "./swipeStore";

setTallHeaderCheck((node) => React.isValidElement(node) && node.type === HeroHeader);
setBlankHeader(<FlatHeader title="" />);

// TEMPORARY — traces header switches in the Metro log while the stuck-header bug is checked. Remove after.
const hdrLog = (msg: string) => {
  if (__DEV__) console.log(`[header] ${msg}`);
};

// Material "standard" curve: eases in and out, so the header neither jumps
// off at the start nor stops dead at the end. Close to the page slide (220ms)
// so the header and the page finish together.
// Whether the previous focused page was a primary tab (see HeaderHost).
const track = { prev: true };
const HEADER_MS = 170;
// The hero finishes collapsing / opening after this fraction of the page slide, so it leads the
// page instead of trailing it (and is already settled while the page's ease-out tail plays).
const HERO_SWIPE_SPAN = 0.7;
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
    // × heroMorphGate: in a plain cross-fade (gate 0) the hero's scroll collapse alone sets its edge,
    // so this rise and that one can never add up past the slim height (which hid the header whole).
    const d = Animated.multiply(Animated.multiply(morph.p, morph.lift), heroMorphGate);
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
const TITLE_FADE_MS = 180;
const textOf = (node: React.ReactNode) => {
  const p = React.isValidElement(node) ? (node.props as { title?: string; subtitle?: string }) : {};
  return { title: p.title ?? "", subtitle: p.subtitle };
};

/** When a page header's title changes (a swipe, a tab tap, a jump from the Dashboard, a blank
 * placeholder filling in), only its title text cross-fades — the header itself stays put. */
function TitleFade({ node }: { node: React.ReactNode }) {
  const now = textOf(node);
  const [cur, setCur] = useState(now);
  const [prev, setPrev] = useState<typeof now | null>(null);
  const [fade] = useState(() => new Animated.Value(1));
  const [out] = useState(() => fade.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }));
  if (cur.title !== now.title) {
    setPrev(cur);
    fade.setValue(0);
  }
  if (cur.title !== now.title || cur.subtitle !== now.subtitle) setCur(now);
  useEffect(() => {
    if (!prev) return;
    Animated.timing(fade, { toValue: 1, duration: TITLE_FADE_MS, easing: Easing.out(Easing.quad), useNativeDriver: true }).start(({ finished }) => {
      if (finished) setPrev(null);
    });
  }, [prev, fade]);
  const value = useMemo(() => (prev ? { prev, fade, out } : null), [prev, fade, out]);
  return <TitleTransitionContext.Provider value={value}>{node}</TitleTransitionContext.Provider>;
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
  // heroMorphGate turns the swipe-driven part off for a plain cross-fade (see flatMode below).
  // Clamped to 0–1: the timed and swiped parts could add up past 1 in a leftover state, which raised
  // the hero's edge past its own bottom.
  const [morph] = useState<HeroMorph>(() => ({
    p: Animated.add(timed, Animated.multiply(swipe.view.interpolate({ inputRange: [0, HERO_SWIPE_SPAN], outputRange: [0, 1], extrapolate: 'clamp' }), heroMorphGate)).interpolate({
      inputRange: [0, 1],
      outputRange: [0, 1],
      extrapolate: "clamp",
    }),
    lift: new Animated.Value(0),
  }));
  // The Dashboard hero was already collapsed (scrolled) when this header change began: it is a slim
  // header by then, so the change is a plain cross-fade like between any two page headers — no edge
  // movement, not tied to the swipe — instead of the hero's own collapse / grow.
  const [flatMode, setFlatMode] = useState(false);
  const focusedPrimary = () => {
    // Mid-jump (openPage) the navigator still reports the page being left: judge by the destination,
    // or a jump from the Dashboard to a More page waited for a page slide that never comes — the
    // Dashboard header stayed up and the new page's header stayed invisible.
    const jump = jumpTarget();
    if (jump) return PRIMARY_ROUTES.includes(jump);
    const st = tabsRef.state;
    return !!st && PRIMARY_ROUTES.includes(st.routes[st.index]?.name);
  };
  // With both heights known the hero's travel is fixed, so it can follow the page from the first frame of a swipe.
  useEffect(() => {
    if (!flatMode && heights.tall && heights.short) morph.lift.setValue(heights.tall - heights.short);
  }, [heights, morph, flatMode]);
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
    const flat = syncHeroGate();
    hdrLog(`switch to ${tall ? "Dashboard hero" : "page header"} — ${flat ? "hero was collapsed: plain cross-fade" : "hero transition"}`);
    setFlatMode(flat);
    const driven = !flat && track.prev && focusedPrimary();
    if (!tall && heights.tall && heroNode) {
      timed.setValue(0);
      if (flat) morph.lift.setValue(0);
      else if (heights.short) morph.lift.setValue(heights.tall - heights.short);
      setRunning({ dir: "collapse", hero: heroNode });
    } else if (tall && heights.tall && heights.short && flatNode) {
      timed.setValue(driven ? 0 : 1);
      morph.lift.setValue(flat ? 0 : heights.tall - heights.short);
      setRunning({ dir: "expand", flat: flatNode });
    } else {
      timed.setValue(tall ? 0 : 1);
      setRunning(null);
    }
  }

  // Starts the running transition, `h` being the incoming header's height.
  const startRunning = (h: number, from: string) => {
    if (!running || started.current === running) return;
    started.current = running;
    const ran = running;
    const done = (how: string) => {
      hdrLog(`${ran.dir} finished (${how})`);
      setRunning((cur) => (cur === ran ? null : cur));
    };
    if (flatMode) {
      // Plain header change: the two headers cross-fade in place over the title-fade time.
      hdrLog(`${ran.dir} started from ${from} — plain cross-fade (Dashboard header was collapsed)`);
      track.prev = focusedPrimary();
      morph.lift.setValue(0);
      Animated.timing(timed, { toValue: tall ? 0 : 1, duration: TITLE_FADE_MS, easing: HEADER_EASE, useNativeDriver: true }).start(({ finished }) => {
        if (finished) done("cross-fade ended");
      });
      return;
    }
    const driven = track.prev && focusedPrimary();
    track.prev = focusedPrimary();
    const lift = tall ? h - heights.short : heights.tall - h;
    morph.lift.setValue(Math.max(0, lift));
    hdrLog(`${ran.dir} started from ${from} — hero transition, ${driven ? "follows the swipe" : "timed"}, lift ${Math.round(lift)}`);
    if (driven) {
      // The page position carries the hero; just retire the curtain once the slide is done.
      timed.setValue(0);
      // A slow drag keeps the curtain up until the slide has settled.
      whenSwipeSettled(() => setTimeout(() => done("swipe settled"), 320));
      return;
    }
    Animated.timing(timed, { toValue: tall ? 0 : 1, duration: HEADER_MS, easing: HEADER_EASE, useNativeDriver: true }).start(({ finished }) => {
      if (finished) done("timed ended");
    });
  };

  const onLayout = (h: number) => {
    if (h <= 0) return;
    const kind = tall ? "tall" : "short";
    if (heights[kind] !== h) setHeights((prev) => ({ ...prev, [kind]: h }));
    // The collapse starts toward a plain placeholder header; the page's real header (subtitle,
    // back button) can be a different height once it lands — re-aim the edge mid-collapse.
    if (!flatMode && running?.dir === "collapse" && started.current === running && heights.tall) morph.lift.setValue(Math.max(0, heights.tall - h));
    // Starts once the incoming header has a height to aim for.
    startRunning(h, "layout");
  };

  // The incoming header's slot can already be laid out (a quick swipe back and forth reuses it), so
  // its onLayout never fires again — the transition then never started and the outgoing header
  // stayed up (the Dashboard hero over another page, or a page title over the hero). Start it from
  // the heights already measured, a frame after the swap, if layout hasn't done it by then.
  useEffect(() => {
    if (!running) return;
    const known = tall ? heights.tall : heights.short;
    const frame = requestAnimationFrame(() => {
      if (known > 0) startRunning(known, "fallback");
    });
    const watchdog = setTimeout(() => {
      hdrLog(
        started.current !== running
          ? `STUCK: ${running.dir} never started (incoming ${tall ? "hero" : "page"} height ${known})`
          : `STUCK: ${running.dir} started but never finished`
      );
    }, 1500);
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(watchdog);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running]);

  return (
    <View style={s.headerHost} pointerEvents="box-none">
      {/* An invisible page header, measured once: the Dashboard hero collapses to exactly this
          height, so its scrolled-up form is the same size as every other page header from the
          first frame (before, it only learned that height once a page header had been shown). */}
      <View
        style={{ position: "absolute", top: 0, left: 0, right: 0, opacity: 0 }}
        pointerEvents="none"
        importantForAccessibility="no-hide-descendants"
        accessibilityElementsHidden
        onLayout={(e) => setSlimHeaderHeight(e.nativeEvent.layout.height)}
      >
        <FlatHeader title=" " subtitle=" " />
      </View>
      {/* Each header keeps one fixed slot whether it is the live one or the outgoing curtain,
          so a swap never remounts it (a fresh header paints its gradient a frame late). */}
      {tall || running?.dir === "collapse" ? (
        <HeroClip
          key="hero"
          morph={morph}
          style={tall ? undefined : s.headerCurtain}
          pointerEvents={tall ? "box-none" : "none"}
          onLayout={tall ? onLayout : undefined}
        >
          {tall ? node : running?.dir === "collapse" ? running.hero : null}
        </HeroClip>
      ) : null}
      {!tall || running?.dir === "expand" ? (
        <Animated.View
          key="flat"
          pointerEvents={tall ? "none" : "box-none"}
          style={[tall && s.headerCurtain, { opacity: tall || running?.dir === "collapse" ? flatFade : 1 }]}
          onLayout={tall ? undefined : (e) => onLayout(e.nativeEvent.layout.height)}
        >
          {!tall ? <TitleFade node={node} /> : running?.dir === "expand" ? running.flat : null}
        </Animated.View>
      ) : null}
    </View>
  );
}
