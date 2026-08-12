"use client";

import { useEffect, useState } from "react";
import { useModal } from "@/components/Modal";
import { useToast } from "@/components/Toast";
import { Icon } from "@/lib/icons";
import { fmt } from "@/lib/format";
import { getLoanOperatorApprovalLimit, setLoanOperatorApprovalLimit } from "@/lib/loansApi";
import { ApiError } from "@/lib/api";

/* Opened from Employees.tsx's "Roles" button. Currently shows/edits just
 * the Loan Operator's approval limit — the one role-level setting the app
 * hard-enforces (see backend/internal/loan's ApprovalLimit/Approve stage-
 * role check: a Loan Operator cannot themselves approve a loan above this
 * amount, only Branch Manager/Management/Administrator can clear that
 * stage above it). Branch Manager/Management keep their old hardcoded,
 * advisory-only limits — an explicit scope decision, not an oversight. */
export function RolesModalContent() {
  const { closeModal } = useModal();
  const toast = useToast();

  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState("");
  const [maxAmount, setMaxAmount] = useState("");
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    getLoanOperatorApprovalLimit()
      .then((rec) => setMaxAmount(String(rec.maxAmount)))
      .catch((e) => setLoadErr(e instanceof Error ? e.message : "Failed to load the current limit."))
      .finally(() => setLoading(false));
  }, []);

  async function save() {
    const amount = +maxAmount;
    if (!(amount > 0)) {
      setErr("Please enter a maximum amount greater than zero.");
      return;
    }
    setErr("");
    setSaving(true);
    try {
      await setLoanOperatorApprovalLimit(amount);
      toast("Loan Operator approval limit updated");
      closeModal();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Could not save — try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div className="hd"><h3>Roles — Approval Limits</h3><button className="x" onClick={closeModal}>×</button></div>
      <div className="bd">
        <div className="notice">
          <Icon name="shield" />You don't have permission for this action, Ask superiors for this.
        </div>
        {loading ? (
          <p style={{ color: "var(--muted)", fontSize: 13.5, marginTop: 12 }}>Loading…</p>
        ) : loadErr ? (
          <p style={{ color: "var(--red)", fontSize: 13.5, marginTop: 12 }}>{loadErr}</p>
        ) : (
          <div className="frow" style={{ marginTop: 16 }}>
            <div>
              <label className="f">Loan Operator — Maximum Approval Amount (₹)</label>
              <input
                className="inp"
                type="number"
                min={1}
                placeholder="e.g. 50000"
                value={maxAmount}
                onChange={(e) => setMaxAmount(e.target.value)}
              />
              {!!maxAmount && +maxAmount > 0 && (
                <p style={{ fontSize: 12, color: "var(--muted)", margin: "4px 0 0" }}>
                  Loan Operators can approve loans up to {fmt(+maxAmount)}.
                </p>
              )}
            </div>
          </div>
        )}
        <p style={{ color: "var(--red)", fontSize: 12.5, minHeight: 16, marginTop: 8 }}>{err}</p>
      </div>
      <div className="ft">
        <button className="btn ghost" onClick={closeModal}>Cancel</button>
        <button className="btn" onClick={save} disabled={saving || loading || !!loadErr}>
          <Icon name="check" /> {saving ? "Saving…" : "Save"}
        </button>
      </div>
    </>
  );
}
