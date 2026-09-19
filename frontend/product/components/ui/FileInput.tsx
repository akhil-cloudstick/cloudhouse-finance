"use client";

import { useId, useRef } from "react";
import { Icon } from "@/product/components/Icon";

/**
 * Themed replacement for a bare `<input type="file">`, whose "Choose File /
 * No file chosen" chrome is drawn by the OS/browser and can't be restyled to
 * match the app's gold/ivory theme. Same `.inp`-sized trigger as the rest of
 * the form (icon + filename), with the real file input hidden underneath —
 * mirrors DatePicker's approach to the same native-control problem.
 */
export function FileInput({
  value,
  onChange,
  accept,
  disabled,
  placeholder = "Choose a file…",
}: {
  value: File | null;
  onChange: (f: File | null) => void;
  accept?: string;
  disabled?: boolean;
  placeholder?: string;
}) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <div className="fi">
      <input
        ref={inputRef}
        id={inputId}
        type="file"
        accept={accept}
        disabled={disabled}
        className="fi-native"
        onChange={(e) => onChange(e.target.files?.[0] || null)}
      />
      <label htmlFor={inputId} className={`inp fi-trigger${disabled ? " fi-disabled" : ""}`}>
        <span className="fi-name" style={{ color: value ? "var(--nav)" : "var(--muted)" }}>
          {value ? value.name : placeholder}
        </span>
        <Icon name="doc" className="fi-ic" />
      </label>
      {value && !disabled && (
        <button
          type="button"
          className="fi-clear"
          aria-label="Remove selected file"
          onClick={() => {
            onChange(null);
            if (inputRef.current) inputRef.current.value = "";
          }}
        >
          ×
        </button>
      )}
    </div>
  );
}
