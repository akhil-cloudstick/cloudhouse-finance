"use client";



type PagerProps = { page: number; total: number; pageSize: number; onChange: (p: number) => void };

export function Pager({ page, total, pageSize, onChange }: PagerProps) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <div className="ft" style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <button className="btn plain sm" disabled={page <= 1} onClick={() => onChange(Math.max(1, page - 1))}>‹ Prev</button>
      <span style={{ fontSize: 12.5 }}>Page {page} of {totalPages}</span>
      <button className="btn plain sm" disabled={page >= totalPages} onClick={() => onChange(Math.min(totalPages, page + 1))}>Next ›</button>
    </div>
  );
}
