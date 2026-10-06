"use client";

import { useState } from "react";
import { useModal } from "@/product/components/Modal";
import { singleFlight } from "@/product/utils/singleFlight";

/* "Reject — why?" prompt shared by the approval-chain screens (top-up,
 * personal loan, expense). Holds its own remarks state —
 * a ConfirmModal whose children read the opener's state would only ever see
 * the value captured when the modal opened. `onConfirm` may be async and
 * may throw; its message is shown inline and the modal stays open. */
export function RejectRemarksModalContent({
  title,
  required = false,
  onConfirm,
}: {
  title: string;
  required?: boolean;
  onConfirm: (remarks: string) => void | Promise<void>;
}) {
  const { closeModal } = useModal();
  const [remarks, setRemarks] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function confirm() { return singleFlight("modal:rejectremarks:confirm", async () => {
    if (required && !remarks.trim()) { setErr("Please enter a reason for rejecting."); return; }
    setBusy(true);
    setErr("");
    try {
      await onConfirm(remarks.trim());
      closeModal();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }); }

  return (
    <>
      <div className="hd"><h3>{title}</h3><button className="x" onClick={closeModal}>×</button></div>
      <div className="bd bd-scroll">
        <div className="frow">
          <div>
            <label className="f">Reason for rejecting{required ? " *" : " (optional)"}</label>
            <input className="inp" autoFocus value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder={required ? "" : "optional"} />
          </div>
        </div>
        <p style={{ color: "var(--red)", fontSize: 12.5, minHeight: 16, marginTop: 8 }}>{err}</p>
      </div>
      <div className="ft">
        <button className="btn ghost" onClick={closeModal}>Cancel</button>
        <button className="btn danger" disabled={busy} onClick={confirm}>{busy ? "Rejecting…" : "Reject"}</button>
      </div>
    </>
  );
}
