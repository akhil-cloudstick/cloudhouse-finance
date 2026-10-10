import { useRef } from "react";
import { Keyboard, TextInput, type GestureResponderEvent } from "react-native";

// How far above/below the focused field a touch still counts as "on" it —
// covers the field's own box, its clear (×) or show-password icon, and
// the label sitting just above it.
const FIELD_SLOP = 12;

type Pending = { input: unknown; y: number; top: number | null; bottom: number | null };

/** Closes the keyboard when a touch lands outside the field being typed in.
 *
 * Every scroller in the app uses keyboardShouldPersistTaps="handled" so a
 * button tap works on the first press — but that same setting means tapping
 * a button (Add image, a dropdown, a tab) or scrolling never closes the
 * keyboard. Spread the returned props onto the root view: they only watch
 * touches (capture phase, never claiming the responder), and once a touch
 * ends they close the keyboard if the same field is still focused and the
 * touch wasn't on that field's row. Tapping into another field moves focus
 * instead, so it is left alone and the keyboard stays up. */
export function useDismissKeyboardOnOutsideTouch() {
  const pending = useRef<Pending | null>(null);

  const onTouchStartCapture = (e: GestureResponderEvent) => {
    const input = TextInput.State.currentlyFocusedInput?.();
    if (!input || e.nativeEvent.touches.length > 1) {
      pending.current = null;
      return;
    }
    const entry: Pending = { input, y: e.nativeEvent.pageY, top: null, bottom: null };
    pending.current = entry;
    (input as { measureInWindow?: (cb: (x: number, y: number, w: number, h: number) => void) => void }).measureInWindow?.((_x, y, _w, h) => {
      entry.top = y;
      entry.bottom = y + h;
    });
  };

  const onTouchEndCapture = () => {
    const entry = pending.current;
    pending.current = null;
    if (!entry) return;
    // After the touch's own handlers have run, so a tap that focused
    // another field is seen as a focus change, not an outside tap.
    setTimeout(() => {
      if (TextInput.State.currentlyFocusedInput?.() !== entry.input) return;
      if (entry.top != null && entry.bottom != null && entry.y >= entry.top - FIELD_SLOP && entry.y <= entry.bottom + FIELD_SLOP) return;
      Keyboard.dismiss();
    }, 0);
  };

  return { onTouchStartCapture, onTouchEndCapture };
}
