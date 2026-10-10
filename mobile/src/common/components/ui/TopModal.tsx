import React, { useState } from "react";
import { Animated, Pressable, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { HeroBackground } from "./HeroBackground";
import { takeOverlayOrigin, type OverlayOrigin } from "./overlayOrigin";
import { useOverlay, s } from "./Sheet";

type TopModalProps = {
  visible: boolean;
  onClose: () => void;
  /** Fires once the panel has finished sliding in. */
  onOpened?: () => void;
  children: React.ReactNode;
};

/** .modal-backdrop.top-modal + .modal-card.top-slide (global search). */
export function TopModal({
  visible,
  onClose,
  onOpened,
  children,
}: TopModalProps) {
  const insets = useSafeAreaInsets();
  // A fixed slide distance close to the panel's height: re-measuring it
  // mid-slide changed the interpolation under a running animation (a
  // visible hitch), and a fixed 700px spent half the slide off-screen.
  const travel = insets.top + 420;
  // Opened from a control that recorded its position (the search icon):
  // the panel grows out of that point and unfolds downward instead of
  // sliding in from above. Read once per opening.
  const [origin, setOrigin] = useState<OverlayOrigin | null>(null);
  const [wasVisible, setWasVisible] = useState(false);
  if (visible !== wasVisible) {
    setWasVisible(visible);
    if (visible) setOrigin(takeOverlayOrigin());
  }
  useOverlay(
    visible,
    onClose,
    (anim) => (
      <View style={StyleSheet.absoluteFill} pointerEvents={visible ? "auto" : "none"}>
        <Animated.View style={[StyleSheet.absoluteFill, s.backdrop, { opacity: anim }]}>
          <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        </Animated.View>
        <Animated.View
          style={[
            s.topCard,
            { paddingTop: insets.top },
            origin
              ? {
                  opacity: anim.interpolate({ inputRange: [0, 0.3, 1], outputRange: [0, 1, 1] }),
                  transformOrigin: [origin.x, origin.y, 0],
                  transform: [
                    { scaleX: anim.interpolate({ inputRange: [0, 1], outputRange: [0.12, 1] }) },
                    { scaleY: anim.interpolate({ inputRange: [0, 1], outputRange: [0.04, 1] }) },
                  ],
                }
              : {
                  opacity: anim.interpolate({ inputRange: [0, 0.35, 1], outputRange: [0, 1, 1] }),
                  transform: [
                    {
                      translateY: anim.interpolate({
                        inputRange: [0, 1],
                        outputRange: [-travel, 0],
                      }),
                    },
                  ],
                },
          ]}
        >
          {/* Hero colour behind the status bar, matching every page header. */}
          <View style={[s.topInset, { height: insets.top }]}>
            <HeroBackground />
          </View>
          {children}
        </Animated.View>
      </View>
    ),
    [children, insets.top, travel, origin],
    onOpened
  );
  return null;
}
