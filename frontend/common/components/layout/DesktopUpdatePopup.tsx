"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { useModal } from "@/common/components/ModalProvider";
import { SettingsModalContent } from "@/modules/integrations/components/SettingsModalContent";
import {
  isDesktop,
  checkForUpdate,
  checkForContentUpdate,
  downloadUpdate,
  downloadContentUpdate,
  onUpdateEvent,
  onContentUpdateEvent,
} from "@/common/services/desktopBridge";

const subscribeNever = () => () => {};

// Desktop-only popup; dismiss closes this instance only, not snoozed — AccountMenu's dot stays on.
export function DesktopUpdatePopup() {
  const desktop = useSyncExternalStore(subscribeNever, isDesktop, () => false);
  const { openModal } = useModal();
  const [kind, setKind] = useState<"full" | "content" | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (!desktop) return;
    const unsubscribe = [
      onUpdateEvent("available", () => setKind((k) => k ?? "full")),
      onContentUpdateEvent("available", () => setKind((k) => k ?? "content")),
    ];
    void checkForUpdate();
    void checkForContentUpdate();
    return () => unsubscribe.forEach((off) => off());
  }, [desktop]);

  if (!desktop || !kind || dismissed) return null;

  function download() {
    if (kind === "full") void downloadUpdate();
    else void downloadContentUpdate();
    openModal(<SettingsModalContent initialSection="version" />, true);
  }

  return (
    <div className="desktop-update-toast" role="status">
      <span>A new version is available.</span>
      <button type="button" className="btn" onClick={download}>
        Download
      </button>
      <button
        type="button"
        className="desktop-update-toast-close"
        aria-label="Dismiss"
        onClick={() => setDismissed(true)}
      >
        ×
      </button>
    </div>
  );
}
