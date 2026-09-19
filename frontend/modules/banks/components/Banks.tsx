"use client";

import { useEffect, useState } from "react";
import { useModal } from "@/common/components/Modal";
import { useToast } from "@/common/components/Toast";
import { Icon } from "@/common/components/Icon";
import { ApiError } from "@/common/services/httpClient";
import { useAuth } from "@/common/auth-context";
import { BankModalContent } from "@/common/components/modals/BankModal";
import { MergeBankModalContent } from "@/common/components/modals/MergeBankModal";
import { listBanks, listBanksPage, deleteBank, type BackendBank } from "@/modules/banks/services/bankService";

const PAGE_SIZE = 15;

/* Centralized bank management — mirrors Branches.tsx exactly (simple CRUD
 * table). Unlike Branches, deleting a bank really deletes it (hard delete,
 * guarded by a reference count) rather than deactivating it — see backend
 * Service.Delete's doc comment — so a bank still referenced by history is
 * blocked with a warning naming how many transactions/pledges are linked,
 * pointing staff at "Merge" instead.
 *
 * Paginated server-side via listBanksPage (GET /banks?limit=&offset=) —
 * same {items, hasMore, total} envelope as Loans.tsx's listLoansPage. */
export function Banks() {
  const { openModal } = useModal();
  const toast = useToast();
  const { can } = useAuth();
  const canCreate = can("Bank_Management", "can_create_bank");
  const canUpdate = can("Bank_Management", "can_update_bank");
  const canDelete = can("Bank_Management", "can_delete_bank");
  const [banks, setBanks] = useState<BackendBank[] | null>(null);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState("");
  const [page, setPage] = useState(1);

  async function load() {
    try {
      const res = await listBanksPage(page, PAGE_SIZE);
      setBanks(res.items);
      setTotal(res.total);
      setError("");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to load banks.");
    }
  }

  useEffect(() => { load(); }, [page]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  // Merge needs every bank as a pick-target, not just the current page — a
  // separate unpaginated fetch, same call listBanks() made before this page
  // was paginated.
  async function openMerge(source: BackendBank) {
    const all = await listBanks();
    openModal(<MergeBankModalContent source={source} banks={all} onSaved={load} />);
  }

  function onDelete(b: BackendBank) {
    openModal(
      <ConfirmDeleteBank bank={b} onMergeInstead={() => openMerge(b)} onSaved={load} />
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
        <div className="card tbl-card tbl-card-fill">
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
                        {canUpdate && total > 1 && (
                          <a href="#" onClick={(e) => { e.preventDefault(); openMerge(b); }}>Merge</a>
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
          <div className="ft" style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <button className="btn plain sm" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>‹ Prev</button>
            <span style={{ fontSize: 12.5 }}>Page {page} of {totalPages}</span>
            <button className="btn plain sm" disabled={page >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))}>Next ›</button>
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
