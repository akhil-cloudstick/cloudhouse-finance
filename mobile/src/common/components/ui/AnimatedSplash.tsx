import React, { useEffect, useState } from "react";
import { Animated, Easing, Image, StyleSheet, View } from "react-native";
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg";
import { BRAND } from "@/common/config/brand";
import { colors } from "@/common/theme/colors";
import { fonts } from "@/common/theme/typography";

// "Hero Gradient" splash — the animated hand-off from the native splash.
//
// The native splash (app.json: expo-splash-screen) is the logo tile
// (assets/splash-tile.png, 96 wide) centred on solid nav2 maroon. This
// starts in exactly that state, so there's no jump when the native one
// hides, then:
//   1. the hero gradient (nav → nav2 → brand, as on every page header)
//      fades in over the solid maroon,
//   2. the logo gives a small pop,
//   3. "CloudHouse Finance" tightens in from wide letter-spacing, then the
//      descriptor rises in,
//   4. a gold shimmer sweeps along a thin line under the name,
//   5. the splash lifts up and away, revealing the app — whose maroon
//      header continues the same gradient.
// All on the native driver, except the name's letter-spacing (layout), which
// is approximated with a native scaleX instead.

const TILE = 96; // matches app.json expo-splash-screen imageWidth
const SPLASH_TILE = require("../../../../assets/splash-tile.png");

type AnimatedSplashProps = { onReady: () => void; onDone: () => void };

export function AnimatedSplash({ onReady, onDone }: AnimatedSplashProps) {
  const [grad] = useState(() => new Animated.Value(0));
  const [pop] = useState(() => new Animated.Value(0));
  const [name] = useState(() => new Animated.Value(0));
  const [sub] = useState(() => new Animated.Value(0));
  const [line] = useState(() => new Animated.Value(0));
  const [sweep] = useState(() => new Animated.Value(0));
  const [exit] = useState(() => new Animated.Value(0));
  const [laidOut, setLaidOut] = useState(false);
  const [h, setH] = useState(800);

  useEffect(() => {
    if (!laidOut) return;
    const ease = Easing.bezier(0.22, 1, 0.36, 1);
    const at = (ms: number, a: Animated.CompositeAnimation) => Animated.sequence([Animated.delay(ms), a]);
    const seq = Animated.sequence([
      Animated.parallel([
        Animated.timing(grad, { toValue: 1, duration: 420, easing: Easing.out(Easing.quad), useNativeDriver: true }),
        at(100, Animated.timing(pop, { toValue: 1, duration: 620, easing: Easing.bezier(0.34, 1.56, 0.64, 1), useNativeDriver: true })),
        at(480, Animated.timing(name, { toValue: 1, duration: 700, easing: ease, useNativeDriver: true })),
        at(780, Animated.timing(sub, { toValue: 1, duration: 500, easing: ease, useNativeDriver: true })),
        at(980, Animated.timing(line, { toValue: 1, duration: 380, easing: Easing.out(Easing.quad), useNativeDriver: true })),
        at(1040, Animated.timing(sweep, { toValue: 1, duration: 720, easing: Easing.bezier(0.4, 0, 0.2, 1), useNativeDriver: true })),
      ]),
      Animated.delay(160),
      Animated.timing(exit, { toValue: 1, duration: 520, easing: Easing.bezier(0.65, 0, 0.35, 1), useNativeDriver: true }),
    ]);
    seq.start(({ finished }) => finished && onDone());
    return () => seq.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [laidOut]);

  const rise = (v: Animated.Value, from = 10) => ({
    opacity: v,
    transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [from, 0] }) }],
  });

  return (
    <Animated.View
      pointerEvents="none"
      style={[StyleSheet.absoluteFill, s.root, { transform: [{ translateY: exit.interpolate({ inputRange: [0, 1], outputRange: [0, -h] }) }] }]}
      onLayout={(e) => {
        setH(e.nativeEvent.layout.height);
        // Our first frame now matches the native splash — hide it.
        if (!laidOut) {
          setLaidOut(true);
          onReady();
        }
      }}
    >
      {/* Hero gradient, fading in over the native solid maroon. Nothing else
          sits behind the logo — no glow patch, no tile, no ring — so the
          transparent mark blends straight into the gradient. */}
      <Animated.View style={[StyleSheet.absoluteFill, { opacity: grad }]}>
        <Svg width="100%" height="100%">
          <Defs>
            <LinearGradient id="splashHero" x1="0.1" y1="0" x2="0.9" y2="1">
              <Stop offset="0" stopColor={colors.nav} />
              <Stop offset="0.58" stopColor={colors.nav2} />
              <Stop offset="1" stopColor={colors.brand} />
            </LinearGradient>
          </Defs>
          <Rect x="0" y="0" width="100%" height="100%" fill="url(#splashHero)" />
        </Svg>
      </Animated.View>

      {/* Tile stays exactly where the native splash drew it; the text block
          is laid out below it without moving it off-centre. */}
      <View style={s.center}>
        <View style={s.tileWrap}>
          <Animated.View
            style={[
              s.tileShadow,
              { transform: [{ scale: pop.interpolate({ inputRange: [0, 0.5, 1], outputRange: [1, 1.08, 1] }) }] },
            ]}
          >
            <Image source={SPLASH_TILE} style={{ width: TILE, height: TILE }} resizeMode="contain" />
          </Animated.View>
        </View>

        <View style={s.textBlock}>
          <Animated.Text
            allowFontScaling={false}
            style={[
              s.name,
              {
                opacity: name,
                transform: [{ scaleX: name.interpolate({ inputRange: [0, 1], outputRange: [1.28, 1] }) }],
              },
            ]}
            numberOfLines={1}
          >
            {BRAND.name}
          </Animated.Text>
          <Animated.Text allowFontScaling={false} style={[s.sub, rise(sub)]}>
            {BRAND.descriptor}
          </Animated.Text>
          <Animated.View style={[s.track, rise(line, 6)]}>
            <Animated.View
              style={[s.shine, { transform: [{ translateX: sweep.interpolate({ inputRange: [0, 1], outputRange: [-60, 130] }) }] }]}
            />
          </Animated.View>
        </View>
      </View>
    </Animated.View>
  );
}

const TEXT_BLOCK_H = 96;

const s = StyleSheet.create({
  root: { zIndex: 200000, elevation: 200000, backgroundColor: colors.nav2, alignItems: "center", justifyContent: "center" },
  // Tile centred on screen like the native splash; the text sits below it
  // in a fixed-height block balanced by equal padding on top.
  center: { alignItems: "center", paddingTop: TEXT_BLOCK_H },
  tileWrap: { width: TILE, height: TILE, alignItems: "center", justifyContent: "center" },
  // No drop shadow — the tile image (splash-tile.png) is a transparent PNG
  // of the cloud mark's irregular silhouette, not a filled square; a
  // rectangular shadow drawn under it read as a floating grey box behind
  // the artwork instead of blending into the gradient behind it.
  tileShadow: {},
  textBlock: { height: TEXT_BLOCK_H, alignItems: "center", paddingTop: 22 },
  name: { fontFamily: fonts.display, fontSize: 24, fontWeight: "800", color: "#ffffff", letterSpacing: 0.4 },
  sub: { marginTop: 6, fontSize: 11.5, fontWeight: "600", color: "rgba(255,255,255,0.72)", letterSpacing: 2, textTransform: "uppercase" },
  track: { marginTop: 16, width: 132, height: 2, borderRadius: 2, backgroundColor: "rgba(255,255,255,0.18)", overflow: "hidden" },
  shine: { width: 56, height: "100%", borderRadius: 2, backgroundColor: "#d6b25e", opacity: 0.95 },
});
