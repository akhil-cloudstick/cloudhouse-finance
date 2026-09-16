"use client";

import { useEffect, useState } from "react";
import { useModal } from "@/common/components/Modal";
import { useToast } from "@/common/components/Toast";
import { Icon } from "@/common/components/Icon";
import { ApiError } from "@/common/services/httpClient";
import { useAuth } from "@/common/auth-context";
import { BankModalContent } from "@/common/components/modals/BankModal";
import { MergeBankModalContent } from "@/common/components/modals/MergeBankModal";
import { listBanks, deleteBank, type BackendBank } from "@/modules/banks/services/bankService";

/* Centralized bank management — mirrors Branches.tsx exactly (simple CRUD
 * table, no pagination at this scale). Unlike Branches, deleting a bank
 * really deletes it (hard delete, guarded by a reference count) rather than
 * deactivating it — see backend Service.Delete's doc comment — so a bank
 * still referenced by history is blocked with a warning naming how many
 * transactions/pledges are linked, pointing staff at "Merge" instead. */
export function Banks() {
  const { openModal } = useModal();
  const toast = useToast();
  const { can } = useAuth();
  const canCreate = can("Bank_Management", "can_create_bank");
  const canUpdate = can("Bank_Management", "can_update_bank");
  const canDelete = can("Bank_Management", "can_delete_bank");
  const [banks, setBanks] = useState<BackendBank[] | null>(null);
  const [error, setError] = useState("");

  async function load() {
    try {
      setBanks(await listBanks());
      setError("");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to load banks.");
    }
  }

  useEffect(() => { load(); }, []);

  function onDelete(b: BackendBank) {
    openModal(
      <ConfirmDeleteBank bank={b} onMergeInstead={() => openModal(<MergeBankModalContent source={b} banks={banks || []} onSaved={load} />)} onSaved={load} />
    );
  }

  return (
    <>
      <div className="page-h">
        <div><h1>Bank Management</h1><p>Add, edit and manage the banks used for re-pledging gold, split payments and the Party Transactions ledger</p></div>
        <div className="sp" />
        {canCreate && <button className="btn" onClick={() => openModal(<BankModalContent onSaved={load} />)}><Icon name="plus" /> Add Bank</button>}
      </div>
      <hr className="gold-rule" />
      {error && <p style={{ color: "var(--red)", fontSize: 13.5 }}>Something went wrong. Please try again later.</p>}
      {!error && banks === null && <p style={{ color: "var(--muted)", fontSize: 13.5 }}>Loading banks…</p>}
      {banks !== null && banks.length === 0 && !error && (
        <p style={{ color: "var(--muted)", fontSize: 13.5 }}>No banks yet. Click &quot;Add Bank&quot; to create one.</p>
      )}
      {banks !== null && banks.length > 0 && (
        <div className="card">
          <div className="tbl-wrap">
            <table className="tbl">
              <thead>
                <tr><th>Bank</th><th>Branch</th><th>IFSC</th><th>Account No.</th><th>Phone</th><th></th></tr>
              </thead>
              <tbody>
                {banks.map((b) => (
                  <tr key={b.id}>
                    <td><b>{b.name}</b></td>
                    <td>{b.branch || "—"}</td>
                    <td>{b.ifsc || "—"}</td>
                    <td>{b.accountNo || "—"}</td>
                    <td>{b.phone || "—"}</td>
                    <td>
                      <div style={{ display: "flex", gap: 12 }}>
                        {canUpdate && <a href="#" onClick={(e) => { e.preventDefault(); openModal(<BankModalContent bank={b} onSaved={load} />); }}>Edit</a>}
                        {canUpdate && banks.length > 1 && (
                          <a href="#" onClick={(e) => { e.preventDefault(); openModal(<MergeBankModalContent source={b} banks={banks} onSaved={load} />); }}>Merge</a>
                        )}
                        {canDelete && (
                          <a href="#" style={{ color: "var(--red)" }} onClick={(e) => { e.preventDefault(); onDelete(b); }}>Delete</a>
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

/* Delete confirmation with an explicit warning surfaced BEFORE the backend
 * even runs (irreversibility), and — if the backend still refuses because
 * the bank is referenced — a follow-up prompt to merge instead, naming the
 * backend's own reference count rather than a bare error toast. */
function ConfirmDeleteBank({ bank, onSaved, onMergeInstead }: { bank: BackendBank; onSaved: () => void; onMergeInstead: () => void }) {
  const { closeModal } = useModal();
  const toast = useToast();
  const [err, setErr] = useState("");
  const [blocked, setBlocked] = useState(false);
  const [saving, setSaving] = useState(false);

  async function confirm() {
    setSaving(true);
    setErr("");
    try {
      await deleteBank(bank.id);
      toast(`Bank "${bank.name}" deleted`);
      onSaved();
      closeModal();
    } catch (e) {
      // The backend's own message already names the reference count (see
      // bank.Service.Delete) — shown verbatim rather than a generic toast.
      setErr(e instanceof ApiError ? e.message : "Failed to delete bank.");
      setBlocked(true);
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div className="hd"><h3>Delete Bank</h3><button className="x" onClick={closeModal}>×</button></div>
      <div className="bd">
        <div className="notice">
          <Icon name="shield" /> Delete &quot;{bank.name}&quot;? This can&apos;t be undone. If it&apos;s still linked to any transactions or pledges, deletion will be blocked.
        </div>
        {err && (
          <div className="notice" style={{ marginTop: 10, color: "var(--red)" }}>
            {err}
            {blocked && (
              <div style={{ marginTop: 8 }}>
                <a href="#" onClick={(e) => { e.preventDefault(); closeModal(); onMergeInstead(); }}>Merge it into another bank instead →</a>
              </div>
            )}
          </div>
        )}
      </div>
      <div className="ft">
        <button className="btn ghost" onClick={closeModal}>Cancel</button>
        <button className="btn danger" onClick={confirm} disabled={saving}>{saving ? "Deleting…" : "Delete"}</button>
      </div>
    </>
  );
}
