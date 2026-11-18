"use client";

import { useLayoutEffect, useRef } from "react";

/* The single standard for every free-text note / remark / additional-information input.
 * - at most NOTE_MAX_LENGTH characters (the browser stops typing there; the backend rejects anything longer)
 * - the box grows only vertically, up to 4 lines, then scrolls; it is never resizable by hand
 * - the placeholder always ends with the character limit so the user sees it before typing */
export const NOTE_MAX_LENGTH = 150;

export const NOTE_MAX_LINES = 4;

/* Grows a textarea vertically to fit its text, up to NOTE_MAX_LINES lines, then it scrolls. */
export function autoGrowTextarea(el: HTMLTextAreaElement | null, maxLines = NOTE_MAX_LINES) {
  if (!el) return;
  const cs = getComputedStyle(el);
  const line = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.4;
  const border = parseFloat(cs.borderTopWidth) + parseFloat(cs.borderBottomWidth);
  const pad = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom) + border;
  el.style.height = "auto";
  el.style.height = Math.min(el.scrollHeight + border, line * maxLines + pad) + "px";
  el.style.overflowY = "auto";
}

type NoteFieldProps = {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  id?: string;
  disabled?: boolean;
  onBlur?: () => void;
};

export function NoteField({ value, onChange, placeholder = "Optional note", id, disabled, onBlur }: NoteFieldProps) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    autoGrowTextarea(ref.current);
  }, [value]);
  return (
    <textarea
      ref={ref}
      id={id}
      className="inp"
      rows={1}
      maxLength={NOTE_MAX_LENGTH}
      placeholder={placeholder ? `${placeholder} (max ${NOTE_MAX_LENGTH} characters)` : `Max ${NOTE_MAX_LENGTH} characters`}
      value={value}
      disabled={disabled}
      onBlur={onBlur}
      onChange={(e) => onChange(e.target.value)}
      style={{ resize: "none", width: "100%", overflowY: "auto", boxSizing: "border-box" }}
    />
  );
}
