import { ScrollView, type ScrollViewProps } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { pullRefreshControl } from "./base";
import { Buffering } from "./Buffering";
import { notifyLayoutShift, notifyUserScroll } from "./Popover";
import { PCONTENT_BOTTOM, tabBarLift } from "@/common/theme/layout";
import { usePullRefresh } from "@/common/hooks/use-pull-refresh";

/** .content — vertical scroller that clears the floating tab bar. */
export function PScroll({
  children,
  refreshing,
  onRefresh,
  contentContainerStyle,
  extraBottom = 0,
  ...rest
}: ScrollViewProps & { refreshing?: boolean; onRefresh?: () => void; extraBottom?: number }) {
  const insets = useSafeAreaInsets();
  const { pullRefreshing, onPull } = usePullRefresh(!!refreshing, onRefresh);
  return (
    <ScrollView
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
      refreshControl={onPull ? pullRefreshControl(pullRefreshing, onPull) : undefined}
      scrollEventThrottle={16}
      {...rest}
      onScroll={(e) => {
        notifyLayoutShift();
        rest.onScroll?.(e);
      }}
      onScrollBeginDrag={(e) => {
        notifyUserScroll();
        rest.onScrollBeginDrag?.(e);
      }}
      contentContainerStyle={[{ paddingBottom: PCONTENT_BOTTOM + tabBarLift(insets.bottom) + extraBottom }, contentContainerStyle]}
    >
      {pullRefreshing ? <Buffering style={{ paddingVertical: 10 }} /> : null}
      {children}
    </ScrollView>
  );
}
