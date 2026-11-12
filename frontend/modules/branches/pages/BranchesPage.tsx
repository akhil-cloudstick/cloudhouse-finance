"use client";

import { TableCols } from "@/common/components/ui/TableCols";
import { useErrorToast } from "@/common/hooks/use-error-toast";
import { useEffect, useState } from "react";
import { useModal } from "@/common/components/ModalProvider";
import { useToast } from "@/common/components/ToastProvider";
import { Icon } from "@/common/components/Icon";
import { BranchModalContent } from "@/modules/branches/components/BranchModalContent";
import { ConfirmModalContent } from "@/common/components/modals/ConfirmModalContent";
import { deactivateBranch, getBranchQuota, listBranches } from "@/modules/branches/services/branchService";
import { type BranchQuota, type BranchView } from "@/modules/branches/types/branch-types";
import { useAuth } from "@/common/providers/AuthProvider";
import { routeHref } from "@/common/services/appRoutes";
import { TableSearch } from "@/common/components/ui/TableSearch";
import { usePersistedState } from "@/common/hooks/use-persisted-state";
import { PageBar } from "@/modules/loans/components/PageBar";

const PAGE_SIZE = 10;

/* Centralized branch management — admin-only. Loads real data from the Go
 * backend (`GET /api/v1/branches`), following the Schemes.tsx pattern. */
export function BranchesPage() {
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
  const [q, setQ] = usePersistedState("branches:q", "");
  const [quota, setQuota] = useState<BranchQuota | null>(null);
  const [page, setPage] = useState(1);
  // Clamp so deactivating/searching down to fewer rows never strands the view on an empty page.
  const lastPage = Math.max(1, Math.ceil((branches?.length ?? 0) / PAGE_SIZE));
  const curPage = Math.min(page, lastPage);
  const pageRows = (branches ?? []).slice((curPage - 1) * PAGE_SIZE, curPage * PAGE_SIZE);

  async function load() {
    try {
      setBranches(await listBranches(q));
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

  // Typing searches on the server (debounced); the first load is immediate.
  useEffect(() => { setPage(1); }, [q]);
  useEffect(() => {
    const handle = setTimeout(() => { void load(); }, q ? 300 : 0);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

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

  useErrorToast(error);
  return (
    <>
      <div className="page-h">
        <div><h1>Branch Management</h1></div>
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
      {!error && branches === null && (
        <p style={{ color: "var(--muted)", fontSize: 13.5 }}>Loading branches…</p>
      )}
      {branches !== null && branches.length === 0 && !error && !q.trim() && (
        <p style={{ color: "var(--muted)", fontSize: 13.5 }}>
          No branches yet. Click &quot;Add Branch&quot; to create one.
        </p>
      )}
      {branches !== null && (branches.length > 0 || !!q.trim()) && (
        <div style={{ margin: "0 0 12px", display: "flex", justifyContent: "flex-end" }}>
          <TableSearch value={q} onChange={setQ} placeholder="Search branches…" searches="branch name, code, address, phone, status" />
        </div>
      )}
      {branches !== null && (branches.length > 0 || !!q.trim()) && (
        <div className="card tbl-rounded">
          <div className="tbl-wrap">
            <table className="tbl tbl-center tbl-cards">
              <TableCols widths={[16, 10, 24, 12, 10, "200px"]} />
              <thead>
                <tr><th>Branch</th><th>Code</th><th>Address</th><th>Phone</th><th>Status</th><th></th></tr>
              </thead>
              <tbody>
                {pageRows.map((b) => (
                  <tr key={b.id}>
                    <td data-label="Branch"><b>{b.name}</b></td>
                    <td data-label="Code">{b.code || "—"}</td>
                    <td data-label="Address">{b.address}</td>
                    <td data-label="Phone">{b.phone || "—"}</td>
                    <td data-label="Status">{b.isActive ? <span className="chip green">Active</span> : <span className="chip gray">Inactive</span>}</td>
                    <td className="tbl-acts">
                      {canViewBranchLedger && <a href={routeHref("ledger-branch", b.id)}>Ledger</a>}
                      {canUpdateBranches && <a href="#" onClick={(e) => { e.preventDefault(); openModal(<BranchModalContent branch={b} onSaved={onSaved} />); }}>Edit</a>}
                      {canUpdateBranches && b.isActive && (
                        <a href="#" style={{ color: "var(--red)" }} onClick={(e) => { e.preventDefault(); onDeactivate(b); }}>Deactivate</a>
                      )}
                    </td>
                  </tr>
                ))}
                {branches.length === 0 && (
                  <tr><td colSpan={6} className="empty">No branches match “{q.trim()}”.</td></tr>
                )}
              </tbody>
            </table>
          </div>
          <PageBar page={curPage} total={branches.length} pageSize={PAGE_SIZE} onChange={setPage} />
        </div>
      )}
    </>
  );
}
