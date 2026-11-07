"use client";

import { useEffect, useState } from "react";
import { offlineStore } from "@/common/services/desktopBridge";
import { startOffline, stopOffline } from "@/common/offline";

/* The storage-folder part of the Offline settings: where this PC keeps its offline data, and a way to move it. Moving
 * copies what is stored to the new folder and leaves the old one in place. */
export function OfflineStoragePanel() {
  const [folder, setFolder] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    void offlineStore.root().then(setFolder).catch(() => {});
  }, []);

  async function change() {
    setBusy(true);
    setMessage("");
    setError("");
    try {
      stopOffline(); // nothing may write to the old folder while it is being copied
      const picked = await offlineStore.chooseFolder();
      if (picked) {
        setFolder(picked);
        setMessage("Moved. The old folder was left in place, so you can delete it once you have checked the new one.");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "That folder could not be used.");
    } finally {
      await startOffline(); // on the new folder, or back on the old one if nothing was picked
      setBusy(false);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div>
        <h4 style={{ margin: "0 0 6px" }}>Storage folder</h4>
        <p style={{ margin: 0, color: "var(--muted)", fontSize: 13, lineHeight: 1.55 }}>
          Loans, customers and anything saved while the server is unreachable are kept in this folder until they are sent.
        </p>
      </div>

      <div
        title={folder}
        style={{
          padding: "10px 12px",
          border: "1px solid var(--line)",
          borderRadius: 8,
          background: "rgba(0,0,0,.025)",
          fontFamily: "ui-monospace, SFMono-Regular, Consolas, monospace",
          fontSize: 12.5,
          lineHeight: 1.5,
          wordBreak: "break-all",
          userSelect: "all",
        }}
      >
        {folder || "…"}
      </div>

      <div>
        <button type="button" className="btn" disabled={busy} onClick={() => void change()}>
          {busy ? "Working…" : "Change folder…"}
        </button>
        <p style={{ margin: "10px 0 0", color: "var(--muted)", fontSize: 12.5, lineHeight: 1.5 }}>
          Existing offline data is copied to the new folder. The old folder is not deleted.
        </p>
      </div>

      {message && <p className="sa-hint" style={{ margin: 0 }}>{message}</p>}
      {error && <p className="sa-error" style={{ margin: 0 }}>{error}</p>}
    </div>
  );
}
