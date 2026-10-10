"use client";

import { useState } from "react";
import { setTierPrice, SuperAdminApiError } from "@/modules/superadmin/services/superadminService";
import { type Tier } from "@/modules/superadmin/types/superadmin-types";
import { ReasonField } from "@/modules/superadmin/components/ReasonField";

type TierPriceModalProps = { tier: Tier; onClose: () => void; onDone: () => void };

/* Sets a tier's monthly Razorpay subscription price (plan Step 10).
 * Vendor-only pricing lever — deliberately absent from anything a tenant's
 * own admin can reach; see superadmin.Service.SetTierPrice's doc comment
 * for why changing it never mutates an in-flight subscription's price. */
export function TierPriceModal({ tier, onClose, onDone }: TierPriceModalProps) {
  const [rupees, setRupees] = useState(String(tier.priceInPaise / 100));
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const value = Number(rupees);
    if (!Number.isFinite(value) || value < 0) {
      setError("Enter a valid, non-negative amount.");
      return;
    }
    if (!reason.trim()) {
      setError("A reason is required.");
      return;
    }
    setSubmitting(true);
    try {
      await setTierPrice(tier.id, Math.round(value * 100), reason);
      onDone();
      onClose();
    } catch (err) {
      setError(err instanceof SuperAdminApiError ? err.message : "The action failed.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="sa-modal-backdrop" onClick={onClose}>
      <form className="sa-modal" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <div className="sa-modal-head">
          <h2>Set price — {tier.name}</h2>
        </div>
        <div className="sa-modal-body">
          <p className="sa-modal-note">
            Existing subscribers keep billing at their current price until they resubscribe or renew — this only
            affects the NEXT subscription created against this tier.
          </p>
          <div className="sa-field">
            <label>Monthly price (₹)</label>
            <input type="number" min={0} step="1" value={rupees} onChange={(e) => setRupees(e.target.value)} required />
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
            {submitting ? "Working…" : "Set price"}
          </button>
        </div>
      </form>
    </div>
  );
}
