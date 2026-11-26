import React from "react";
import { ScrollView, View, type NativeScrollEvent, type NativeSyntheticEvent } from "react-native";
import { C } from "./base";
import { Txt } from "./Txt";

type BoundedListProps = {
  /** How many rows are visible before the list scrolls inside its own box. */
  rows?: number;
  /** Approximate height of one row (the box is rows × rowHeight tall). */
  rowHeight?: number;
  children: React.ReactNode;
  /** Called when the user scrolls near the bottom — load the next page here. */
  onEndReached?: () => void;
  loadingMore?: boolean;
  /** A short caption under the box, e.g. "Showing 15 of 80". */
  caption?: string;
};

/** A bordered box that shows `rows` rows and scrolls inside itself (nested scrolling inside a Sheet), with an
 * optional "load more" on reaching the bottom — so a long list never pushes the rest of the sheet off screen. */
export function BoundedList({ rows = 3, rowHeight = 58, children, onEndReached, loadingMore, caption }: BoundedListProps) {
  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { layoutMeasurement, contentOffset, contentSize } = e.nativeEvent;
    if (onEndReached && contentOffset.y + layoutMeasurement.height >= contentSize.height - 24) onEndReached();
  };
  return (
    <View style={{ marginBottom: 12 }}>
      <View style={{ borderWidth: 1, borderColor: C.line, borderRadius: 12, overflow: "hidden", maxHeight: rows * rowHeight }}>
        <ScrollView nestedScrollEnabled keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator onScroll={onScroll} scrollEventThrottle={64}>
          {children}
          {loadingMore ? <Txt style={{ fontSize: 12, color: C.muted, textAlign: "center", paddingVertical: 10 }}>Loading…</Txt> : null}
        </ScrollView>
      </View>
      {caption ? <Txt style={{ fontSize: 11.5, color: C.muted, marginTop: 6 }}>{caption}</Txt> : null}
    </View>
  );
}
