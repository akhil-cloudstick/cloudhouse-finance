"use client";

import { useEffect, useState } from "react";
import { useModal } from "@/components/Modal";
import { useToast } from "@/components/Toast";
import { Icon } from "@/lib/icons";
import { BranchModalContent } from "@/components/modals/BranchModal";
import { ConfirmModalContent } from "@/components/modals/ConfirmModal";
import { deactivateBranch, listBranches, type BranchView } from "@/lib/branchApi";

/* Centralized branch management — admin-only. Loads real data from the Go
 * backend (`GET /api/v1/branches`), following the Schemes.tsx pattern. */
export function Branches() {
  const { openModal } = useModal();
  const toast = useToast();
  const [branches, setBranches] = useState<BranchView[] | null>(null);
  const [error, setError] = useState("");

  async function load() {
    try {
      setBranches(await listBranches());
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load branches.");
    }
  }

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
        <button className="btn" onClick={() => openModal(<BranchModalContent onSaved={onSaved} />)}><Icon name="plus" /> Add Branch</button>
      </div>
      <hr className="gold-rule" />
      {error && (
        <p style={{ color: "var(--red)", fontSize: 13.5 }}>
          Could not reach the server — {error}
          <button className="btn plain sm" style={{ marginLeft: 8 }} onClick={load}>Retry</button>
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
                        <a href="#" onClick={(e) => { e.preventDefault(); openModal(<BranchModalContent branch={b} onSaved={onSaved} />); }}>Edit</a>
                        {b.isActive && (
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
