import React, { useEffect, useRef, useState } from "react";
import { Animated, Keyboard, LayoutAnimation, Platform, Pressable, StyleSheet, View, type HostInstance, type KeyboardEvent } from "react-native";
import { ModalHead } from "./ModalHead";
import { useOverlay, s } from "./Sheet";

type CenterModalProps = { visible: boolean; onClose: () => void; title: React.ReactNode; children: React.ReactNode };

/** .modal-backdrop.center-modal + .modal-card.floating (Gold Rate). */
export function CenterModal({ visible, onClose, title, children }: CenterModalProps) {
  // Keyboard handling that works on every phone: some resize the window for the keyboard, others draw edge-to-edge
  // and leave it full height. Either way, measure how far the overlay's bottom edge sits below the keyboard's top
  // and keep that much clear, so the card (and the field being typed in) stays above the keyboard.
  const [lift, setLift] = useState(0);
  const [overlayH, setOverlayH] = useState(0);
  const overlayRef = useRef<HostInstance>(null);
  useEffect(() => {
    if (!visible) return;
    const ios = Platform.OS === "ios";
    const animate = (e: KeyboardEvent) => {
      if (ios && e.duration) LayoutAnimation.configureNext({ duration: e.duration, update: { type: LayoutAnimation.Types.keyboard } });
      else LayoutAnimation.configureNext({ duration: 250, update: { type: LayoutAnimation.Types.easeInEaseOut } });
    };
    let raf = 0;
    const show = Keyboard.addListener(ios ? "keyboardWillShow" : "keyboardDidShow", (e) => {
      cancelAnimationFrame(raf);
      // Let a window resize (on devices that do one) lay out first, then measure.
      raf = requestAnimationFrame(() => {
        const node = overlayRef.current;
        if (!node) return;
        node.measureInWindow((_x, y, _w, h) => {
          animate(e);
          setLift(Math.max(0, Math.round(y + h - e.endCoordinates.screenY)));
        });
      });
    });
    const hide = Keyboard.addListener(ios ? "keyboardWillHide" : "keyboardDidHide", (e) => {
      cancelAnimationFrame(raf);
      animate(e);
      setLift(0);
    });
    return () => {
      cancelAnimationFrame(raf);
      show.remove();
      hide.remove();
      setLift(0);
    };
  }, [visible]);

  useOverlay(
    visible,
    onClose,
    (anim) => (
      <View
        ref={overlayRef}
        collapsable={false}
        style={[s.overlayCenter, lift ? { paddingBottom: lift } : null]}
        pointerEvents={visible ? "auto" : "none"}
        onLayout={(e) => setOverlayH(e.nativeEvent.layout.height)}
      >
        <Animated.View style={[StyleSheet.absoluteFill, s.backdrop, { opacity: anim }]}>
          <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        </Animated.View>
        <Animated.View
          style={[
            s.floatingCard,
            // With the keyboard up, cap the card to the space left above it.
            lift && overlayH ? { maxHeight: Math.min(overlayH * 0.76, overlayH - lift - 16) } : null,
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
    [children, title, lift, overlayH],
  );
  return null;
}
