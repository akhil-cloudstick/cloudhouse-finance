"use client";

import { useCallback, useEffect, useState } from "react";
import { REVIEW_CHANGED_EVENT, describeEntry, discardReview, listReview, retryReview, type ReviewRow } from "@/common/offline/review";

const when = (ms: number) => new Date(ms).toLocaleString();

/* Desktop-only Settings section for admins: entries made on this PC while offline that the server refused when they
 * were sent. Each one keeps the server's reason. Retry sends it again; Discard gives it up for good. */
export function OfflineReviewPanel() {
  const [rows, setRows] = useState<ReviewRow[] | null>(null);
  const [open, setOpen] = useState<string>("");
  const [confirm, setConfirm] = useState<string>("");
  const [busy, setBusy] = useState<string>("");
  const [error, setError] = useState("");

  const load = useCallback(() => listReview().then(setRows, () => setRows([])), []);

  useEffect(() => {
    const refresh = () => void load();
    refresh();
    window.addEventListener(REVIEW_CHANGED_EVENT, refresh);
    return () => window.removeEventListener(REVIEW_CHANGED_EVENT, refresh);
  }, [load]);

  async function act(row: ReviewRow, run: (r: ReviewRow) => Promise<void>) {
    setBusy(row.id);
    setError("");
    try {
      await run(row);
      setConfirm("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "That did not work. Try again.");
    } finally {
      setBusy("");
      await load();
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18, maxWidth: 640 }}>
      <div>
        <h4 style={{ margin: "0 0 6px" }}>Offline review</h4>
        <p style={{ margin: 0, color: "var(--muted)", fontSize: 13, lineHeight: 1.55 }}>
          Entries saved on this PC while the server was unreachable, which the server then refused. They stay here with the
          server&apos;s reason until you retry or discard them.
        </p>
      </div>

      {rows === null && <p style={{ margin: 0, color: "var(--muted)", fontSize: 13 }}>Loading…</p>}

      {rows?.length === 0 && (
        <div style={{ padding: "14px 16px", borderRadius: 8, background: "var(--green-bg)", color: "var(--green)", fontSize: 13, fontWeight: 600 }}>
          Nothing needs review. Every entry from this PC was accepted.
        </div>
      )}

      {rows?.map((row) => {
        const isOpen = open === row.id;
        const working = busy === row.id;
        return (
          <div key={row.id} style={{ border: "1px solid var(--line)", borderRadius: 10, background: "var(--card)", padding: "12px 14px", display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
              <strong style={{ fontSize: 14 }}>{describeEntry(row.entry)}</strong>
              <span style={{ fontSize: 11.5, fontWeight: 600, padding: "2px 9px", borderRadius: 999, background: "var(--amber-bg)", color: "var(--amber)" }}>
                Needs review
              </span>
            </div>
            <div style={{ fontSize: 12.5, color: "var(--muted)", lineHeight: 1.5 }}>
              Saved by {row.entry.actor?.name || "unknown"} on {when(Date.parse(row.entry.occurredAt) || row.createdAt)}. Refused {when(row.reviewAt)}.
            </div>
            <div style={{ padding: "9px 11px", borderRadius: 8, background: "var(--red-bg)", color: "var(--red)", fontSize: 13, lineHeight: 1.5 }}>
              <strong>Server said:</strong> {row.message || "The server did not accept this."}
            </div>
            {row.heldEntries.length > 0 && (
              <div style={{ fontSize: 12.5, color: "var(--amber)" }}>
                Waiting behind this one on the same record: {row.heldEntries.map(describeEntry).join(", ")}.
              </div>
            )}

            {isOpen && (
              <pre style={{ margin: 0, maxHeight: 180, overflow: "auto", padding: "8px 10px", borderRadius: 6, background: "rgba(0,0,0,.035)", fontSize: 11.5, lineHeight: 1.45, whiteSpace: "pre-wrap", wordBreak: "break-all" }}>
                {JSON.stringify({ method: row.entry.method, path: row.entry.path, body: row.entry.body }, null, 2)}
              </pre>
            )}

            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              {confirm === row.id ? (
                <>
                  <span style={{ fontSize: 12.5, color: "var(--red)" }}>
                    Discard this entry{row.heldEntries.length > 0 ? ` and the ${row.heldEntries.length} waiting behind it` : ""}? The changes are lost for good.
                  </span>
                  <button type="button" className="btn danger sm" disabled={working} onClick={() => void act(row, discardReview)}>
                    {working ? "Working…" : "Yes, discard"}
                  </button>
                  <button type="button" className="btn ghost sm" disabled={working} onClick={() => setConfirm("")}>Keep</button>
                </>
              ) : (
                <>
                  <button type="button" className="btn sm" disabled={working} onClick={() => void act(row, retryReview)}>
                    {working ? "Working…" : "Retry"}
                  </button>
                  <button type="button" className="btn danger sm" disabled={working} onClick={() => setConfirm(row.id)}>Discard</button>
                  <button type="button" className="btn ghost sm" onClick={() => setOpen(isOpen ? "" : row.id)}>
                    {isOpen ? "Hide details" : "Details"}
                  </button>
                </>
              )}
            </div>
          </div>
        );
      })}

      {error && <p className="sa-error" style={{ margin: 0 }}>{error}</p>}
    </div>
  );
}
