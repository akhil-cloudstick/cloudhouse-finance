"use client";

import { useState } from "react";
import { useModal } from "@/components/Modal";
import { Icon } from "@/lib/icons";

/* Generic yes/no confirmation modal — replaces browser confirm()/alert()
 * popups (which look out of place next to the rest of the app's modal UI)
 * for destructive/state-changing actions like deactivating a branch.
 * `onConfirm` may be async; the confirm button disables and shows a busy
 * label while it runs, and the modal only closes once it resolves. */
export function ConfirmModalContent({
  title,
  message,
  confirmLabel = "Confirm",
  busyLabel = "Working…",
  danger = true,
  onConfirm,
}: {
  title: string;
  message: React.ReactNode;
  confirmLabel?: string;
  busyLabel?: string;
  danger?: boolean;
  onConfirm: () => void | Promise<void>;
}) {
  const { closeModal } = useModal();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function confirm() {
    setBusy(true);
    setErr("");
    try {
      await onConfirm();
      closeModal();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="hd"><h3>{title}</h3><button className="x" onClick={closeModal}>×</button></div>
      <div className="bd">
        <div className="notice"><Icon name="shield" /> {message}</div>
        {err && <p style={{ color: "var(--red)", fontSize: 12.5, marginTop: 8 }}>{err}</p>}
      </div>
      <div className="ft">
        <button className="btn ghost" onClick={closeModal} disabled={busy}>Cancel</button>
        <button className={`btn${danger ? " danger" : ""}`} onClick={confirm} disabled={busy}>
          {busy ? busyLabel : confirmLabel}
        </button>
      </div>
    </>
  );
}
