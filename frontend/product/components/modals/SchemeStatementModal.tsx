"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useModal } from "@/product/components/Modal";
import { useToast } from "@/product/components/Toast";
import { Icon } from "@/product/components/Icon";
import { DatePicker } from "@/product/components/ui/DatePicker";
import { ApiError } from "@/product/services/httpClient";
import { fmt, statusChipColor } from "@/product/utils/format";
import { listLoansPage, type LoanView } from "@/product/pages/loans/services/loanService";
import { downloadSchemeStatement, type SchemeView } from "@/product/pages/schemes/services/schemeService";

function firstOfMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}
function today(): string {
  return new Date().toISOString().slice(0, 10);
}
function fmtShortDate(iso: string): string {
  const d = new Date(iso + "T00:00:00");
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

/* Download Statement modal — a scheme card's second action alongside Edit
 * (see Schemes.tsx). From/To + a loan multi-picker filter the loans under
 * this scheme; the preview below groups each matching loan with its own
 * payment ledger (mirrors backend/internal/loan/statement.go's row shape),
 * so what's on screen is exactly what the PDF/Excel download will contain.
 * Loan-picking is a checkbox dropdown (chips + chevron, like the web's other
 * pickers) rather than SearchableSelect, which is single-select only —
 * nothing checked means "every loan in range", matching the backend's
 * loanIds=empty convention. */
export function SchemeStatementModalContent({ scheme: s }: { scheme: SchemeView }) {
  const { closeModal } = useModal();
  const toast = useToast();

  const [from, setFrom] = useState(firstOfMonth());
  const [to, setTo] = useState(today());
  const [loans, setLoans] = useState<LoanView[] | null>(null);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [pickerOpen, setPickerOpen] = useState(false);
  const [downloading, setDownloading] = useState<"pdf" | "xlsx" | null>(null);
  const pickerRef = useRef<HTMLDivElement>(null);
  // Portal position for the loan checklist below — see the useLayoutEffect
  // below for why this can't just be a plain `position:absolute` child of
  // pickerRef like the app's other dropdowns.
  const [coords, setCoords] = useState<{ top: number; left: number; width: number; maxHeight: number } | null>(null);
  // The portalled checklist lives in document.body, outside pickerRef's own
  // DOM subtree — without also checking this ref, a click on one of its own
  // checkboxes registers as "outside" and the outside-click handler below
  // closes the picker before that checkbox's own onChange ever runs.
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    setLoans(null);
    setSelected(new Set());
    listLoansPage({ schemeId: Number(s.id), from, to, page: 1, limit: 50 })
      .then((r) => { if (!cancelled) { setLoans(r.items); setError(""); } })
      .catch((e) => { if (!cancelled) setError(e instanceof ApiError ? e.message : "Could not load loans."); });
    return () => { cancelled = true; };
  }, [s.id, from, to]);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      const target = e.target as Node;
      if (pickerRef.current?.contains(target)) return;
      if (listRef.current?.contains(target)) return;
      setPickerOpen(false);
    }
    document.addEventListener("click", onDocClick);
    return () => document.removeEventListener("click", onDocClick);
  }, []);

  // The checklist used to be a plain `position:absolute` child of the
  // trigger — this modal (unlike a full page) has no headroom to spare
  // below the Loans field once From/To/Preview/the footer are all
  // accounted for, so the open list routinely rendered past the modal's
  // own rounded bottom edge into the dimmed backdrop behind it, instead of
  // staying inside the card. Portalled to document.body with a `fixed`
  // position computed from the trigger's own rect (same approach
  // SearchableSelect.tsx's `compact` mode already uses for an identical
  // "an ancestor doesn't have room for this popup" problem) and capped to
  // whatever space is actually left in the viewport below the trigger, so
  // it now scrolls within itself rather than spilling past the modal.
  useLayoutEffect(() => {
    if (!pickerOpen) return;
    function reposition() {
      const el = pickerRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const spaceBelow = window.innerHeight - rect.bottom;
      const maxHeight = Math.min(260, Math.max(120, spaceBelow - 12));
      setCoords({ top: rect.bottom + 4, left: rect.left, width: rect.width, maxHeight });
    }
    reposition();
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    return () => {
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
    };
  }, [pickerOpen]);

  function toggle(numericId: number) {
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(numericId)) next.delete(numericId);
      else next.add(numericId);
      return next;
    });
  }

  // Only the checked loans (or every loaded loan, when nothing is checked)
  // drive both the preview below and the download — so what's on screen
  // always matches what the file will contain.
  const shown = useMemo(
    () => (loans || []).filter((l) => selected.size === 0 || selected.has(l.numericId)),
    [loans, selected]
  );
  const paymentCount = useMemo(() => shown.reduce((sum, l) => sum + l.payments.length, 0), [shown]);
  const totalCollected = useMemo(
    () => shown.reduce((sum, l) => sum + l.payments.reduce((s2, p) => s2 + p.amount, 0), 0),
    [shown]
  );
  const totalOutstanding = useMemo(() => shown.reduce((sum, l) => sum + l.totalOutstandingBalance, 0), [shown]);

  async function handleDownload(format: "pdf" | "xlsx") {
    setDownloading(format);
    try {
      await downloadSchemeStatement(s.id, format, {
        from,
        to,
        loanIds: selected.size ? Array.from(selected) : undefined,
      });
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Could not download statement.");
    } finally {
      setDownloading(null);
    }
  }

  const selectedLoans = (loans || []).filter((l) => selected.has(l.numericId));

  return (
    <>
      <div className="hd">
        <div>
          <h3>Download Statement</h3>
          <p style={{ margin: "2px 0 0", fontSize: 12.5, color: "var(--muted)" }}>
            Loans under <b style={{ color: "var(--charcoal)" }}>{s.name}</b> ({s.code})
          </p>
        </div>
        <button className="x" onClick={closeModal}>×</button>
      </div>
      <div className="bd bd-scroll">
        <div className="frow c3">
          <div><label className="f">From</label><DatePicker value={from} onChange={setFrom} max={to} /></div>
          <div><label className="f">To</label><DatePicker value={to} onChange={setTo} min={from} max={today()} /></div>
          <div ref={pickerRef} style={{ position: "relative" }}>
            <label className="f">Loans</label>
            <button
              type="button"
              className="inp dp-trigger"
              onClick={() => setPickerOpen((o) => !o)}
              disabled={loans === null || loans.length === 0}
            >
              <span style={{ display: "flex", alignItems: "center", gap: 6, overflow: "hidden", whiteSpace: "nowrap", minWidth: 0 }}>
                <span style={{ color: selectedLoans.length === 0 ? "var(--muted)" : "inherit", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {selectedLoans.length === 0
                    ? "All loans in range"
                    : `${selectedLoans.length} loan${selectedLoans.length === 1 ? "" : "s"} selected`}
                </span>
              </span>
              <svg className="sel-chevron" viewBox="0 0 10 6" fill="none">
                <path d="M1 1l4 4 4-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            {pickerOpen && loans && loans.length > 0 && coords && createPortal(
              <div
                ref={listRef}
                className="gs-results open"
                style={{
                  position: "fixed",
                  top: coords.top,
                  left: coords.left,
                  right: "auto",
                  width: coords.width,
                  maxHeight: coords.maxHeight,
                  overflowY: "auto",
                  zIndex: 1000,
                }}
              >
                <label className="ccheck" style={{ padding: "8px 10px", alignItems: "center", borderBottom: "1px solid var(--line)" }}>
                  <input
                    type="checkbox"
                    checked={selected.size === loans.length}
                    ref={(el) => { if (el) el.indeterminate = selected.size > 0 && selected.size < loans.length; }}
                    onChange={(e) => setSelected(e.target.checked ? new Set(loans.map((l) => l.numericId)) : new Set())}
                  />
                  <span className="mark" />
                  <span style={{ flex: 1, fontSize: 13, fontWeight: 600 }}>Select all</span>
                </label>
                {loans.map((l) => (
                  <label key={l.numericId} className="ccheck" style={{ padding: "8px 10px", alignItems: "center" }}>
                    <input type="checkbox" checked={selected.has(l.numericId)} onChange={() => toggle(l.numericId)} />
                    <span className="mark" />
                    <span style={{ flex: 1, fontSize: 13 }}>
                      <b>{l.loanNumber}</b> — {l.customerName}
                    </span>
                  </label>
                ))}
              </div>,
              document.body
            )}
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginTop: 4, marginBottom: 8 }}>
          <label className="f" style={{ margin: 0 }}>Preview</label>
          {shown.length > 0 && (
            <span style={{ fontSize: 12.5, color: "var(--muted)" }}>
              <b style={{ color: "var(--charcoal)" }}>{shown.length}</b> loan{shown.length === 1 ? "" : "s"} ·{" "}
              <b style={{ color: "var(--charcoal)" }}>{paymentCount}</b> payment{paymentCount === 1 ? "" : "s"} in range
            </span>
          )}
        </div>

        {error && <p style={{ color: "var(--red)", fontSize: 12.5 }}>{error}</p>}
        {!error && loans === null && <p style={{ color: "var(--muted)", fontSize: 13 }}>Loading loans…</p>}
        {!error && loans !== null && shown.length === 0 && (
          <p style={{ color: "var(--muted)", fontSize: 13 }}>No loans opened under this scheme in that range.</p>
        )}

        {!error && shown.length > 0 && (
          <div style={{ maxHeight: 300, overflowY: "auto", border: "1px solid var(--line)", borderRadius: 8 }}>
            {shown.map((l) => (
              <div key={l.numericId} style={{ borderBottom: "1px solid var(--line)" }}>
                <div style={{ display: "grid", gridTemplateColumns: "1.3fr 1fr .8fr .8fr auto", gap: 8, alignItems: "center", padding: "10px 14px", background: "var(--card)" }}>
                  <div><span style={{ display: "block", fontSize: 9.5, textTransform: "uppercase", letterSpacing: ".05em", color: "var(--muted)" }}>Loan</span><b>{l.loanNumber}</b></div>
                  <div><span style={{ display: "block", fontSize: 9.5, textTransform: "uppercase", letterSpacing: ".05em", color: "var(--muted)" }}>Customer</span>{l.customerName}</div>
                  <div><span style={{ display: "block", fontSize: 9.5, textTransform: "uppercase", letterSpacing: ".05em", color: "var(--muted)" }}>Opened</span>{fmtShortDate(l.opened)}</div>
                  <div><span style={{ display: "block", fontSize: 9.5, textTransform: "uppercase", letterSpacing: ".05em", color: "var(--muted)" }}>Principal</span>{fmt(l.principal)}</div>
                  <span className={`chip ${statusChipColor(l.status)}`}>{l.status}</span>
                </div>
                {l.payments.length === 0 ? (
                  <p style={{ fontSize: 12, color: "var(--muted)", padding: "6px 14px", margin: 0 }}>No payments in this range.</p>
                ) : (
                  <div className="tbl-wrap" style={{ border: "none" }}>
                    <table className="tbl tbl-tight">
                      <thead>
                        <tr><th>Payment</th><th className="num">Amount</th><th className="num">Interest</th><th className="num">Principal</th><th className="num">Balance</th></tr>
                      </thead>
                      <tbody>
                        {l.payments.map((p) => (
                          <tr key={p.id}>
                            <td>{fmtShortDate(p.paidOn)} — {p.type}</td>
                            <td className="num">{fmt(p.amount)}</td>
                            <td className="num">{fmt(p.interestApplied)}</td>
                            <td className="num">{fmt(p.principalApplied)}</td>
                            <td className="num">{fmt(p.runningBalance)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="ft" style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <span style={{ fontSize: 12.5, color: "var(--muted)" }}>
          {shown.length > 0 && (
            <>Statement total <b style={{ color: "var(--charcoal)" }}>{fmt(totalCollected)}</b> collected · <b style={{ color: "var(--charcoal)" }}>{fmt(totalOutstanding)}</b> outstanding</>
          )}
        </span>
        <span style={{ flex: 1 }} />
        <button className="btn ghost" onClick={closeModal}>Cancel</button>
        <button className="btn ghost" disabled={downloading !== null || shown.length === 0} onClick={() => handleDownload("xlsx")}>
          <Icon name="doc" /> {downloading === "xlsx" ? "Preparing…" : "Excel"}
        </button>
        <button className="btn" disabled={downloading !== null || shown.length === 0} onClick={() => handleDownload("pdf")}>
          <Icon name="doc" /> {downloading === "pdf" ? "Preparing…" : "PDF"}
        </button>
      </div>
    </>
  );
}
