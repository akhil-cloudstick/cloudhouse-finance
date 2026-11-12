"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ConfirmModalContent } from "@/common/components/modals/ConfirmModalContent";
import { Icon } from "@/common/components/Icon";

/* One record that stops the delete: a gold loan, personal loan or investment, shown as
 * a link (opens in a new tab) when the role may open it, otherwise as plain bold text. */
export type DeleteBlocker = { key: string; kind: string; ref: string; status?: string; href?: string };

type Props = {
  title: string;
  /** The "This permanently deletes <name> (<code>)" line. */
  name: string;
  code: string;
  /** Re-run on open, on returning to this tab and on Refresh, so a record deleted in another tab drops off. */
  loadBlockers: () => Promise<DeleteBlocker[]>;
  onDelete: () => Promise<void>;
  /** Shown above the list, e.g. "Close or delete these first." */
  blockedHint?: string;
};

/* Permanent-delete confirmation that lists everything still in the way and keeps that list
 * live: opening a blocker in a new tab and deleting it there clears it here as soon as this tab
 * is focused again (or Refresh is pressed) — no page reload needed. */
export function DeleteWithBlockersModalContent({ title, name, code, loadBlockers, onDelete, blockedHint }: Props) {
  const [blockers, setBlockers] = useState<DeleteBlocker[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState("");
  const reqId = useRef(0);
  const loadRef = useRef(loadBlockers);
  loadRef.current = loadBlockers;

  const refresh = useCallback(async () => {
    const id = ++reqId.current;
    setLoading(true);
    try {
      const list = await loadRef.current();
      if (id !== reqId.current) return;
      setBlockers(list);
      setLoadErr("");
    } catch (e) {
      if (id !== reqId.current) return;
      setLoadErr(e instanceof Error ? e.message : "Could not check linked records.");
    } finally {
      if (id === reqId.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const onVisible = () => { if (document.visibilityState === "visible") void refresh(); };
    window.addEventListener("focus", onVisible);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      reqId.current++;
      window.removeEventListener("focus", onVisible);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refresh]);

  const blocked = blockers.length > 0;

  return (
    <ConfirmModalContent
      title={title}
      confirmLabel="Delete Permanently"
      busyLabel="Deleting…"
      disabled={loading || blocked}
      onConfirm={async () => {
        // Re-check right before deleting so a stale list can never let a blocked delete through.
        const fresh = await loadRef.current();
        if (fresh.length) { setBlockers(fresh); throw new Error("Linked records were added — clear them first."); }
        await onDelete();
      }}
    >
      <p style={{ fontSize: 13.5, margin: "0 0 4px" }}>This permanently deletes <strong>{name}</strong> ({code}). This cannot be undone.</p>
      {loadErr && <p style={{ color: "var(--red)", fontSize: 12.5, marginTop: 8 }}>{loadErr}</p>}
      {blocked && (
        <div style={{ marginTop: 12, color: "var(--red)", fontSize: 13, lineHeight: 1.5 }}>
          <div style={{ fontWeight: 600, display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
            <Icon name="warning" /> Linked records
          </div>
          <div style={{ marginBottom: 6 }}>{blockedHint || "Delete or close these first, then this can be deleted."}</div>
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {blockers.map((b) => (
              <li key={b.key}>
                {b.kind}{" "}
                {b.href
                  ? <a href={b.href} target="_blank" rel="noopener noreferrer" style={{ color: "inherit", fontWeight: 700, textDecoration: "underline" }}>{b.ref}</a>
                  : <strong>{b.ref}</strong>}
                {b.status ? <> ({b.status})</> : null}
              </li>
            ))}
          </ul>
        </div>
      )}
      <div style={{ marginTop: 10, fontSize: 12.5, color: "var(--muted)" }}>
        {loading ? "Checking linked records…" : !blocked && !loadErr ? "No linked records — safe to delete." : null}
      </div>
    </ConfirmModalContent>
  );
}
