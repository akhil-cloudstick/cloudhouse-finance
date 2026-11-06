import React, { useContext, useEffect, useLayoutEffect, useState } from "react";
import { Keyboard, View } from "react-native";
import { useIsFocused, useNavigation, useRoute } from "expo-router";
import { Fade } from "./Fade";
import { PHEADER_FADE } from "@/common/theme/layout";
import { HeaderHostContext, HeaderInsetContext, headerStore, s, TabNameContext } from "./shellContext";
import { blurredBySwipe } from "./swipeController";

type ScreenProps = {
  header: React.ReactNode;
  children: React.ReactNode;
  floating?: React.ReactNode;
  headerFade?: boolean;
  /** The body runs under the header instead of starting below it, so a header that collapses on
   * scroll (the Dashboard hero) leaves no gap. A scroller inside pads its content by the header's
   * height (PScroll `underHeader`). */
  overlayHeader?: boolean;
};

// Last measured header height of an overlayHeader page, so a remount starts at the right inset.
let lastOverlayHeaderH = 0;

/** Page shell: header on top, body below with a gradual fade under the
 * header so content scrolls away smoothly. `floating` renders page-level
 * floating elements (FAB, action bar) above the body. */
export function Screen({
  header,
  children,
  floating,
  headerFade = true,
  overlayHeader = false,
}: ScreenProps) {
  const hosted = useContext(HeaderHostContext);
  const [headerH, setHeaderH] = useState(overlayHeader ? lastOverlayHeaderH : 0);
  const routeKey = useRoute().key;
  const tab = useContext(TabNameContext);
  const navigation = useNavigation();
  const focused = useIsFocused();
  // Every render, so the hosted header tracks the page's state.
  useLayoutEffect(() => {
    if (hosted) headerStore.set(routeKey, header, focused, tab);
  });
  // The blur event still fires for a page that's frozen once hidden (it
  // can't re-render to report focused=false itself).
  useEffect(() => {
    if (!hosted) return;
    // Leaving a page (tab, push, back) also closes a keyboard opened on it.
    return navigation.addListener("blur", () => {
      if (!blurredBySwipe()) Keyboard.dismiss();
      headerStore.blur(routeKey);
    });
  }, [hosted, routeKey, navigation]);
  // The header entry is dropped only when the page itself goes away — NOT when `navigation`
  // changes. Expo Router 58 hands a preloaded tab (Customers / Loans / Schemes) a new navigation
  // object the moment it is first focused; dropping the entry then (right after the page had
  // just published its focused header) left the header host with nothing to show, so the title
  // went blank until the page next re-rendered.
  useEffect(() => {
    if (!hosted) return;
    return () => headerStore.remove(routeKey);
  }, [hosted, routeKey]);
  return (
    <View style={s.screen}>
      <View
        style={[s.headerShell, hosted && s.headerSpacer, overlayHeader && { position: "absolute", top: 0, left: 0, right: 0 }]}
        pointerEvents={hosted ? "none" : "auto"}
        importantForAccessibility={hosted ? "no-hide-descendants" : "auto"}
        onLayout={
          overlayHeader
            ? (e) => {
                const h = e.nativeEvent.layout.height;
                lastOverlayHeaderH = h;
                setHeaderH(h);
              }
            : undefined
        }
      >
        {header}
      </View>
      <View style={s.body}>
        {overlayHeader ? <HeaderInsetContext.Provider value={headerH}>{children}</HeaderInsetContext.Provider> : children}
        {headerFade ? <Fade from="top" height={PHEADER_FADE} style={s.headerFade} /> : null}
      </View>
      {floating}
    </View>
  );
}
