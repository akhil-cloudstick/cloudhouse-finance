"use client";

import { useEffect, useRef, useState } from "react";
import { useModal } from "@/common/components/ModalProvider";
import { useToast } from "@/common/components/ToastProvider";
import { Icon } from "@/common/components/Icon";
import { ApiError } from "@/common/services/httpClient";
import { useAuth } from "@/common/providers/AuthProvider";
import { routeHref } from "@/common/services/appRoutes";
import { useCanOpenRoute } from "@/common/hooks/use-can-open-route";
import { useShowBranch } from "@/common/hooks/use-branch-switch";
import { BankModalContent } from "@/modules/banks/components/BankModalContent";
import { MergeBankModalContent } from "@/modules/banks/components/MergeBankModalContent";
import { listBanks, listBanksPage, deleteBank } from "@/modules/banks/services/bankService";
import { type BackendBank } from "@/modules/banks/types/bank-types";
import { balanceColor, fmtBalance } from "@/modules/banks/utils/bankBalance";

const PAGE_SIZE = 15;
// The Banks modal loads 10 at a time — its table is height-capped (see
// `.tbl-scroll-paged` in app.css) so the first 10 rows overflow and
// scrolling to the end fetches the next 10.
const MODAL_PAGE_SIZE = 10;
type BankTableProps = { reloadKey: number; afterChange: () => void; inModal?: boolean; onTotalBalance?: (n: number) => void };

/* `inModal` drops the card border (the modal box is already the frame — see
 * `.tbl-flat` / `.bd-tbl` in app.css) and swaps the Prev/Next pager for
 * infinite scroll: the next page loads as the rows are scrolled to the end. */
export function BankTable({ reloadKey, afterChange, inModal, onTotalBalance }: BankTableProps) {
  const { openModal } = useModal();
  const { can } = useAuth();
  const canOpenRoute = useCanOpenRoute();
  // "Business branch" is the lender's own branch — hidden on a single-branch
  // plan. "Bank branch" is the bank's branch and always shows.
  const showBranch = useShowBranch();
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
      onTotalBalance?.(res.totalBalance);
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

  const cols = showBranch ? 7 : 6;
  // Loading, error and empty states render inside the table, like the other
  // lists, so the layout (headers, frame, pager) never disappears.
  const status = error
    ? "Something went wrong. Please try again later."
    : banks === null
    ? "Loading banks…"
    : banks.length === 0
    ? "No banks yet. Click “Add Bank” to create one."
    : "";
  const rows = banks ?? [];

  return (
    <div className={`card tbl-card tbl-card-fill${inModal ? " tbl-flat tbl-scroll-paged" : " tbl-rounded"}`}>
      <div className="tbl-wrap" ref={wrapRef} onScroll={inModal ? onWrapScroll : undefined}>
        <table className="tbl">
          <thead>
            <tr><th>Bank</th>{showBranch && <th>Business branch</th>}<th>Bank branch</th><th>IFSC</th><th>Account No.</th><th className="num">Balance</th><th></th></tr>
          </thead>
          <tbody>
            {status && <tr><td colSpan={cols} className="empty">{status}</td></tr>}
            {!status && rows.map((b) => (
              <tr key={b.id}>
                <td><b>{b.name}</b></td>
                {showBranch && <td>{b.branchName || "—"}</td>}
                <td>{b.branch || "—"}</td>
                <td>{b.ifsc || "—"}</td>
                <td>{b.accountNo || "—"}</td>
                <td className="num" style={{ color: balanceColor(b.balance ?? 0) }}>{fmtBalance(b.balance ?? 0)}</td>
                <td className="tbl-acts">
                  {canOpenRoute("ledger-bank") && <a href={routeHref("ledger-bank", b.id)}>Ledger</a>}
                  {canUpdate && (
                    <button type="button" className="tbl-ibtn" title="Edit bank" aria-label={`Edit ${b.name}`}
                      onClick={() => openModal(<BankModalContent bank={b} onSaved={afterChange} />)}>
                      <Icon name="edit" />
                    </button>
                  )}
                  {canDelete && (
                    <button type="button" className="tbl-ibtn danger" title="Delete bank" aria-label={`Delete ${b.name}`}
                      onClick={() => onDelete(b)}>
                      <Icon name="trash" />
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {inModal && loadingMore && (
              <tr><td colSpan={cols} className="empty compact">Loading more…</td></tr>
            )}
          </tbody>
        </table>
      </div>
      {inModal && (
        <div className="ft ft-static" style={{ fontSize: 12.5, color: "var(--muted)" }}>
          Showing {rows.length} of {total}{hasMore ? " — scroll for more" : ""}
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
type ConfirmDeleteBankProps = { bank: BackendBank; onSaved: () => void; onMergeInstead: () => void };

/* Delete confirmation with an explicit warning surfaced BEFORE the backend
 * even runs (irreversibility), and — if the backend still refuses because
 * the bank is referenced — a follow-up prompt to merge instead, naming the
 * backend's own reference count rather than a bare error toast. */
function ConfirmDeleteBank({ bank, onSaved, onMergeInstead }: ConfirmDeleteBankProps) {
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
