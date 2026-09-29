import React from "react";
import { InputAccessoryView, Keyboard, Platform, Pressable, StyleSheet, View, type KeyboardTypeOptions } from "react-native";
import { C, Txt } from "./base";

// iOS number / decimal / phone pads have no Return key, so once one is up
// there's no way to put it away. Inputs using those pads attach this bar
// (a "Done" button above the keyboard) through `inputAccessoryViewID`.
// Android keyboards always have their own dismiss key, so it's iOS-only.

export const KEYBOARD_DONE_ID = "keyboard-done-bar";

const PADS = new Set<KeyboardTypeOptions>(["number-pad", "decimal-pad", "numeric", "phone-pad"]);

/** The accessory id an input should use for this keyboard type (iOS pads only). */
export function doneBarFor(keyboardType?: KeyboardTypeOptions): string | undefined {
  return Platform.OS === "ios" && keyboardType && PADS.has(keyboardType) ? KEYBOARD_DONE_ID : undefined;
}

/** Mount once at the app root. */
export function KeyboardDoneBar() {
  if (Platform.OS !== "ios") return null;
  return (
    <InputAccessoryView nativeID={KEYBOARD_DONE_ID}>
      <View style={s.bar}>
        <Pressable onPress={() => Keyboard.dismiss()} hitSlop={10} accessibilityRole="button" accessibilityLabel="Done">
          <Txt style={s.done}>Done</Txt>
        </Pressable>
      </View>
    </InputAccessoryView>
  );
}

const s = StyleSheet.create({
  bar: {
    flexDirection: "row",
    justifyContent: "flex-end",
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: "#F4F2F7",
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: C.line,
  },
  done: { fontSize: 15, fontWeight: "700", color: C.brandDeep },
});
