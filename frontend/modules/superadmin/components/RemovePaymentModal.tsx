"use client";

import { useState } from "react";
import { deletePayment, SuperAdminApiError } from "@/modules/superadmin/services/superadminService";
import { type Business, type SubscriptionPayment } from "@/modules/superadmin/types/superadmin-types";
import { ReasonField } from "@/modules/superadmin/components/ReasonField";
import { fieldForMessage } from "@/common/components/ui/FieldError";
import { formatINR, formatDate } from "@/modules/superadmin/utils/dashboardHelpers";

// Server messages are put on the field they are about, by wording.
const SERVER_FIELDS: Record<string, RegExp> = { reason: /reason/i };

type RemovePaymentModalProps = {
  business: Business;
  payment: SubscriptionPayment;
  onClose: () => void;
  onDone: () => void;
};

export function RemovePaymentModal({
  business,
  payment,
  onClose,
  onDone,
}: RemovePaymentModalProps) {
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
    if (!reason.trim()) {
      fail("reason", "A reason is required.");
      return;
    }
    setSubmitting(true);
    try {
      await deletePayment(business.id, payment.id, reason);
      onDone();
    } catch (err) {
      const msg = err instanceof SuperAdminApiError ? err.message : "Could not remove the payment.";
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
          <h2>Remove payment record</h2>
        </div>
        <div className="sa-modal-body">
          <p className="sa-modal-note danger">
            Removes the {formatINR(payment.amountInPaise / 100)} payment of {formatDate(payment.paidOn)} from{" "}
            {business.name}&rsquo;s history. The audit log keeps a record that it existed.
          </p>
          <ReasonField value={reason} onChange={(v) => { setReason(v); clearFe("reason"); }} required error={fe.reason} />
          {error && <p className="sa-error">{error}</p>}
        </div>
        <div className="sa-modal-foot">
          <span className="sa-foot-spacer" />
          <button type="button" className="sa-btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="sa-btn danger" disabled={submitting}>
            {submitting ? "Removing…" : "Remove"}
          </button>
        </div>
      </form>
    </div>
  );
}
