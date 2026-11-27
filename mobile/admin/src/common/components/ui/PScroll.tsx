import React, { useContext, useEffect } from "react";
import { Animated, ScrollView, type NativeScrollEvent, type NativeSyntheticEvent, type ScrollViewInstance, type ScrollViewProps } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { pullRefreshControl } from "./base";
import { ReloadBuffer } from "./Buffering";
import { notifyLayoutShift, notifyUserScroll } from "./Popover";
import { HeaderInsetContext } from "./shellContext";
import { PCONTENT_BOTTOM, tabBarLift } from "@/common/theme/layout";
import { usePullRefresh } from "@/common/hooks/use-pull-refresh";

type PScrollProps = ScrollViewProps & {
  refreshing?: boolean;
  onRefresh?: () => void;
  extraBottom?: number;
  /** The page's header sits over this scroller (Screen `overlayHeader`): pad the content down by its height. */
  underHeader?: boolean;
  /** Receives the scroll offset on the native thread (e.g. to collapse a header as the page scrolls). */
  scrollY?: Animated.Value;
  /** The underlying scroll view, e.g. to scroll it back to the top. */
  scrollRef?: React.Ref<ScrollViewInstance>;
};

/** .content — vertical scroller that clears the floating tab bar. */
export function PScroll({
  children,
  refreshing,
  onRefresh,
  contentContainerStyle,
  extraBottom = 0,
  underHeader = false,
  scrollY,
  scrollRef,
  ...rest
}: PScrollProps) {
  const insets = useSafeAreaInsets();
  const headerInset = useContext(HeaderInsetContext);
  const { pullRefreshing, onPull } = usePullRefresh(!!refreshing, onRefresh);
  // A fresh scroller starts at the top: whatever follows the offset starts from there too.
  useEffect(() => {
    scrollY?.setValue(0);
  }, [scrollY]);
  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    notifyLayoutShift();
    rest.onScroll?.(e);
  };
  const props: ScrollViewProps = {
    showsVerticalScrollIndicator: false,
    keyboardShouldPersistTaps: "handled",
    keyboardDismissMode: "on-drag",
    refreshControl: onPull ? pullRefreshControl(pullRefreshing, onPull) : undefined,
    scrollEventThrottle: 16,
    ...rest,
    onScrollBeginDrag: (e) => {
      notifyUserScroll();
      rest.onScrollBeginDrag?.(e);
    },
    contentContainerStyle: [
      { paddingBottom: PCONTENT_BOTTOM + tabBarLift(insets.bottom) + extraBottom },
      underHeader ? { paddingTop: headerInset } : null,
      contentContainerStyle,
    ],
  };
  const content = (
    <>
      <ReloadBuffer active={pullRefreshing} />
      {children}
    </>
  );
  if (scrollY) {
    return (
      <Animated.ScrollView
        ref={scrollRef as React.Ref<never>}
        {...props}
        onScroll={Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], { useNativeDriver: true, listener: onScroll })}
      >
        {content}
      </Animated.ScrollView>
    );
  }
  return (
    <ScrollView ref={scrollRef} {...props} onScroll={onScroll}>
      {content}
    </ScrollView>
  );
}
