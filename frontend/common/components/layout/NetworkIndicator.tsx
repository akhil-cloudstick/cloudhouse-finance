"use client";

import { useEffect, useState } from "react";
import { isDesktop } from "@/common/services/desktopBridge";
import { offlineReady } from "@/common/offline";
import { NETWORK_EVENT, isReachable } from "@/common/offline/network";
import { SYNC_STATE_EVENT, isSyncing } from "@/common/offline/sender";
import { PROGRESS_EVENT, downloadProgress, type DownloadProgress } from "@/common/offline/progress";

/* Desktop app only. Whether the server can be reached is shown as a red ring around the profile picture (see
 * AccountMenu); nothing is drawn while online. This component draws nothing itself: it keeps the page from being
 * reloaded or closed while a sync is running (F5, Ctrl+R, the window's own reload), because the send would be cut
 * half way and the answer lost. */

/* True on the desktop app while offline mode is running and the server did not answer the last request. */
export function useOfflineRing(): boolean {
  const [off, setOff] = useState(false);
  useEffect(() => {
    const update = () => setOff(isDesktop() && offlineReady() && !isReachable());
    update();
    window.addEventListener(NETWORK_EVENT, update);
    const t = setInterval(update, 15_000);
    return () => {
      window.removeEventListener(NETWORK_EVENT, update);
      clearInterval(t);
    };
  }, []);
  return off;
}

/* True while the sender is sending or pulling (desktop app only), for the spinning ring around the profile picture. */
export function useSyncingRing(): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => {
    const update = () => setOn(isDesktop() && isSyncing());
    update();
    window.addEventListener(SYNC_STATE_EVENT, update);
    return () => window.removeEventListener(SYNC_STATE_EVENT, update);
  }, []);
  return on;
}

/* How far the offline copy has got (desktop app only), for the progress ring around the profile picture and the bar in
 * Settings. `initial` is true until the copy has been complete once; only then is the percentage shown. */
export function useDownloadProgress(): DownloadProgress {
  const [progress, setProgress] = useState<DownloadProgress>(() => downloadProgress());
  useEffect(() => {
    const update = () => setProgress(downloadProgress());
    update();
    window.addEventListener(PROGRESS_EVENT, update);
    return () => window.removeEventListener(PROGRESS_EVENT, update);
  }, []);
  return progress;
}

export function NetworkIndicator() {
  const [syncing, setSyncing] = useState(false);
  // set when a reload was attempted (F5, Ctrl+R) during a sync and refused; the notice stays until it is dealt with
  const [blocked, setBlocked] = useState(false);

  useEffect(() => {
    const refresh = () => setSyncing(isSyncing());
    refresh();
    window.addEventListener(SYNC_STATE_EVENT, refresh);
    return () => window.removeEventListener(SYNC_STATE_EVENT, refresh);
  }, []);

  // while a sync is running the page cannot be reloaded or closed (F5, Ctrl+R, the window's own reload): the send
  // would be cut half way and the answer lost
  useEffect(() => {
    if (!syncing) return;
    const onKey = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (k === "f5" || ((e.ctrlKey || e.metaKey) && k === "r")) {
        e.preventDefault();
        e.stopPropagation();
        setBlocked(true);
      }
    };
    const onUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("beforeunload", onUnload);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("beforeunload", onUnload);
    };
  }, [syncing]);

  if (!blocked) return null;
  return (
    <div
      role="status"
      style={{ position: "fixed", bottom: 18, left: "50%", transform: "translateX(-50%)", zIndex: 9999, display: "flex", alignItems: "center", gap: 12, padding: "10px 14px", borderRadius: 10, background: "var(--card, #fff)", color: "var(--ink, #111)", border: "1px solid var(--line, #ddd)", boxShadow: "0 8px 24px rgba(0,0,0,.18)", fontSize: 13 }}
    >
      <span>{syncing ? "Syncing with the server — refresh is paused until it finishes." : "Sync finished. You can refresh now."}</span>
      <button type="button" className="btn sm" disabled={syncing} onClick={() => window.location.reload()}>Refresh</button>
      <button type="button" className="btn sm ghost" onClick={() => setBlocked(false)} aria-label="Dismiss">✕</button>
    </div>
  );
}
