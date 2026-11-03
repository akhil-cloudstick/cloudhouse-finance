import { useMemo } from "react";
import { Animated } from "react-native";
import { State, type HandlerStateChangeEvent, type PanGestureHandlerEventPayload } from "react-native-gesture-handler";
import { swipeBegin, swipeEnd, swipeStart, swipeTouchEnd } from "@/common/components/ui/swipeController";
import { swipe } from "@/common/components/ui/swipeStore";
import { routeAllowed } from "@/common/config/routePermissions";
import { useAuth } from "@/common/providers/AuthProvider";

/** Horizontal pan across the primary tabs: both pages and the tab bar follow the finger.
 * Spread the result on a <PanGestureHandler> wrapping the tabs. The finger's travel is
 * written to swipe.dragPx natively, so the drag never waits on the JS thread. */
export function useTabSwipe() {
  const { can } = useAuth();

  return useMemo(() => {
    const allowed = (r: string) => routeAllowed(r, can);
    return {
      activeOffsetX: [-10, 10] as [number, number],
      failOffsetY: [-16, 16] as [number, number],
      onGestureEvent: Animated.event([{ nativeEvent: { translationX: swipe.dragPx } }], { useNativeDriver: true }),
      onHandlerStateChange: ({ nativeEvent: e }: HandlerStateChangeEvent<PanGestureHandlerEventPayload>) => {
        if (e.state === State.BEGAN) swipeBegin(allowed);
        else if (e.state === State.ACTIVE) swipeStart(e.velocityX);
        else if (e.oldState === State.ACTIVE) swipeEnd(e.translationX, e.velocityX);
        else if (e.state === State.END || e.state === State.FAILED || e.state === State.CANCELLED) swipeTouchEnd();
      },
    };
  }, [can]);
}
