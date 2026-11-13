"use client";

import { TableCols } from "@/common/components/ui/TableCols";
import { useEffect, useRef, useState } from "react";
import { usePersistedPage } from "@/common/hooks/use-persisted-state";
import { useScrollPageSize } from "@/common/utils/responsive";
import { ScrollSentinel } from "@/common/components/ui/ScrollSentinel";
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
import { fmt } from "@/common/utils/format";
import { balanceColor, fmtBalance } from "@/modules/banks/utils/bankBalance";

const PAGE_SIZE = 15;
// The Banks modal loads 10 at a time — its table is height-capped (see
// `.tbl-scroll-paged` in app.css) so the first 10 rows overflow and
// scrolling to the end fetches the next 10.
const MODAL_PAGE_SIZE = 10;
type BankTableProps = { reloadKey: number; afterChange: () => void; inModal?: boolean; onTotalBalance?: (n: number) => void; q?: string; branchId?: string };

/* `inModal` drops the card border (the modal box is already the frame — see
 * `.tbl-flat` / `.bd-tbl` in app.css) and swaps the Prev/Next pager for
 * infinite scroll: the next page loads as the rows are scrolled to the end. */
export function BankTable({ reloadKey, afterChange, inModal, onTotalBalance, q = "", branchId }: BankTableProps) {
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
  // The Bank Management page remembers its page across a Back; the modal list loads
  // page by page as it scrolls, so it always starts from the first.
  const [savedPage, setSavedPage] = usePersistedPage("banks");
  const [modalPage, setModalPage] = useState(1);
  const page = inModal ? modalPage : savedPage;
  const setPage = inModal ? setModalPage : setSavedPage;
  const wrapRef = useRef<HTMLDivElement>(null);
  const { cards, size: scrollSize, more } = useScrollPageSize(PAGE_SIZE);
  // Card mode: the page size grows as the list is scrolled (page stays 1).
  const pageSize = inModal ? MODAL_PAGE_SIZE : scrollSize;
  useEffect(() => { if (cards && !inModal) setPage(1); }, [cards, inModal]);

  async function load() {
    if (inModal && page > 1) setLoadingMore(true);
    try {
      const res = await listBanksPage(page, pageSize, q, branchId || undefined);
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

  useEffect(() => { load(); }, [page, reloadKey, pageSize]);
  // A new search restarts from page 1 (debounced); a search typed on page 1 reloads directly.
  const firstRun = useRef(true);
  useEffect(() => {
    if (firstRun.current) { firstRun.current = false; return; }
    const handle = setTimeout(() => { if (page === 1) void load(); else setPage(1); }, 300);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, branchId]);

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

  // The modal drops the IFSC and Account No. columns.
  const cols = (showBranch ? 7 : 6) - (inModal ? 1 : 0);
  // (modal: no IFSC/Account No., but Balance becomes two columns)
  // Loading, error and empty states render inside the table, like the other
  // lists, so the layout (headers, frame, pager) never disappears.
  const status = error
    ? "Something went wrong. Please try again later."
    : banks === null
    ? "Loading banks…"
    : banks.length === 0
    ? (q.trim() ? `No banks match “${q.trim()}”.` : "No banks yet. Click “Add Bank” to create one.")
    : "";
  const rows = banks ?? [];

  return (
    <div className={`card tbl-card tbl-card-fill${inModal ? " tbl-flat tbl-scroll-paged" : " tbl-rounded"}`}>
      <div className="tbl-wrap" ref={wrapRef} onScroll={inModal ? onWrapScroll : undefined}>
        <table className={`tbl tbl-center${inModal ? "" : " tbl-cards"}`}>
          <TableCols widths={inModal
            ? [18, ...(showBranch ? [14] : []), 16, 14, 14, 6]
            : [16, ...(showBranch ? [13] : []), 15, 11, 14, 11, "150px"]} />
          <thead>
            <tr><th>Bank</th>{showBranch && <th>Business branch</th>}<th>Bank branch</th>{!inModal && <th>IFSC</th>}{!inModal && <th>Account No.</th>}{inModal
              ? <><th className="num">Active pledges</th><th className="num">Pledged amount</th></>
              : <th className="num">Balance</th>}<th></th></tr>
          </thead>
          <tbody>
            {status && <tr><td colSpan={cols} className="empty">{status}</td></tr>}
            {!status && rows.map((b) => (
              <tr key={b.id}>
                <td data-label="Bank"><b>{b.name}</b></td>
                {showBranch && <td data-label="Business branch">{b.branchName || "—"}</td>}
                <td data-label="Bank branch">{b.branch || "—"}</td>
                {!inModal && <td data-label="IFSC">{b.ifsc || "—"}</td>}
                {!inModal && <td data-label="Account No.">{b.accountNo || "—"}</td>}
                {inModal ? (
                  <>
                    <td className="num" data-label="Active pledges">{b.activePledgeCount ?? 0}</td>
                    <td className="num" data-label="Pledged amount">{fmt(b.activePledgeAmount ?? 0)}</td>
                  </>
                ) : (
                  <td className="num" data-label="Balance" style={{ color: balanceColor(b.balance ?? 0) }}>{fmtBalance(b.balance ?? 0)}</td>
                )}
                <td className="tbl-acts">
                  {!inModal && canOpenRoute("ledger-bank") && <a href={routeHref("ledger-bank", b.id)}>Ledger</a>}
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
      {!inModal && <ScrollSentinel enabled={cards && hasMore} onVisible={more} watch={rows.length} />}
      {!inModal && (
        <div className="ft ft-scroll-hide" style={{ display: "flex", alignItems: "center", gap: 10 }}>
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
          <Icon name="shield" /> Delete &quot;{bank.name}&quot;? This can&apos;t be undone.
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
        <button className="btn danger" onClick={confirm} disabled={saving}>{saving ? "Deleting…" : "Delete"}</button>
      </div>
    </>
  );
}
