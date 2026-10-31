"use client";

import { useEffect, useState } from "react";

type GoToPageProps = { page: number; totalPages: number; onChange: (page: number) => void };

/* "Go to page" box that sits beside a pager's Prev / Next. A page number is typed (digits only) and applied on
 * Enter or when the box loses focus: anything outside 1..totalPages is clamped, and an empty box goes back to the
 * current page. Hidden when there is only one page. */
export function GoToPage({ page, totalPages, onChange }: GoToPageProps) {
  const [text, setText] = useState(String(page));
  useEffect(() => { setText(String(page)); }, [page]);
  if (totalPages <= 1) return null;

  function commit() {
    const n = parseInt(text, 10);
    if (!Number.isFinite(n)) { setText(String(page)); return; }
    const next = Math.min(totalPages, Math.max(1, n));
    setText(String(next));
    if (next !== page) onChange(next);
  }

  return (
    <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12.5 }}>
      Go to
      <input
        className="inp"
        inputMode="numeric"
        aria-label="Go to page"
        value={text}
        onChange={(e) => setText(e.target.value.replace(/\D/g, "").slice(0, 6))}
        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); e.stopPropagation(); commit(); } }}
        onBlur={commit}
        style={{ width: 52, height: 28, padding: "2px 6px", textAlign: "center" }}
      />
    </label>
  );
}
