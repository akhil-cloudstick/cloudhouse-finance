"use client";

import { useEffect, useState } from "react";
import { isDesktop } from "@/common/services/desktopBridge";
import { offlineReady } from "@/common/offline";
import { NETWORK_EVENT, isReachable } from "@/common/offline/network";
import { SYNC_STATE_EVENT, isSyncing } from "@/common/offline/sender";

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

export function NetworkIndicator() {
  const [syncing, setSyncing] = useState(false);

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

  return null;
}
