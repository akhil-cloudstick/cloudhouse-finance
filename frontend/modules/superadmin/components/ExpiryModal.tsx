"use client";

import { useState } from "react";
import { adjustExpiry, SuperAdminApiError } from "@/modules/superadmin/services/superadminService";
import { type Business } from "@/modules/superadmin/types/superadmin-types";
import { ReasonField } from "@/modules/superadmin/components/ReasonField";

type ExpiryModalProps = { business: Business; onClose: () => void; onDone: () => void };

/* Sets (or clears) the renewal/expiry date by hand — the existing
 * PUT /superadmin/businesses/:id/expiry, which had no screen until now. */
export function ExpiryModal({ business, onClose, onDone }: ExpiryModalProps) {
  const [date, setDate] = useState(business.subscriptionExpiresAt ? business.subscriptionExpiresAt.slice(0, 10) : "");
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!reason.trim()) {
      setError("A reason is required.");
      return;
    }
    setSubmitting(true);
    try {
      // End of the chosen day, so "expires 30 Sep" is still usable all of 30 Sep.
      await adjustExpiry(business.id, date ? new Date(`${date}T23:59:59`).toISOString() : null, reason);
      onDone();
    } catch (err) {
      setError(err instanceof SuperAdminApiError ? err.message : "Could not change the renewal date.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="sa-modal-backdrop" onClick={onClose}>
      <form className="sa-modal" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <div className="sa-modal-head">
          <h2>Renewal date — {business.name}</h2>
        </div>
        <div className="sa-modal-body">
          <div className="sa-field">
            <label>Renews / expires on</label>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            <span className="sa-hint">Leave empty to clear it (no expiry).</span>
          </div>
          <ReasonField value={reason} onChange={setReason} required />
          {error && <p className="sa-error">{error}</p>}
        </div>
        <div className="sa-modal-foot">
          <span className="sa-foot-spacer" />
          <button type="button" className="sa-btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="sa-btn primary" disabled={submitting}>
            {submitting ? "Saving…" : "Save"}
          </button>
        </div>
      </form>
    </div>
  );
}
