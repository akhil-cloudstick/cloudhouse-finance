import React, { useState } from "react";
import { Pressable, type TextProps } from "react-native";
import { Txt } from "./Txt";

type TruncTextProps = TextProps & { lines?: number; children: React.ReactNode };

// Long free text (remarks, notes, additional info): clipped to `lines` lines
// with an ellipsis; tap to expand, tap again to collapse.
export function TruncText({ lines = 2, children, ...rest }: TruncTextProps) {
  const [open, setOpen] = useState(false);
  return (
    <Pressable onPress={() => setOpen((v) => !v)} accessibilityRole="button" accessibilityLabel={open ? "Collapse text" : "Expand text"}>
      <Txt {...rest} numberOfLines={open ? undefined : lines}>
        {children}
      </Txt>
    </Pressable>
  );
}
