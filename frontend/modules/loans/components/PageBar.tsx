"use client";



type PageBarProps = { page: number; total: number; pageSize: number; onChange: (p: number) => void; children?: React.ReactNode };

/* Prev / Next footer under a table. Always rendered, even for a single page,
 * so every table on this page ends the same way. */
export function PageBar({ page, total, pageSize, onChange, children }: PageBarProps) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <div className="ft ft-static" style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
      <button className="btn plain sm" disabled={page <= 1} onClick={() => onChange(Math.max(1, page - 1))}>‹ Prev</button>
      <span style={{ fontSize: 13 }}>Page {page} of {pages}</span>
      <button className="btn plain sm" disabled={page >= pages} onClick={() => onChange(Math.min(pages, page + 1))}>Next ›</button>
      {children}
    </div>
  );
}
