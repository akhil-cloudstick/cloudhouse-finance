"use client";

import { useState } from "react";
import { useAuth } from "@/common/providers/AuthProvider";
import { useDownloadProgress } from "@/common/components/layout/NetworkIndicator";
import { drain } from "@/common/offline/sender";
import { OfflineStoragePanel } from "./OfflineStoragePanel";
import { OfflineReviewPanel } from "./OfflineReviewPanel";

/* One Settings section for everything offline on this PC: how far the offline copy has got (with a Sync now button),
 * where it is stored, and the entries the server refused. */
export function OfflinePanel() {
  const { can } = useAuth();
  const canReview = can("Business_Profile", "can_view_business_profile_module");
  const progress = useDownloadProgress();
  const [error, setError] = useState("");

  async function syncNow() {
    setError("");
    try {
      await drain("manual");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Sync failed. Try again.");
    }
  }

  const percent = Math.round(progress.fraction * 100);
  const determinate = progress.initial || progress.ready;
  const label = progress.active
    ? progress.initial
      ? `Downloading the offline copy… ${percent}%`
      : "Checking for changes…"
    : progress.ready
      ? "Offline copy is up to date."
      : `Offline copy ${percent}% downloaded. Press Sync now to continue.`;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24, maxWidth: 640 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
          <h4 style={{ margin: 0 }}>Offline copy</h4>
          <button type="button" className="btn sm" disabled={progress.active} onClick={() => void syncNow()}>
            {progress.active ? "Syncing…" : "Sync now"}
          </button>
        </div>
        <div
          className={`off-bar${determinate ? "" : " ind"}${progress.ready ? " done" : ""}`}
          role="progressbar"
          aria-label="Offline copy"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={determinate ? percent : undefined}
        >
          <i style={determinate ? { width: `${percent}%` } : undefined} />
        </div>
        <p role="status" style={{ margin: 0, color: "var(--muted)", fontSize: 13, lineHeight: 1.55 }}>{label}</p>
        {progress.active && (
          <p style={{ margin: 0, color: "var(--muted)", fontSize: 12.5 }}>Reloading the app is paused until the sync finishes.</p>
        )}
        {error && <p className="sa-error" style={{ margin: 0 }}>{error}</p>}
      </div>

      <OfflineStoragePanel />
      {canReview && <OfflineReviewPanel />}
    </div>
  );
}
