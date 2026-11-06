"use client";

import { TableCols } from "@/common/components/ui/TableCols";
import { TableSearch } from "@/common/components/ui/TableSearch";
import { useCallback, useEffect, useRef, useState } from "react";
import { useLoans } from "@/modules/loans/store/LoansProvider";
import { useModal } from "@/common/components/ModalProvider";
import { useToast } from "@/common/components/ToastProvider";
import { useAuth } from "@/common/providers/AuthProvider";
import { Icon } from "@/common/components/Icon";
import { fmt, fmtW, fmtDate } from "@/common/utils/format";
import { releaseBankPledge, listBankPledgeHistoryPage, listLoansPage, CASH_TREATMENT_LABELS } from "@/modules/loans/services/loanService";
import { type BankPledgeRecordView, type BankPledgeView, type LoanView } from "@/modules/loans/types/loan-types";
import { RepledgeModalContent } from "@/common/components/modals/RepledgeModalContent";
import { SelectLoanForRepledgeModalContent } from "@/common/components/modals/SelectLoanForRepledgeModalContent";
import { BanksModalContent } from "@/modules/banks/components/BanksModalContent";
import { ReleasePledgeModalContent } from "@/modules/loans/components/ReleasePledgeModalContent";
import { BankPledgeEditModalContent, type EditablePledge } from "@/modules/loans/components/BankPledgeEditModalContent";
import { PledgeDetailsModalContent } from "@/modules/loans/components/PledgeDetailsModalContent";
import { LoanLedgerInfoModalContent } from "@/modules/loans/components/LoanLedgerInfoModalContent";
import { ApiError } from "@/common/services/httpClient";
import { useScrollPageSize } from "@/common/utils/responsive";
import { ScrollSentinel } from "@/common/components/ui/ScrollSentinel";
import { FilterPanel, type FilterCategory, type FilterValue } from "@/common/components/ui/FilterPanel";
import { usePersistedPage, usePersistedState } from "@/common/hooks/use-persisted-state";
import { routeHref } from "@/common/services/appRoutes";
import { useCanOpenRoute } from "@/common/hooks/use-can-open-route";

type BankPledgePageProps = { focusLoanNumber?: string };

/* Ported from legacy/app.js's `renderBankPledge()`. The mock version also
 * showed a directory of banks (db.banks, a hardcoded list with per-bank
 * exposure totals) — that resource doesn't exist on the backend
 * (BankPledgeRecord.BankName is a free-text field, not a Bank entity), so
 * the bank-directory panel is dropped here.
 *
 * The page now has two tabs. "Active" is the original view of currently-pledged
 * loans. "History" exists because that view alone made a released re-pledge
 * vanish from the UI completely — there was no way to see what had been pledged
 * where, for how much, or who released it. */
export function BankPledgePage({ focusLoanNumber }: BankPledgePageProps = {}) {
  const { error, refresh } = useLoans();
  const { openModal, openChildModal, closeAllModals, closeModal } = useModal();
  const { can } = useAuth();
  const canOpen = useCanOpenRoute();
  const toast = useToast();
  // Recording a re-pledge (and adding the bank it goes to) is a create;
  // releasing or voiding one is an update. Whatever the role can't do is
  // hidden outright (see Customers.tsx).
  const canCreatePledges = can("Bank_Pledge_Management", "can_create_bank_pledge");
  const canUpdatePledges = can("Bank_Pledge_Management", "can_update_bank_pledge");
  const canViewBanks = can("Bank_Management", "can_view_bank_module");
  // Below 1100px the tables are cards: no Prev/Next, the list grows as you
  // scroll (`more` raises pageSize, page stays 1). Above it, pageSize is fixed.
  const { cards, size: pageSize, more } = useScrollPageSize(15);
  const [tab, setTab] = useState<"active" | "history">("active");
  // One search box for both tabs, matching loan number, bank name, or
  // customer name — seeded from the route arg when arriving via a
  // "#bankpledge/LN-00013"-style link (see ReleaseReviewModal.tsx's
  // gold-still-pledged warning), same pattern as Auctions.tsx's own search.
  // Remembered, so opening a loan and pressing Back returns to the same search and pages.
  const [q, setQ] = usePersistedState("bankpledge:q", focusLoanNumber || "");
  // Arriving with a loan number (route argument) searches for it even when an older search is remembered.
  useEffect(() => { if (focusLoanNumber) setQ(focusLoanNumber); }, [focusLoanNumber]); // eslint-disable-line react-hooks/exhaustive-deps
  const trimmedQ = q.trim();
  // The date range bounds the pledge date on both tabs.
  const [fromDate, setFromDate] = usePersistedState("bankpledge:from", "");
  const [toDate, setToDate] = usePersistedState("bankpledge:to", "");
  const filterCategories: FilterCategory[] = [{ key: "__date", label: "Pledge date", kind: "date" }];
  const filterValue: FilterValue = { __dateFrom: fromDate || undefined, __dateTo: toDate || undefined };
  const [history, setHistory] = useState<BankPledgeRecordView[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState("");
  const [historyPage, setHistoryPage] = usePersistedPage("bankpledge:history");
  const [historyHasMore, setHistoryHasMore] = useState(false);
  const [historyTotal, setHistoryTotal] = useState(0);
  const historyTotalPages = Math.max(1, Math.ceil(historyTotal / pageSize));

  // Active tab — paginated straight off the backend (bankPledgeStatus is a
  // real column, see LoanFilter.BankPledgeStatus) rather than filtering
  // LoansProvider's full `loans` array, which won't stay complete as loan
  // volume grows.
  const [pledged, setPledged] = useState<LoanView[]>([]);
  const [pledgedLoading, setPledgedLoading] = useState(true);
  const [pledgedError, setPledgedError] = useState("");
  const [pledgedPage, setPledgedPage] = usePersistedPage("bankpledge:pledged");
  const [pledgedHasMore, setPledgedHasMore] = useState(false);
  const [pledgedTotal, setPledgedTotal] = useState(0);
  const pledgedTotalPages = Math.max(1, Math.ceil(pledgedTotal / pageSize));

  // Correcting or erasing a pledge rewrites its ledger lines, so it takes the ledger edit/delete permissions too.
  const canEditPledge = canUpdatePledges && can("Loan_Management", "can_edit_ledger_entry");
  const canErasePledge = canUpdatePledges && can("Loan_Management", "can_delete_ledger_entry");
  // The editors open on top of the View popup; saving one closes both and reloads the lists.
  function openPledgeEditor(loanId: number, p: EditablePledge, mode: "edit" | "delete") {
    openChildModal(<BankPledgeEditModalContent loanId={loanId} pledge={p} mode={mode} onSaved={() => { refreshAll(); closeAllModals(); }} />, true);
  }
  const loadPledged = useCallback(async (page: number, query: string) => {
    setPledgedLoading(true);
    setPledgedError("");
    try {
      const res = await listLoansPage({ bankPledgeStatus: "Bank Pledged", q: query || undefined, from: fromDate || undefined, to: toDate || undefined, page, limit: pageSize });
      setPledged(res.items);
      setPledgedHasMore(res.hasMore);
      setPledgedTotal(res.total);
    } catch (e) {
      setPledgedError(e instanceof ApiError && e.status < 500 ? e.message : "Something went wrong. Failed to load re-pledged loans.");
    } finally {
      setPledgedLoading(false);
    }
  }, [pageSize, fromDate, toDate]);

  const loadHistory = useCallback(async (page: number, query: string) => {
    setHistoryLoading(true);
    setHistoryError("");
    try {
      const res = await listBankPledgeHistoryPage(page, pageSize, query || undefined, { from: fromDate || undefined, to: toDate || undefined });
      setHistory(res.items);
      setHistoryHasMore(res.hasMore);
      setHistoryTotal(res.total);
    } catch (e) {
      setHistoryError(e instanceof ApiError && e.status < 500 ? e.message : "Something went wrong. Failed to load re-pledge history.");
    } finally {
      setHistoryLoading(false);
    }
  }, [pageSize, fromDate, toDate]);

  // Both tabs' data is kept in sync with the search box regardless of which
  // one is open — a loan that's already been released/voided drops out of
  // the Active tab's own bankPledgeStatus filter, so it can only ever be
  // found via History; querying both unconditionally (debounced, and on
  // mount since trimmedQ starts truthy when arriving via focusLoanNumber)
  // means switching tabs never shows stale results for whatever's typed.
  // The first run (page opened) loads the remembered pages; later runs (search, filter or size changed) start at page 1.
  const listsMounted = useRef(false);
  useEffect(() => () => { listsMounted.current = false; }, []);
  useEffect(() => {
    const first = !listsMounted.current;
    listsMounted.current = true;
    const handle = setTimeout(() => {
      if (first) {
        void loadPledged(pledgedPage, trimmedQ);
        void loadHistory(historyPage, trimmedQ);
        return;
      }
      setPledgedPage(1);
      setHistoryPage(1);
      void loadPledged(1, trimmedQ);
      void loadHistory(1, trimmedQ);
    }, first ? 0 : 300);
    return () => clearTimeout(handle);
    // pageSize/cards: card mode grows pageSize on scroll, which must refetch
    // page 1 with the larger size (rows stay on screen meanwhile).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trimmedQ, pageSize, cards, fromDate, toDate]);

  function changePledgedPage(page: number) {
    setPledgedPage(page);
    void loadPledged(page, trimmedQ);
  }

  function changeHistoryPage(page: number) {
    setHistoryPage(page);
    void loadHistory(page, trimmedQ);
  }

  function refreshAll() {
    refresh();
    void loadPledged(pledgedPage, trimmedQ);
    void loadHistory(historyPage, trimmedQ);
  }

  function startNewRepledge() {
    openModal(
      <SelectLoanForRepledgeModalContent
        onPicked={(loan) => {
          closeModal();
          openModal(<RepledgeModalContent loan={loan} onSaved={refreshAll} />, true);
        }}
      />
    );
  }

  /* Release now asks first. It moves cash (for a CashIn pledge) and changes
   * where the gold physically is, which is too consequential for a single
   * unconfirmed click — the old version fired immediately. */
  function detailsFor(l: LoanView, pledge: BankPledgeView) {
    const names = pledge.ornamentIds.length ? l.ornaments.filter((o) => pledge.ornamentIds.includes(o.id)).map((o) => o.name) : [];
    return { loanNumber: l.id, customerName: l.customerName, pledge, ornamentNames: names };
  }

  function viewDetails(l: LoanView, pledge: BankPledgeView, treatment: string) {
    openModal(<PledgeDetailsModalContent {...detailsFor(l, pledge)} actions={[
      ...(canUpdatePledges ? [{ label: "Release", run: () => confirmRelease(l, pledge, treatment) }] : []),
      ...(canEditPledge ? [{ label: "Edit", icon: "edit" as const, run: () => openPledgeEditor(l.numericId, pledge, "edit") }] : []),
      ...(canErasePledge ? [{ label: "Delete", icon: "trash" as const, danger: true, run: () => openPledgeEditor(l.numericId, pledge, "delete") }] : []),
    ]} />);
  }

  // A history row's View popup: its details, and Edit / Delete while the record is still in force.
  function viewRecord(r: BankPledgeRecordView) {
    const editable = { ...r, bankId: r.bankId ?? null };
    openModal(<LoanLedgerInfoModalContent
      title="Re-Pledge Details"
      kind={r.status === "Voided" ? "Deleted" : r.status}
      rows={[
        ["Loan", r.loanNumber || `#${r.loanId}`], ["Customer", r.customerName || "—"], ["Bank", r.bankName || "—"],
        ["Pledged amount", fmt(r.pledgedAmount)], ["Interest rate", r.bankInterestRate ? `${r.bankInterestRate}% p.m.` : "—"],
        ["Pledged on", fmtDate(r.pledgeDate)], ["Released on", r.releaseDate ? fmtDate(r.releaseDate) : "—"],
        ["Due date", r.bankPledgeDueDate ? fmtDate(r.bankPledgeDueDate) : "—"], ["Reference no.", r.referenceNumber || "—"],
        ["Cash treatment", CASH_TREATMENT_LABELS[r.cashTreatment === "CashIn" ? "CashIn" : "RecordOnly"]],
      ]}
      description={<>{r.ornamentNames && r.ornamentNames.length ? r.ornamentNames.join(", ") : "All ornaments"}{r.status === "Voided" && r.voidReason ? <><br />{r.voidReason}</> : null}</>}
      actions={r.status === "Voided" ? [] : [
        ...(canEditPledge ? [{ label: "Edit", icon: "edit" as const, run: () => openPledgeEditor(r.loanId, editable, "edit") }] : []),
        ...(canErasePledge ? [{ label: "Delete", icon: "trash" as const, danger: true, run: () => openPledgeEditor(r.loanId, editable, "delete") }] : []),
      ]}
    />);
  }

  function confirmRelease(l: LoanView, pledge: BankPledgeView, treatment: string) {
    const loanId = l.numericId;
    const pledgeId = pledge.id;
    openChildModal(
      <ReleasePledgeModalContent
        bankName={pledge.bankName}
        amount={pledge.pledgedAmount}
        cashTreatment={treatment}
        details={detailsFor(l, pledge)}
        onConfirm={async (payment) => {
          await releaseBankPledge(loanId, pledgeId, payment);
          refreshAll();
          closeAllModals();
          toast("Bank pledge released");
        }}
      />
    );
  }

  return (
    <>
      <div className="page-h">
        <div><h1>Bank &amp; Gold Re-Pledge</h1><p>Customer gold re-pledged with external banks</p></div>
        <div className="sp" />
        <TableSearch placeholder="Search loan no, bank, customer…" searches="loan number, customer name, customer code · bank name on the History tab only" value={q} onChange={setQ} />
        {canViewBanks && <button className="btn ghost" onClick={() => openModal(<BanksModalContent />, true)}><Icon name="bank" /> Banks</button>}
        {canCreatePledges && <button className="btn" onClick={startNewRepledge}><Icon name="plus" /> New Re-Pledge</button>}
      </div>
      <hr className="gold-rule" style={{ margin: "4px 0 10px" }} />
      <div className="tabs bank-pledge-tabs" style={{ marginTop: 4, marginBottom: 8 }}>
        <button className={tab === "active" ? "on" : ""} onClick={() => setTab("active")}>Active</button>
        <button className={tab === "history" ? "on" : ""} onClick={() => setTab("history")}>History</button>
      </div>

      {error && <div className="notice" style={{ marginBottom: 14 }}>{error}</div>}

      <div className="filter-row-right" style={{ marginBottom: 12 }}>
        <FilterPanel
          categories={filterCategories}
          value={filterValue}
          onChange={(next) => {
            setFromDate(next.__dateFrom || "");
            setToDate(next.__dateTo || "");
          }}
          hideChips
          hideClearAll
        />
      </div>

      {tab === "active" ? (
        <div className="card tbl-card tbl-card-fill">
          <div className="hd"><h3>Re-Pledged Loans</h3></div>
          {pledgedError && <div className="notice" style={{ margin: 14 }}>{pledgedError}</div>}
          <div className="tbl-wrap">
            <table className="tbl tbl-cards tbl-center">
              <TableCols widths={[9, 20, 14, 9, 12, 8, 10, 10, 8]} />
              <thead>
                <tr><th>Loan</th><th>Customer</th><th>Bank</th><th className="num">Weight</th><th className="num">Pledged Amount</th><th>Cash</th><th>Pledged On</th><th>Due</th><th></th></tr>
              </thead>
              <tbody>
                {pledgedLoading && !(cards && pledged.length > 0) ? (
                  <tr><td colSpan={9} className="empty">Loading…</td></tr>
                ) : pledged.length === 0 ? (
                  <tr><td colSpan={9} className="empty">No loans currently bank-pledged.</td></tr>
                ) : pledged.flatMap((l) => l.bankPledges.filter((p) => p.status === "Active").map((p) => ({ l, p }))).map(({ l, p: active }) => {
                  const treatment = active.cashTreatment ?? "CashIn";
                  // A pledge with no ornament list covers the whole loan.
                  const covered = active.ornamentIds.length ? l.ornaments.filter((o) => active.ornamentIds.includes(o.id)).map((o) => o.name) : [];
                  return (
                    <tr key={l.id + "-" + active.id} style={focusLoanNumber && l.id === focusLoanNumber ? { background: "var(--brand-pale)" } : undefined}>
                      <td data-label="Loan">{canOpen("loan") ? <a href={routeHref(`loan/${l.id}`)}>{l.id}</a> : l.id}</td>
                      <td data-label="Customer">{l.customerName}</td>
                      <td data-label="Bank">{active?.bankName || "—"}</td>
                      <td className="num" data-label="Weight">
                        {fmtW(active.ornamentIds.length ? active.pledgedNetWeight : l.totalNetWeight)}
                        <div style={{ fontSize: 11.5, color: "var(--muted)" }}>{covered.length ? covered.join(", ") : "All ornaments"}</div>
                      </td>
                      <td className="num" data-label="Pledged Amount">{active ? fmt(active.pledgedAmount) : "—"}</td>
                      <td data-label="Cash"><CashTreatmentBadge treatment={treatment} /></td>
                      <td data-label="Pledged On">{fmtDate(active?.pledgeDate)}</td>
                      <td data-label="Due">{active.bankPledgeDueDate ? fmtDate(active.bankPledgeDueDate) : "—"}</td>
                      <td style={{ whiteSpace: "nowrap" }}>
                        {active && (
                          <button className="btn ghost sm" onClick={() => viewDetails(l, active, treatment)}>View</button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <ScrollSentinel enabled={cards && pledgedHasMore && !pledgedLoading} onVisible={more} watch={pledged.length} />
          <div className="ft ft-scroll-hide" style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <button className="btn plain sm" disabled={pledgedPage <= 1} onClick={() => changePledgedPage(Math.max(1, pledgedPage - 1))}>‹ Prev</button>
            <span style={{ fontSize: 12.5 }}>Page {pledgedPage} of {pledgedTotalPages}</span>
            <button className="btn plain sm" disabled={pledgedPage >= pledgedTotalPages} onClick={() => changePledgedPage(Math.min(pledgedTotalPages, pledgedPage + 1))}>Next ›</button>
          </div>
          {/* <div className="ft">If a customer requests closure while gold is bank-pledged, the release workflow flags the bank release step first.</div> */}
        </div>
      ) : (
        <div className="card tbl-card tbl-card-fill">
          <div className="hd"><h3>Re-Pledge History</h3></div>
          {historyError && <div className="notice" style={{ margin: 14 }}>{historyError}</div>}
          <div className="tbl-wrap">
            <table className="tbl tbl-cards tbl-center">
              <TableCols widths={[9, 20, 14, 12, 8, 10, 10, 9, 8]} />
              <thead>
                <tr><th>Loan</th><th>Customer</th><th>Bank</th><th className="num">Amount</th><th>Cash</th><th>Pledged</th><th>Released</th><th>Status</th><th></th></tr>
              </thead>
              <tbody>
                {historyLoading && !(cards && history.length > 0) ? (
                  <tr><td colSpan={9} className="empty">Loading…</td></tr>
                ) : history.length === 0 ? (
                  <tr><td colSpan={9} className="empty">No re-pledge records yet.</td></tr>
                ) : history.map((r) => (
                  <tr key={r.id}>
                    <td data-label="Loan">{r.loanNumber ? (canOpen("loan") ? <a href={routeHref(`loan/${r.loanNumber}`)}>{r.loanNumber}</a> : r.loanNumber) : `#${r.loanId}`}</td>
                    <td data-label="Customer">{r.customerName || "—"}</td>
                    <td data-label="Bank">
                      {r.bankName}
                      <div style={{ fontSize: 11.5, color: "var(--muted)" }}>{r.ornamentNames && r.ornamentNames.length ? r.ornamentNames.join(", ") : "All ornaments"}</div>
                    </td>
                    <td className="num" data-label="Amount">{fmt(r.pledgedAmount)}</td>
                    <td data-label="Cash"><CashTreatmentBadge treatment={r.cashTreatment} /></td>
                    <td data-label="Pledged">{fmtDate(r.pledgeDate)}</td>
                    <td data-label="Released">{fmtDate(r.releaseDate)}</td>
                    <td data-label="Status">
                      {/* Wire value stays "Voided" (backend status), only the displayed label is "Deleted" — see item #13's
                        * Void→Delete relabel: this is a UI wording change, not a status-value rename. */}
                      <span className={`pill ${r.status === "Voided" ? "red" : r.status === "Released" ? "" : "green"}`}>{r.status === "Voided" ? "Deleted" : r.status}</span>
                      {r.status === "Voided" && r.voidReason && (
                        <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 2 }}>{r.voidReason}</div>
                      )}
                    </td>
                    <td style={{ whiteSpace: "nowrap" }}>
                      <button className="btn ghost sm" onClick={() => viewRecord(r)}>View</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ScrollSentinel enabled={cards && historyHasMore && !historyLoading} onVisible={more} watch={history.length} />
          {/* <div className="ft">Every re-pledge ever recorded, including released and voided ones. Voided records are kept for audit and never deleted.</div> */}
          <div className="ft ft-scroll-hide" style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <button className="btn plain sm" disabled={historyPage <= 1} onClick={() => changeHistoryPage(Math.max(1, historyPage - 1))}>‹ Prev</button>
            <span style={{ fontSize: 12.5 }}>Page {historyPage} of {historyTotalPages}</span>
            <button className="btn plain sm" disabled={historyPage >= historyTotalPages} onClick={() => changeHistoryPage(Math.min(historyTotalPages, historyPage + 1))}>Next ›</button>
          </div>
        </div>
      )}
    </>
  );
}

type CashTreatmentBadgeProps = { treatment: string };

/* "Cash Added" vs "Record Only" is the single most important thing to be able
 * to see at a glance on a re-pledge: it determines whether releasing it will
 * move money, and it cannot be changed after the fact. */
function CashTreatmentBadge({ treatment }: CashTreatmentBadgeProps) {
  const isCash = treatment === "CashIn";
  return (
    <span className={`pill ${isCash ? "green" : ""}`} title={isCash ? "The bank's advance was added to Cash-in-Hand" : "Recorded as a re-pledge record only — no cash effect"}>
      {CASH_TREATMENT_LABELS[isCash ? "CashIn" : "RecordOnly"]}
    </span>
  );
}
