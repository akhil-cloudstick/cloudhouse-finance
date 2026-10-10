"use client";

import { useEffect, useRef, type CSSProperties } from "react";

type EditableTextProps = {
  value: string;
  placeholder: string;
  className: string;
  style: CSSProperties;
  multiline?: boolean;
  onChange: (v: string) => void;
};

/* Header text typed in place. Uncontrolled while focused (React re-rendering a
 * contentEditable mid-typing would move the caret); synced from `value`
 * whenever it is not being edited. Pastes arrive as plain text. */
export function EditableText({
  value,
  placeholder,
  className,
  style,
  multiline,
  onChange,
}: EditableTextProps) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (el && document.activeElement !== el && el.innerText !== value) el.innerText = value;
  }, [value]);
  return (
    <span
      ref={ref}
      className={className}
      style={style}
      contentEditable
      suppressContentEditableWarning
      spellCheck={false}
      role="textbox"
      aria-label={placeholder}
      data-placeholder={placeholder}
      onInput={(e) => onChange(e.currentTarget.innerText.replace(/ /g, " "))}
      onPaste={(e) => {
        e.preventDefault();
        document.execCommand("insertText", false, e.clipboardData.getData("text/plain"));
      }}
      onKeyDown={(e) => {
        if (e.key !== "Enter") return;
        // The title is one line; the subtitle may break once (two lines max).
        if (!multiline || e.currentTarget.innerText.split("\n").filter(Boolean).length >= 2) {
          e.preventDefault();
          if (!multiline) e.currentTarget.blur();
        }
      }}
    />
  );
}
