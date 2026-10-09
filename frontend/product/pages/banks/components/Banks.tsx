"use client";

import { useEffect, useRef, useState } from "react";
import { useModal } from "@/product/components/Modal";
import { useToast } from "@/product/components/Toast";
import { Icon } from "@/product/components/Icon";
import { ApiError } from "@/product/services/httpClient";
import { useAuth } from "@/product/providers/auth-context";
import { routeHref } from "@/product/services/appRoutes";
import { useCanOpenRoute } from "@/product/hooks/useCanOpenRoute";
import { BankModalContent } from "@/product/components/modals/BankModal";
import { MergeBankModalContent } from "@/product/components/modals/MergeBankModal";
import { listBanks, listBanksPage, deleteBank, type BackendBank } from "@/product/pages/banks/services/bankService";

const PAGE_SIZE = 15;
// The Banks modal loads 10 at a time — its table is height-capped (see
// `.tbl-scroll-paged` in app.css) so the first 10 rows overflow and
// scrolling to the end fetches the next 10.
const MODAL_PAGE_SIZE = 10;

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
  const { can } = useAuth();
  const canCreate = can("Bank_Management", "can_create_bank");
  const [reloadKey, setReloadKey] = useState(0);
  const reload = () => setReloadKey((k) => k + 1);

  return (
    <>
      <div className="page-h">
        <div><h1>Bank Management</h1><p>Add, edit and manage the banks used for re-pledging gold, split payments and the Party Transactions ledger</p></div>
        <div className="sp" />
        {canCreate && <button className="btn" onClick={() => openModal(<BankModalContent onSaved={reload} />)}><Icon name="plus" /> Add Bank</button>}
      </div>
      <hr className="gold-rule" />
      <BankTable reloadKey={reloadKey} afterChange={reload} />
    </>
  );
}

/* The same bank list as a modal — Bank Pledge's "Banks" button. Every child
 * modal (add/edit/delete) replaces this one, so afterChange reopens it with
 * a fresh list once the child is done. */
export function BanksModalContent() {
  const { openModal, closeModal } = useModal();
  const { can } = useAuth();
  const canCreate = can("Bank_Management", "can_create_bank");
  const reopen = () => openModal(<BanksModalContent />, true);

  return (
    <>
      <div className="hd">
        <h3>Banks</h3>
        <div className="sp" />
        {canCreate && <button className="btn sm" onClick={() => openModal(<BankModalContent onSaved={reopen} />)}><Icon name="plus" /> Add Bank</button>}
        <button className="x" onClick={closeModal}>×</button>
      </div>
      <div className="bd bd-scroll bd-tbl">
        <BankTable reloadKey={0} afterChange={reopen} inModal />
      </div>
      <div className="ft">
        <button className="btn ghost" onClick={closeModal}>Back</button>
      </div>
    </>
  );
}

/* `inModal` drops the card border (the modal box is already the frame — see
 * `.tbl-flat` / `.bd-tbl` in app.css) and swaps the Prev/Next pager for
 * infinite scroll: the next page loads as the rows are scrolled to the end. */
function BankTable({ reloadKey, afterChange, inModal }: { reloadKey: number; afterChange: () => void; inModal?: boolean }) {
  const { openModal } = useModal();
  const { can } = useAuth();
  const canOpenRoute = useCanOpenRoute();
  const canUpdate = can("Bank_Management", "can_update_bank");
  const canDelete = can("Bank_Management", "can_delete_bank");
  const [banks, setBanks] = useState<BackendBank[] | null>(null);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [page, setPage] = useState(1);
  const wrapRef = useRef<HTMLDivElement>(null);
  const pageSize = inModal ? MODAL_PAGE_SIZE : PAGE_SIZE;

  async function load() {
    if (inModal && page > 1) setLoadingMore(true);
    try {
      const res = await listBanksPage(page, pageSize);
      setBanks((prev) => (inModal && page > 1 ? [...(prev ?? []), ...res.items] : res.items));
      setTotal(res.total);
      setHasMore(res.hasMore);
      setError("");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to load banks.");
    } finally {
      setLoadingMore(false);
    }
  }

  useEffect(() => { load(); }, [page, reloadKey]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  function loadNextPage() {
    if (hasMore && !loadingMore) setPage((p) => p + 1);
  }

  function onWrapScroll() {
    const el = wrapRef.current;
    if (el && el.scrollHeight - el.scrollTop - el.clientHeight < 48) loadNextPage();
  }

  // A first page too short to overflow the modal never fires onScroll, so
  // keep loading until the rows actually scroll or the server runs out.
  useEffect(() => {
    const el = wrapRef.current;
    if (inModal && el && el.scrollHeight <= el.clientHeight) loadNextPage();
  }, [banks, hasMore, loadingMore]); // eslint-disable-line react-hooks/exhaustive-deps

  // Merge needs every bank as a pick-target, not just the current page — a
  // separate unpaginated fetch, same call listBanks() made before this page
  // was paginated. Offered only from a delete the backend refuses.
  async function openMerge(source: BackendBank) {
    const all = await listBanks();
    openModal(<MergeBankModalContent source={source} banks={all} onSaved={afterChange} />);
  }

  function onDelete(b: BackendBank) {
    openModal(
      <ConfirmDeleteBank bank={b} onMergeInstead={() => openMerge(b)} onSaved={afterChange} />
    );
  }

  if (error) return <p style={{ color: "var(--red)", fontSize: 13.5 }}>Something went wrong. Please try again later.</p>;
  if (banks === null) return <p style={{ color: "var(--muted)", fontSize: 13.5 }}>Loading banks…</p>;
  if (banks.length === 0) return <p style={{ color: "var(--muted)", fontSize: 13.5 }}>No banks yet. Click &quot;Add Bank&quot; to create one.</p>;

  return (
    <div className={`card tbl-card tbl-card-fill${inModal ? " tbl-flat tbl-scroll-paged" : " tbl-rounded"}`}>
      <div className="tbl-wrap" ref={wrapRef} onScroll={inModal ? onWrapScroll : undefined}>
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
                    {canOpenRoute("ledger-bank") && <a href={routeHref("ledger-bank", b.id)}>Ledger</a>}
                    {canUpdate && <a href="#" onClick={(e) => { e.preventDefault(); openModal(<BankModalContent bank={b} onSaved={afterChange} />); }}>Edit</a>}
                    {canDelete && (
                      <a href="#" style={{ color: "var(--red)" }} onClick={(e) => { e.preventDefault(); onDelete(b); }}>Delete</a>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {inModal && loadingMore && (
              <tr><td colSpan={6} className="empty compact">Loading more…</td></tr>
            )}
          </tbody>
        </table>
      </div>
      {inModal && (
        <div className="ft ft-static" style={{ fontSize: 12.5, color: "var(--muted)" }}>
          Showing {banks.length} of {total}{hasMore ? " — scroll for more" : ""}
        </div>
      )}
      {!inModal && (
        <div className="ft" style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <button className="btn plain sm" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>‹ Prev</button>
          <span style={{ fontSize: 12.5 }}>Page {page} of {totalPages}</span>
          <button className="btn plain sm" disabled={page >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))}>Next ›</button>
        </div>
      )}
    </div>
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
      closeModal();
      onSaved();
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
