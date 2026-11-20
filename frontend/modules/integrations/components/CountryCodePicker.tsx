"use client";

import { useMemo, useRef, useState } from "react";
import { COUNTRY_CODES, type CountryCode } from "@/modules/integrations/utils/countryCodes";

type CountryCodePickerProps = { value: string; onChange: (iso: string) => void };

/* A narrow dial-code box ("+91") that turns into a search field on focus: type a country name or a
 * code ("ind", "971", "+44") and pick from the list. Enter picks the first match. */
export function CountryCodePicker({ value, onChange }: CountryCodePickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const boxRef = useRef<HTMLDivElement>(null);
  const current = COUNTRY_CODES.find((c) => c.iso === value);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase().replace(/^\+/, "");
    if (!q) return COUNTRY_CODES;
    return COUNTRY_CODES.filter((c) => c.name.toLowerCase().includes(q) || c.dial.startsWith(q) || c.iso.toLowerCase() === q);
  }, [query]);

  function pick(c: CountryCode) {
    onChange(c.iso);
    setQuery("");
    setOpen(false);
  }

  return (
    <div className="ccp" ref={boxRef}>
      <input
        className="inp"
        value={open ? query : current ? `+${current.dial}` : ""}
        placeholder={open ? "Search country or code" : "+91"}
        autoComplete="off"
        title={current?.name}
        onFocus={() => { setQuery(""); setOpen(true); }}
        onChange={(e) => setQuery(e.target.value)}
        onBlur={(e) => { if (!boxRef.current?.contains(e.relatedTarget as Node)) setOpen(false); }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && matches[0]) { e.preventDefault(); pick(matches[0]); }
          if (e.key === "Escape") { setOpen(false); (e.target as HTMLInputElement).blur(); }
        }}
      />
      {open && (
        <div className="ccp-list">
          {matches.length === 0 && <div className="ccp-empty">No country found</div>}
          {matches.map((c) => (
            <button
              type="button"
              key={c.iso}
              className={c.iso === value ? "on" : ""}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pick(c)}
            >
              <span className="ccp-dial">+{c.dial}</span>
              <span>{c.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
