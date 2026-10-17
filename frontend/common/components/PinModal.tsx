"use client";

import { useState, type FormEvent } from "react";
import { unlockDevTools } from "@/common/services/devToolsAccess";
import { openDevTools } from "@/common/services/desktopBridge";

type PinModalProps = {
  onClose: () => void;
};

// Asks for the platform-wide DevTools PIN every time — never a one-time unlock.
export function PinModal({ onClose }: PinModalProps) {
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [checking, setChecking] = useState(false);
  const [visible, setVisible] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (checking) return;
    setChecking(true);
    setError("");
    const ok = await unlockDevTools(pin);
    setChecking(false);
    if (!ok) {
      setError("Incorrect PIN.");
      setPin("");
      return;
    }
    await openDevTools();
    onClose();
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, zIndex: 10000,
        background: "rgba(0,0,0,.45)",
        display: "flex", alignItems: "center", justifyContent: "center",
      }}
    >
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={submit}
        style={{
          background: "#fff", borderRadius: 12, padding: 24, width: 280,
          boxShadow: "0 12px 40px rgba(0,0,0,.25)",
          fontFamily: "inherit",
        }}
      >
        <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 12, color: "#11101a" }}>
          Enter PIN to continue
        </div>
        <div style={{ position: "relative" }}>
          <input
            type={visible ? "text" : "password"}
            inputMode="numeric"
            maxLength={6}
            autoFocus
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
            style={{
              width: "100%", boxSizing: "border-box", fontSize: 18, letterSpacing: 6,
              textAlign: "center", padding: "10px 36px 10px 12px", borderRadius: 8,
              border: error ? "1px solid #c0392b" : "1px solid #ddd", outline: "none",
            }}
          />
          {/* Edge/WebView2's own native reveal icon (::-ms-reveal) renders
              alongside this and looks oversized/bold — hidden via CSS below,
              replaced with this smaller, same-weight-as-the-rest-of-the-app
              toggle. */}
          <style>{"input::-ms-reveal,input::-ms-clear{display:none}"}</style>
          <button
            type="button"
            onClick={() => setVisible((v) => !v)}
            aria-label={visible ? "Hide PIN" : "Show PIN"}
            style={{
              position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)",
              border: "none", background: "transparent", padding: 2, cursor: "pointer",
              display: "flex", color: "#8a8a93",
            }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
              <path d="M2 12s3.5-6.5 10-6.5S22 12 22 12s-3.5 6.5-10 6.5S2 12 2 12Z" />
              {visible ? <path d="M4 4l16 16" /> : <circle cx="12" cy="12" r="2.8" />}
            </svg>
          </button>
        </div>
        {error && <div style={{ color: "#c0392b", fontSize: 12, marginTop: 8 }}>{error}</div>}
        <div style={{ display: "flex", gap: 8, marginTop: 16, justifyContent: "flex-end" }}>
          <button
            type="button"
            onClick={onClose}
            style={{ padding: "8px 14px", borderRadius: 8, border: "1px solid #ddd", background: "#fff", cursor: "pointer" }}
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={checking || pin.length < 4}
            style={{
              padding: "8px 14px", borderRadius: 8, border: "none", color: "#fff",
              background: "#6054bf", cursor: checking || pin.length < 4 ? "not-allowed" : "pointer",
              opacity: checking || pin.length < 4 ? 0.6 : 1,
            }}
          >
            {checking ? "Checking…" : "Unlock"}
          </button>
        </div>
      </form>
    </div>
  );
}
