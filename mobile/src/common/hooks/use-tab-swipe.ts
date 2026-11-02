import { useMemo } from "react";
import { Dimensions, PanResponder } from "react-native";
import { swipeCanStart, swipeEnd, swipeUpdate } from "@/common/components/ui/swipeController";
import { routeAllowed } from "@/common/config/routePermissions";
import { useAuth } from "@/common/providers/AuthProvider";

/** Horizontal pan across the primary tabs: both pages and the tab bar follow the finger.
 * Spread the result on the wrapper View. It captures the drag before children
 * (a horizontal filter row would otherwise claim every forward swipe). */
export function useTabSwipe() {
  const { can } = useAuth();
  const width = Dimensions.get("window").width;

  return useMemo(() => {
    const allowed = (r: string) => routeAllowed(r, can);
    const horizontal = (dx: number, dy: number) => Math.abs(dx) > 14 && Math.abs(dx) > Math.abs(dy) * 2;
    return PanResponder.create({
      onMoveShouldSetPanResponderCapture: (_e, g) => horizontal(g.dx, g.dy) && swipeCanStart(g.dx, allowed),
      onPanResponderMove: (_e, g) => swipeUpdate(g.dx, width, allowed),
      onPanResponderRelease: (_e, g) => swipeEnd(g.vx * 1000),
      onPanResponderTerminate: (_e, g) => swipeEnd(g.vx * 1000),
      onPanResponderTerminationRequest: () => false,
    }).panHandlers;
  }, [can, width]);
}
