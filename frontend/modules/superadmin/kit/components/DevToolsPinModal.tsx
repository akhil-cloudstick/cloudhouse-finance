import { useEffect, useState } from "react";
import { ReasonField } from "./ReasonField";
import { fieldForMessage } from "../common/FieldError";

const SERVER_FIELDS: Record<string, RegExp> = { reason: /reason/i, pin: /pin/i };

/** One product's DevTools PIN: how it is read and saved, and its rule. */
export type DevToolsPinAdapter = {
  load: () => Promise<{ pin: string; isSet: boolean; updatedAt?: string | null }>;
  save: (pin: string, reason: string) => Promise<unknown>;
  pattern: RegExp;
  /** e.g. "4-6 digits" or "6 digits". */
  rule: string;
  maxLength: number;
  /** Whether the product records a reason with the change. */
  needsReason: boolean;
};

type DevToolsPinModalProps = { pin: DevToolsPinAdapter; onClose: () => void };

// The one platform-wide DevTools PIN of a product — view, copy, and set/replace in one modal.
export function DevToolsPinModal({ pin: adapter, onClose }: DevToolsPinModalProps) {
  const [current, setCurrent] = useState<{ pin: string; isSet: boolean; updatedAt?: string | null } | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [copied, setCopied] = useState(false);

  const [editing, setEditing] = useState(false);
  const [pin, setPin] = useState("");
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fe, setFe] = useState<Record<string, string>>({});

  useEffect(() => {
    adapter.load().then(setCurrent).catch(() => setCurrent(null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    if (!adapter.pattern.test(pin)) {
      fail("pin", `PIN must be ${adapter.rule}.`);
      return;
    }
    if (adapter.needsReason && !reason.trim()) {
      fail("reason", "A reason is required.");
      return;
    }
    setSubmitting(true);
    try {
      await adapter.save(pin, reason);
      setCurrent(await adapter.load());
      setEditing(false);
      setPin("");
      setReason("");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "The action failed.";
      const field = err instanceof Error ? fieldForMessage(msg, SERVER_FIELDS) : "";
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
            Gates Inspect/DevTools in every tenant&apos;s desktop app. One PIN, platform-wide.
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
                <label>New PIN ({adapter.rule})</label>
                <input
                  type="password"
                  inputMode="numeric"
                  maxLength={adapter.maxLength}
                  value={pin}
                  onChange={(e) => { setPin(e.target.value.replace(/\D/g, "")); clearFe("pin"); }}
                  required
                  autoFocus
                />
                {fe.pin && <span className="sa-error" role="alert">{fe.pin}</span>}
              </div>
              {adapter.needsReason && (
                <ReasonField value={reason} onChange={(v) => { setReason(v); clearFe("reason"); }} required error={fe.reason} />
              )}
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
