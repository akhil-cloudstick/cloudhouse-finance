import React, { forwardRef } from "react";
import { ScrollView, ScrollViewProps, StyleProp, View, ViewStyle } from "react-native";
import { EDGE_FADE } from "./EdgeFade";
import { TAB_BAR_SPACE, useHeaderSpace, useTabBarClearance } from "../theme/layout";

// Scrollers clip whatever draws outside their own bounds, so card shadows were
// cut off at the screen's side margin. Stretching the scroller over the margin
// (negative margin) and insetting its content by the same amount keeps every
// card exactly where it was while giving shadows room to render. Content
// position is margin − GUTTER + GUTTER, so this works for any screen margin.
export const GUTTER = 16;
export { EDGE_FADE };

export const gutterStyle: ViewStyle = { marginHorizontal: -GUTTER };
// Bottom padding lets the last card scroll clear of the floating tab bar.
export const gutterContentStyle: ViewStyle = { paddingHorizontal: GUTTER, paddingBottom: TAB_BAR_SPACE };

export function withGutter(style?: StyleProp<ViewStyle>): StyleProp<ViewStyle> {
  return [gutterStyle, style];
}
export function withGutterContent(style?: StyleProp<ViewStyle>): StyleProp<ViewStyle> {
  return [gutterContentStyle, style];
}

// Also reaches up under the floating header (negative marginTop, matched by a
// leading spacer) so content scrolls behind it and fades out in the header's
// gradient, while still starting exactly where it did before.
export const GutterScrollView = forwardRef<ScrollView, ScrollViewProps>(function GutterScrollView(
  { style, contentContainerStyle, children, refreshControl, ...rest },
  ref
) {
  const headerSpace = useHeaderSpace();
  const clearance = useTabBarClearance();
  return (
    <View style={[{ flex: 1, marginTop: -headerSpace }, gutterStyle, style]}>
      <ScrollView
        ref={ref}
        style={{ flex: 1 }}
        contentContainerStyle={[{ paddingHorizontal: GUTTER }, contentContainerStyle]}
        scrollEventThrottle={16}
        // Spinner starts below the floating header, not behind it.
        refreshControl={refreshControl ? React.cloneElement(refreshControl, { progressViewOffset: headerSpace }) : undefined}
        {...rest}
      >
        <View style={{ height: headerSpace }} />
        {children}
        {/* A spacer, not paddingBottom — a caller's own contentContainerStyle
            padding would otherwise override it and leave the last control
            (e.g. a Save button) hidden behind the floating tab bar. */}
        <View style={{ height: clearance }} />
      </ScrollView>
    </View>
  );
});
