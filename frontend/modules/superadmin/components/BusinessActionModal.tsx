"use client";

import { useState } from "react";
import { suspendBusiness, reactivateBusiness, deleteBusiness, changeTier, SuperAdminApiError } from "@/modules/superadmin/services/superadminService";
import { type Business, type Tier } from "@/modules/superadmin/types/superadmin-types";
import { Select } from "@/modules/superadmin/components/Select";
import { ReasonField } from "@/modules/superadmin/components/ReasonField";
import { plansFor, downgradeNote, planLabel } from "@/modules/superadmin/utils/dashboardHelpers";
import { useActiveBranches } from "@/modules/superadmin/hooks/use-active-branches";

type BusinessActionModalProps = {
  business: Business;
  kind: "suspend" | "reactivate" | "tier" | "delete";
  tiers: Tier[];
  /* Known when opened from the detail page — lets the plan change warn that
   * the business is already above the new plan's branch limit. */
  activeBranches?: number;
  onClose: () => void;
  onDone: () => void;
};

export function BusinessActionModal({
  business,
  kind,
  tiers,
  activeBranches,
  onClose,
  onDone,
}: BusinessActionModalProps) {
  const [reason, setReason] = useState("");
  const [tierId, setTierId] = useState(business.tierId);
  const [confirmCode, setConfirmCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const title =
    kind === "suspend"
      ? "Suspend business"
      : kind === "reactivate"
        ? "Reactivate business"
        : kind === "delete"
          ? "Delete business permanently"
          : "Change plan";
  // Plans below the business's active branch count aren't offered at all
  // (the server refuses them too).
  const branches = useActiveBranches(kind === "tier" ? business.id : null, activeBranches);
  const planOptions = plansFor(tiers);
  const planNote = downgradeNote(tiers.find((t) => t.id === tierId), branches);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!reason.trim()) {
      setError("A reason is required.");
      return;
    }
    if (kind === "delete" && confirmCode.trim() !== business.code) {
      setError(`Type ${business.code} exactly to confirm.`);
      return;
    }
    setSubmitting(true);
    try {
      if (kind === "suspend") await suspendBusiness(business.id, reason);
      else if (kind === "reactivate") await reactivateBusiness(business.id, reason);
      else if (kind === "delete") await deleteBusiness(business.id, reason);
      else await changeTier(business.id, tierId, reason);
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
          <h2>
            {title} — {business.name}
          </h2>
        </div>
        <div className="sa-modal-body">
          {kind === "suspend" && (
            <p className="sa-modal-note">
              Restricts new lending and administration only. Never blocks a borrower repaying or collecting gold they
              have already paid for.
            </p>
          )}
          {kind === "delete" && (
            <>
              <p className="sa-modal-note danger">
                This permanently deletes {business.name} — every branch, customer, loan, staff login and its logo
                file. This cannot be undone.
              </p>
              <div className="sa-field">
                <label>
                  Type <b>{business.code}</b> to confirm
                </label>
                <input value={confirmCode} onChange={(e) => setConfirmCode(e.target.value)} autoComplete="off" />
              </div>
            </>
          )}
          {kind === "tier" && (
            <>
              <div className="sa-field">
                <label>New plan</label>
                <Select
                  value={String(tierId)}
                  onChange={(v) => setTierId(Number(v))}
                  ariaLabel="New plan"
                  options={planOptions.map((t) => ({ value: String(t.id), label: planLabel(t) }))}
                />
                <span className="sa-hint">Takes effect immediately. Existing branches are never removed.</span>
              </div>
              {planNote && <p className="sa-modal-note">{planNote}</p>}
            </>
          )}
          <ReasonField value={reason} onChange={setReason} required />
          {error && <p className="sa-error">{error}</p>}
        </div>
        <div className="sa-modal-foot">
          <span className="sa-foot-spacer" />
          <button type="button" className="sa-btn" onClick={onClose}>
            Cancel
          </button>
          <button
            type="submit"
            className={`sa-btn ${kind === "suspend" || kind === "delete" ? "danger" : "primary"}`}
            disabled={submitting}
          >
            {submitting ? "Working…" : title}
          </button>
        </div>
      </form>
    </div>
  );
}
