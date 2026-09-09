"use client";

import { useState } from "react";
import { useModal } from "@/common/components/Modal";
import { Icon } from "@/common/components/Icon";

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
        {/* {message} is wrapped in its own <span> rather than dropped
         * directly into this flex row — a caller passing a Fragment with
         * multiple lines/paragraphs (<br/> pairs, a <strong>, plain text)
         * would otherwise have each of those children become its OWN flex
         * item here (Fragments don't render a wrapping element), scattering
         * a multi-line warning into a broken multi-column layout instead of
         * stacked lines. One wrapper = one flex item = normal block flow
         * inside it. */}
        <div className="notice"><Icon name="shield" /> <span>{message}</span></div>
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
