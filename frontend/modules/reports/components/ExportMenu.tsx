"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "@/common/components/Icon";

export type ExportKind = "xlsx" | "pdf";

/* One "Export" button that opens a small menu with Excel and PDF — shared by every report. Its
 * height is pinned to the search box and filter button beside it (34px). */
export function ExportMenu({ busy, onExport }: { busy: ExportKind | null; onExport: (kind: ExportKind) => void }) {
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("click", onDoc);
    return () => document.removeEventListener("click", onDoc);
  }, [open]);

  function pick(kind: ExportKind) {
    setOpen(false);
    onExport(kind);
  }

  return (
    <div className="docs-dd" ref={boxRef}>
      <button
        type="button"
        className="btn sm"
        style={{ height: 34 }}
        disabled={busy !== null}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <Icon name="download" /> {busy ? "Exporting…" : "Export"} <Icon name="chevronDown" className="docs-dd-chev" />
      </button>
      {open && (
        <div className="docs-dd-menu" role="menu">
          <a href="#" role="menuitem" onClick={(e) => { e.preventDefault(); pick("xlsx"); }}><Icon name="download" /><span className="tx">Excel</span></a>
          <a href="#" role="menuitem" onClick={(e) => { e.preventDefault(); pick("pdf"); }}><Icon name="download" /><span className="tx">PDF</span></a>
        </div>
      )}
    </div>
  );
}
