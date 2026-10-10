"use client";

import { useState } from "react";
import { useModal } from "@/common/components/ModalProvider";
import { Icon } from "@/common/components/Icon";
import { singleFlight } from "@/common/utils/singleFlight";

type ConfirmModalContentProps = {
  title: string;
  message?: React.ReactNode;
  children?: React.ReactNode;
  confirmLabel?: string;
  busyLabel?: string;
  danger?: boolean;
  disabled?: boolean;
  onConfirm: () => void | Promise<void>;
};

/* Generic yes/no confirmation modal — replaces browser confirm()/alert()
 * popups (which look out of place next to the rest of the app's modal UI)
 * for destructive/state-changing actions like deactivating a branch.
 * `onConfirm` may be async; the confirm button disables and shows a busy
 * label while it runs, and the modal only closes once it resolves. */
export function ConfirmModalContent({
  title,
  message,
  children,
  confirmLabel = "Confirm",
  busyLabel = "Working…",
  danger = true,
  disabled = false,
  onConfirm,
}: ConfirmModalContentProps) {
  const { closeModal } = useModal();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [shaking, setShaking] = useState(false);

  function triggerShake() {
    setShaking(true);
    setTimeout(() => setShaking(false), 400);
  }

  async function confirm() { return singleFlight("modal:confirm:confirm", async () => {
    if (disabled) {
      triggerShake();
      return;
    }
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
  }); }

  function handleConfirmClick(e: React.MouseEvent) {
    if (disabled) {
      e.preventDefault();
      triggerShake();
      return;
    }
    confirm();
  }

  return (
    <>
      <div className="hd"><h3>{title}</h3><button className="x" onClick={closeModal}>×</button></div>
      <div className="bd bd-scroll">
        {message && <div className="notice"><span>{message}</span></div>}
        {children}
        {err && <p style={{ color: "var(--red)", fontSize: 12.5, marginTop: 8 }}>{err}</p>}
      </div>
      <div className="ft">
        <button className="btn ghost" onClick={closeModal} disabled={busy}>Cancel</button>
        <button
          className={`btn${danger ? " danger" : ""}${shaking ? " btn-shake" : ""}`}
          onClick={handleConfirmClick}
          disabled={busy}
          style={
            disabled
              ? { opacity: 0.45, cursor: "not-allowed", filter: "saturate(0.5)" }
              : undefined
          }
        >
          {busy ? busyLabel : confirmLabel}
        </button>
      </div>
    </>
  );
}
