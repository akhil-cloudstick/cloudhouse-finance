import React from "react";
import { Animated, Pressable, StyleSheet, View } from "react-native";
import { ModalHead } from "./ModalHead";
import { useOverlay, s } from "./Sheet";

type CenterModalProps = { visible: boolean; onClose: () => void; title: React.ReactNode; children: React.ReactNode };

/** .modal-backdrop.center-modal + .modal-card.floating (Gold Rate). */
export function CenterModal({ visible, onClose, title, children }: CenterModalProps) {
  useOverlay(
    visible,
    onClose,
    (anim) => (
      <View style={s.overlayCenter} pointerEvents={visible ? "auto" : "none"}>
        <Animated.View style={[StyleSheet.absoluteFill, s.backdrop, { opacity: anim }]}>
          <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        </Animated.View>
        <Animated.View
          style={[
            s.floatingCard,
            {
              opacity: anim,
              transform: [
                {
                  scale: anim.interpolate({
                    inputRange: [0, 1],
                    outputRange: [0.96, 1],
                  }),
                },
              ],
            },
          ]}
        >
          <ModalHead title={title} onClose={onClose} />
          {children}
        </Animated.View>
      </View>
    ),
    [children, title],
  );
  return null;
}
