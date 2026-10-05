"use client";

import { useId, useRef } from "react";
import { Icon } from "@/product/components/Icon";
import { PhotoSourceMenu } from "@/product/components/ui/PhotoSourceMenu";

/**
 * Themed replacement for a bare `<input type="file">`, whose "Choose File /
 * No file chosen" chrome is drawn by the OS/browser and can't be restyled to
 * match the app's gold/ivory theme. Same `.inp`-sized trigger as the rest of
 * the form (icon + filename), with the real file input hidden underneath —
 * mirrors DatePicker's approach to the same native-control problem.
 *
 * `camera` (photo fields only) turns the field into a PhotoSourceMenu
 * trigger — clicking it offers "Upload from system" or "Take photo
 * (webcam)" instead of jumping straight to the file dialog. Either result
 * comes back through the same `onChange`.
 */
export function FileInput({
  value,
  onChange,
  accept,
  disabled,
  placeholder = "Choose a file…",
  camera,
}: {
  value: File | null;
  onChange: (f: File | null) => void;
  accept?: string;
  disabled?: boolean;
  placeholder?: string;
  camera?: boolean;
}) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);

  const label = (
    <>
      <span className="fi-name" style={{ color: value ? "var(--nav)" : "var(--muted)" }}>
        {value ? value.name : placeholder}
      </span>
      <Icon name={camera ? "camera" : "doc"} className="fi-ic" />
    </>
  );

  return (
    <div className="fi">
      {camera ? (
        <PhotoSourceMenu
          accept={accept}
          onFile={onChange}
          trigger={(t) => (
            <button
              ref={t.ref}
              type="button"
              disabled={disabled}
              className={`inp fi-trigger${disabled ? " fi-disabled" : ""}`}
              aria-haspopup="menu"
              aria-expanded={t.open}
              onClick={t.toggle}
            >
              {label}
            </button>
          )}
        />
      ) : (
        <>
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
            {label}
          </label>
        </>
      )}
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
