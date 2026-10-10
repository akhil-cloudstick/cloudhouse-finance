import React, { useContext, useEffect, useLayoutEffect } from "react";
import { Keyboard, View } from "react-native";
import { useIsFocused, useNavigation, useRoute } from "expo-router";
import { Fade } from "./Fade";
import { PHEADER_FADE } from "@/common/theme/layout";
import { HeaderHostContext, headerStore, s } from "./shellContext";

type ScreenProps = {
  header: React.ReactNode;
  children: React.ReactNode;
  floating?: React.ReactNode;
  headerFade?: boolean;
};

/** Page shell: header on top, body below with a gradual fade under the
 * header so content scrolls away smoothly. `floating` renders page-level
 * floating elements (FAB, action bar) above the body. */
export function Screen({
  header,
  children,
  floating,
  headerFade = true,
}: ScreenProps) {
  const hosted = useContext(HeaderHostContext);
  const routeKey = useRoute().key;
  const navigation = useNavigation();
  const focused = useIsFocused();
  // Every render, so the hosted header tracks the page's state.
  useLayoutEffect(() => {
    if (hosted) headerStore.set(routeKey, header, focused);
  });
  // The blur event still fires for a page that's frozen once hidden (it
  // can't re-render to report focused=false itself).
  useEffect(() => {
    if (!hosted) return;
    // Leaving a page (tab, push, back) also closes a keyboard opened on it.
    const off = navigation.addListener("blur", () => {
      Keyboard.dismiss();
      headerStore.blur(routeKey);
    });
    return () => {
      off();
      headerStore.remove(routeKey);
    };
  }, [hosted, routeKey, navigation]);
  return (
    <View style={s.screen}>
      <View
        style={[s.headerShell, hosted && s.headerSpacer]}
        pointerEvents={hosted ? "none" : "auto"}
        importantForAccessibility={hosted ? "no-hide-descendants" : "auto"}
      >
        {header}
      </View>
      <View style={s.body}>
        {children}
        {headerFade ? <Fade from="top" height={PHEADER_FADE} style={s.headerFade} /> : null}
      </View>
      {floating}
    </View>
  );
}
