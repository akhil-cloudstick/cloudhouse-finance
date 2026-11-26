import { useCallback, useEffect, useRef, useState } from "react";

/** Keeps a controlled TextInput's native text in step with what the user just typed, whatever the parent does next.
 *
 * A plain controlled TextInput hands the parent each keystroke and then waits for the parent to send the same text
 * back. On some Android keyboards / slower devices that round trip is late (a busy re-render, a batched update), so
 * the field is handed stale text while the keyboard is still composing: the text is duplicated two or three times,
 * or the cursor is pushed back (typing at "100|0" lands at "10|00"). Here the field shows its own copy, updated in the
 * same tick as the keystroke, and only takes the parent's `value` when the parent really changed it — a clamped,
 * cleaned-up or reset value — or still disagrees a moment after the keystroke (a change the parent refused). */
const SETTLE_MS = 150;

export function useStableText(value: string | undefined, onChangeText?: (text: string) => void) {
  const [text, setText] = useState(value ?? "");
  const [seen, setSeen] = useState(value);
  const textRef = useRef(text);
  const valueRef = useRef(value);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // The parent changed `value`: if it is not just our own typing coming back, show it.
  if (value !== seen) {
    setSeen(value);
    if (value !== undefined && value !== text) setText(value);
  }

  useEffect(() => {
    textRef.current = text;
    valueRef.current = value;
  });
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const onChange = useCallback(
    (t: string) => {
      textRef.current = t;
      setText(t);
      onChangeText?.(t);
      // A moment later, if the parent still holds something else (it refused the change), show what it holds.
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        timer.current = null;
        const v = valueRef.current;
        if (v !== undefined && v !== textRef.current) {
          textRef.current = v;
          setText(v);
        }
      }, SETTLE_MS);
    },
    [onChangeText]
  );

  return { value: value === undefined ? undefined : text, onChangeText: onChange };
}
