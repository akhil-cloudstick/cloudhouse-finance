"use client";

import { useEffect, useState } from "react";
import { useModal } from "@/product/components/Modal";
import { useToast } from "@/product/components/Toast";
import { Icon } from "@/product/components/Icon";
import { BranchModalContent } from "@/product/components/modals/BranchModal";
import { ConfirmModalContent } from "@/product/components/modals/ConfirmModal";
import {
  deactivateBranch,
  getBranchQuota,
  listBranches,
  type BranchQuota,
  type BranchView,
} from "@/product/pages/branches/services/branchService";
import { useAuth } from "@/product/providers/auth-context";
import { BranchLedgerModalContent } from "@/product/components/modals/BranchLedgerModal";

/* Centralized branch management — admin-only. Loads real data from the Go
 * backend (`GET /api/v1/branches`), following the Schemes.tsx pattern. */
export function Branches() {
  const { openModal } = useModal();
  const toast = useToast();
  // Hidden rather than disabled when the role lacks the grant — see
  // Customers.tsx. Deactivating a branch counts as an update, not a delete.
  const { can } = useAuth();
  const canCreateBranches = can("Branch_Management", "can_create_branch");
  const canUpdateBranches = can("Branch_Management", "can_update_branch");
  const canViewBranchLedger = can("Branch_Management", "can_view_branch_ledger");
  const [branches, setBranches] = useState<BranchView[] | null>(null);
  const [error, setError] = useState("");
  const [quota, setQuota] = useState<BranchQuota | null>(null);

  async function load() {
    try {
      setBranches(await listBranches());
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load branches.");
    }
    // Loaded separately so a failure here never hides the branch list —
    // without it the page simply behaves as before and the server still
    // refuses an over-limit create.
    try {
      setQuota(await getBranchQuota());
    } catch {
      setQuota(null);
    }
  }

  const atLimit = quota !== null && !quota.unlimited && quota.used >= quota.quota;
  const limitMessage = quota
    ? `Your current plan (${quota.plan}) allows ${quota.quota} branch${quota.quota === 1 ? "" : "es"}. To add more branches, contact your administrator to upgrade your plan.`
    : "";

  useEffect(() => { load(); }, []);

  function onSaved() {
    load();
  }

  function onDeactivate(b: BranchView) {
    openModal(
      <ConfirmModalContent
        title="Deactivate Branch"
        message={`Deactivate branch "${b.name}"? It will no longer be selectable for new records.`}
        confirmLabel="Deactivate"
        busyLabel="Deactivating…"
        onConfirm={async () => {
          await deactivateBranch(b.id);
          toast(`Branch "${b.name}" deactivated`);
          load();
        }}
      />
    );
  }

  return (
    <>
      <div className="page-h">
        <div><h1>Branch Management</h1><p>Add, edit and manage every branch location — customers, employees, loans and expenses all link back here</p></div>
        <div className="sp" />
        {canCreateBranches && (
          <button
            className="btn"
            disabled={atLimit}
            title={atLimit ? limitMessage : undefined}
            onClick={() => openModal(<BranchModalContent onSaved={onSaved} />)}
          >
            <Icon name="plus" /> Add Branch
          </button>
        )}
      </div>
      <hr className="gold-rule" />
      {quota && (
        <p style={{ color: "var(--muted)", fontSize: 13, margin: "0 0 10px" }}>
          {quota.unlimited
            ? `${quota.used} active branch${quota.used === 1 ? "" : "es"} · ${quota.plan} plan (no branch limit)`
            : `${quota.used} of ${quota.quota} branch${quota.quota === 1 ? "" : "es"} used · ${quota.plan} plan`}
        </p>
      )}
      {atLimit && canCreateBranches && (
        <div
          role="status"
          style={{
            background: "var(--amber-bg)",
            color: "var(--amber)",
            border: "1px solid var(--amber)",
            borderRadius: 8,
            padding: "10px 14px",
            fontSize: 13.5,
            marginBottom: 12,
          }}
        >
          {limitMessage}
        </div>
      )}
      {error && (
        <p style={{ color: "var(--red)", fontSize: 13.5 }}>
          Something went wrong. Please try again later.
        </p>
      )}
      {!error && branches === null && (
        <p style={{ color: "var(--muted)", fontSize: 13.5 }}>Loading branches…</p>
      )}
      {branches !== null && branches.length === 0 && !error && (
        <p style={{ color: "var(--muted)", fontSize: 13.5 }}>
          No branches yet. Click &quot;Add Branch&quot; to create one.
        </p>
      )}
      {branches !== null && branches.length > 0 && (
        <div className="card">
          <div className="tbl-wrap">
            <table className="tbl">
              <thead>
                <tr><th>Branch</th><th>Code</th><th>Address</th><th>Phone</th><th>Status</th><th></th></tr>
              </thead>
              <tbody>
                {branches.map((b) => (
                  <tr key={b.id}>
                    <td><b>{b.name}</b></td>
                    <td>{b.code || "—"}</td>
                    <td>{b.address}</td>
                    <td>{b.phone || "—"}</td>
                    <td>{b.isActive ? <span className="chip green">Active</span> : <span className="chip gray">Inactive</span>}</td>
                    <td>
                      <div style={{ display: "flex", gap: 12 }}>
                        {canViewBranchLedger && <a href="#" onClick={(e) => { e.preventDefault(); openModal(<BranchLedgerModalContent branch={b} />, true); }}>Ledger</a>}
                        {canUpdateBranches && <a href="#" onClick={(e) => { e.preventDefault(); openModal(<BranchModalContent branch={b} onSaved={onSaved} />); }}>Edit</a>}
                        {canUpdateBranches && b.isActive && (
                          <a href="#" style={{ color: "var(--red)" }} onClick={(e) => { e.preventDefault(); onDeactivate(b); }}>Deactivate</a>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}
