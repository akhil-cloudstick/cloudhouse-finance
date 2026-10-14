"use client";

import { useState } from "react";
import { setTierPrice, SuperAdminApiError } from "@/modules/superadmin/services/superadminService";
import { type Tier } from "@/modules/superadmin/types/superadmin-types";
import { ReasonField } from "@/modules/superadmin/components/ReasonField";
import { fieldForMessage } from "@/common/components/ui/FieldError";

// Server messages are put on the field they are about, by wording.
const SERVER_FIELDS: Record<string, RegExp> = { reason: /reason/i, price: /price|amount/i };

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
  const [fe, setFe] = useState<Record<string, string>>({});

  const fail = (field: string, msg: string) => { setError(null); setFe({ [field]: msg }); };
  const clearFe = (field: string) => setFe((cur) => (cur[field] ? { ...cur, [field]: "" } : cur));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setFe({});
    const value = Number(rupees);
    if (!Number.isFinite(value) || value < 0) {
      fail("price", "Enter a valid, non-negative amount.");
      return;
    }
    if (!reason.trim()) {
      fail("reason", "A reason is required.");
      return;
    }
    setSubmitting(true);
    try {
      await setTierPrice(tier.id, Math.round(value * 100), reason);
      onDone();
      onClose();
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
      <form className="sa-modal" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <div className="sa-modal-head">
          <h2>Set price — {tier.name}</h2>
        </div>
        <div className="sa-modal-body">
          <p className="sa-modal-note">
            Existing subscribers keep billing at their current price until they resubscribe or renew — this only
            affects the NEXT subscription created against this tier.
          </p>
          <div className={fe.price ? "sa-field has-err" : "sa-field"}>
            <label>Monthly price (₹)</label>
            <input type="number" min={0} step="1" value={rupees} onChange={(e) => { setRupees(e.target.value); clearFe("price"); }} required />
            {fe.price && <span className="sa-error" role="alert">{fe.price}</span>}
          </div>
          <ReasonField value={reason} onChange={(v) => { setReason(v); clearFe("reason"); }} required error={fe.reason} />
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
