"use client";

import { useEffect, useState } from "react";
import { getDevToolsPin, setDevToolsPin, SuperAdminApiError, type DevToolsPin } from "@/modules/superadmin/services/superadminService";
import { ReasonField } from "@/modules/superadmin/components/ReasonField";
import { fieldForMessage } from "@/common/components/ui/FieldError";

const SERVER_FIELDS: Record<string, RegExp> = { reason: /reason/i, pin: /pin/i };

type DevToolsPinModalProps = { onClose: () => void };

// The one platform-wide DevTools PIN — view, copy, and set/replace in one modal.
export function DevToolsPinModal({ onClose }: DevToolsPinModalProps) {
  const [current, setCurrent] = useState<DevToolsPin | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [copied, setCopied] = useState(false);

  const [editing, setEditing] = useState(false);
  const [pin, setPin] = useState("");
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fe, setFe] = useState<Record<string, string>>({});

  useEffect(() => {
    getDevToolsPin().then(setCurrent).catch(() => setCurrent(null));
  }, []);

  const fail = (field: string, msg: string) => { setError(null); setFe({ [field]: msg }); };
  const clearFe = (field: string) => setFe((cur) => (cur[field] ? { ...cur, [field]: "" } : cur));

  function copyPin() {
    if (!current?.pin) return;
    void navigator.clipboard.writeText(current.pin);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setFe({});
    if (!/^\d{4,6}$/.test(pin)) {
      fail("pin", "PIN must be 4-6 digits.");
      return;
    }
    if (!reason.trim()) {
      fail("reason", "A reason is required.");
      return;
    }
    setSubmitting(true);
    try {
      await setDevToolsPin(pin, reason);
      const fresh = await getDevToolsPin();
      setCurrent(fresh);
      setEditing(false);
      setPin("");
      setReason("");
    } catch (err) {
      const msg = err instanceof SuperAdminApiError ? err.message : "The action failed.";
      const field = err instanceof SuperAdminApiError ? fieldForMessage(msg, SERVER_FIELDS) : "";
      if (field) fail(field, msg); else setError(msg);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="sa-modal-backdrop" onClick={onClose}>
      <div className="sa-modal" onClick={(e) => e.stopPropagation()}>
        <div className="sa-modal-head">
          <h2>DevTools PIN</h2>
        </div>
        <div className="sa-modal-body">
          <p className="sa-modal-note">
            Gates Inspect/DevTools in every tenant's desktop app. One PIN, platform-wide.
          </p>

          {!editing && (
            <>
              {current?.isSet ? (
                <div className="sa-settings-row" style={{ marginBottom: 14 }}>
                  <span className="sa-settings-pin">{revealed ? current.pin : "••••••"}</span>
                  <button type="button" className="sa-btn" onClick={() => setRevealed((v) => !v)}>
                    {revealed ? "Hide" : "Show"}
                  </button>
                  <button type="button" className="sa-btn" onClick={copyPin}>
                    {copied ? "Copied" : "Copy"}
                  </button>
                </div>
              ) : (
                <p className="sa-modal-note">No PIN set yet — DevTools cannot be unlocked in any desktop app.</p>
              )}
              {current?.isSet && current.updatedAt && (
                <p className="sa-modal-note">Updated {new Date(current.updatedAt).toLocaleDateString()}</p>
              )}
            </>
          )}

          {editing && (
            <form onSubmit={submit}>
              <div className={fe.pin ? "sa-field has-err" : "sa-field"}>
                <label>New PIN (4-6 digits)</label>
                <input
                  type="password"
                  inputMode="numeric"
                  maxLength={6}
                  value={pin}
                  onChange={(e) => { setPin(e.target.value.replace(/\D/g, "")); clearFe("pin"); }}
                  required
                  autoFocus
                />
                {fe.pin && <span className="sa-error" role="alert">{fe.pin}</span>}
              </div>
              <ReasonField value={reason} onChange={(v) => { setReason(v); clearFe("reason"); }} required error={fe.reason} />
              {error && <p className="sa-error">{error}</p>}
              <div className="sa-modal-foot" style={{ padding: 0, marginTop: 12 }}>
                <span className="sa-foot-spacer" />
                <button type="button" className="sa-btn" onClick={() => setEditing(false)}>
                  Cancel
                </button>
                <button type="submit" className="sa-btn primary" disabled={submitting}>
                  {submitting ? "Working…" : "Save"}
                </button>
              </div>
            </form>
          )}
        </div>
        {!editing && (
          <div className="sa-modal-foot">
            <span className="sa-foot-spacer" />
            <button type="button" className="sa-btn" onClick={onClose}>
              Close
            </button>
            <button type="button" className="sa-btn primary" onClick={() => setEditing(true)}>
              {current?.isSet ? "Update PIN" : "Set PIN"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
