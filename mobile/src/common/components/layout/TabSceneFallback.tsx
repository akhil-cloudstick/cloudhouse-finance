import React from "react";
import { View, type ViewProps } from "react-native";
import * as Screens from "react-native-screens";

// Replaces expo-router's bottom-tabs `views/ScreenFallback` (wired in metro.config.js).
//
// Why: the tabs are told `detachInactiveScreens={false}` (TabsLayout) because the swipe slides the
// neighbouring page in BEFORE the navigator focuses it. With Expo SDK 58, react-native-screens
// 4.30 turned a non-detaching scene into `display: 'none'` whenever it isn't the focused tab
// (Screen.tsx, the `enabled === false` branch). So the page being swiped in was hidden outright —
// a blank screen, with not even its loading spinner — until the tab focus landed after the swipe.
//
// Same components as the original, except that a scene which is not detached is a plain View:
// always drawn (the scene interpolator already moves it off screen), as it was before SDK 58.

type ContainerProps = ViewProps & { enabled?: boolean; hasTwoStates?: boolean; children?: React.ReactNode };

export const MaybeScreenContainer = ({ enabled, ...rest }: ContainerProps) => {
  if (enabled && Screens.screensEnabled?.()) return <Screens.ScreenContainer enabled {...rest} />;
  // `hasTwoStates` is only meant for ScreenContainer.
  const { hasTwoStates: _hasTwoStates, ...viewProps } = rest;
  return <View {...viewProps} />;
};

type ScreenProps = ViewProps & { enabled?: boolean; active: 0 | 1 | 2; children?: React.ReactNode };

export function MaybeScreen({ enabled, active, ...rest }: ScreenProps) {
  if (enabled && Screens.screensEnabled?.()) {
    return <Screens.Screen {...rest} enabled activityState={active} freezeOnBlur={false} />;
  }
  return <View {...rest} />;
}
