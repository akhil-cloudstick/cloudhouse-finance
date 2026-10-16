"use client";

import { useCallback, useEffect, useState } from "react";
import { useLoans } from "@/modules/loans/store/LoansProvider";
import { useModal } from "@/common/components/ModalProvider";
import { useToast } from "@/common/components/ToastProvider";
import { useAuth } from "@/common/providers/AuthProvider";
import { Icon } from "@/common/components/Icon";
import { fmt, fmtW, fmtDate } from "@/common/utils/format";
import { releaseBankPledge, voidBankPledge, listBankPledgeHistoryPage, listLoansPage, CASH_TREATMENT_LABELS } from "@/modules/loans/services/loanService";
import { type BankPledgeRecordView, type LoanView } from "@/modules/loans/types/loan-types";
import { RepledgeModalContent } from "@/common/components/modals/RepledgeModalContent";
import { SelectLoanForRepledgeModalContent } from "@/common/components/modals/SelectLoanForRepledgeModalContent";
import { BanksModalContent } from "@/modules/banks/components/BanksModalContent";
import { ReleasePledgeModalContent } from "@/modules/loans/components/ReleasePledgeModalContent";
import { ApiError } from "@/common/services/httpClient";
import { useScrollPageSize } from "@/common/utils/responsive";
import { ScrollSentinel } from "@/common/components/ui/ScrollSentinel";
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
  const { openModal, closeModal } = useModal();
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
  const [q, setQ] = useState(focusLoanNumber || "");
  const trimmedQ = q.trim();
  const [releasingId, setReleasingId] = useState<number | null>(null);
  const [history, setHistory] = useState<BankPledgeRecordView[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState("");
  const [historyPage, setHistoryPage] = useState(1);
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
  const [pledgedPage, setPledgedPage] = useState(1);
  const [pledgedHasMore, setPledgedHasMore] = useState(false);
  const [pledgedTotal, setPledgedTotal] = useState(0);
  const pledgedTotalPages = Math.max(1, Math.ceil(pledgedTotal / pageSize));

  const canVoid = canUpdatePledges;
  const loadPledged = useCallback(async (page: number, query: string) => {
    setPledgedLoading(true);
    setPledgedError("");
    try {
      const res = await listLoansPage({ bankPledgeStatus: "Bank Pledged", q: query || undefined, page, limit: pageSize });
      setPledged(res.items);
      setPledgedHasMore(res.hasMore);
      setPledgedTotal(res.total);
    } catch (e) {
      setPledgedError(e instanceof ApiError && e.status < 500 ? e.message : "Something went wrong. Failed to load re-pledged loans.");
    } finally {
      setPledgedLoading(false);
    }
  }, [pageSize]);

  const loadHistory = useCallback(async (page: number, query: string) => {
    setHistoryLoading(true);
    setHistoryError("");
    try {
      const res = await listBankPledgeHistoryPage(page, pageSize, query || undefined);
      setHistory(res.items);
      setHistoryHasMore(res.hasMore);
      setHistoryTotal(res.total);
    } catch (e) {
      setHistoryError(e instanceof ApiError && e.status < 500 ? e.message : "Something went wrong. Failed to load re-pledge history.");
    } finally {
      setHistoryLoading(false);
    }
  }, [pageSize]);

  // Both tabs' data is kept in sync with the search box regardless of which
  // one is open — a loan that's already been released/voided drops out of
  // the Active tab's own bankPledgeStatus filter, so it can only ever be
  // found via History; querying both unconditionally (debounced, and on
  // mount since trimmedQ starts truthy when arriving via focusLoanNumber)
  // means switching tabs never shows stale results for whatever's typed.
  useEffect(() => {
    const handle = setTimeout(() => {
      setPledgedPage(1);
      setHistoryPage(1);
      void loadPledged(1, trimmedQ);
      void loadHistory(1, trimmedQ);
    }, 300);
    return () => clearTimeout(handle);
    // pageSize/cards: card mode grows pageSize on scroll, which must refetch
    // page 1 with the larger size (rows stay on screen meanwhile).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trimmedQ, pageSize, cards]);

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
  function confirmRelease(loanId: number, pledgeId: number, bankName: string, amount: number, treatment: string) {
    openModal(
      <ReleasePledgeModalContent
        bankName={bankName}
        amount={amount}
        cashTreatment={treatment}
        onConfirm={async (payment) => {
          setReleasingId(pledgeId);
          try {
            await releaseBankPledge(loanId, pledgeId, payment);
            refreshAll();
            toast("Bank pledge released");
          } finally {
            setReleasingId(null);
          }
        }}
      />
    );
  }

  function confirmVoid(rec: BankPledgeRecordView) {
    openModal(<VoidPledgeModalContent rec={rec} onDone={() => { refreshAll(); toast("Pledge entry deleted"); }} />);
  }

  return (
    <>
      <div className="page-h">
        <div><h1>Bank &amp; Gold Re-Pledge</h1><p>Customer gold re-pledged with external banks</p></div>
        <div className="sp" />
        <div className="search"><Icon name="search" /><input className="inp" placeholder="Search loan no, bank, customer…" title="Searches: loan number, customer name, customer code · bank name on the History tab only" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        {canViewBanks && <button className="btn ghost" onClick={() => openModal(<BanksModalContent />, true)}><Icon name="bank" /> Banks</button>}
        {canCreatePledges && <button className="btn" onClick={startNewRepledge}><Icon name="plus" /> New Re-Pledge</button>}
      </div>
      <hr className="gold-rule" style={{ margin: "4px 0 10px" }} />
      <div className="tabs bank-pledge-tabs" style={{ marginTop: 4, marginBottom: 8 }}>
        <button className={tab === "active" ? "on" : ""} onClick={() => setTab("active")}>Active</button>
        <button className={tab === "history" ? "on" : ""} onClick={() => setTab("history")}>History</button>
      </div>

      {error && <div className="notice" style={{ marginBottom: 14 }}>{error}</div>}

      {tab === "active" ? (
        <div className="card tbl-card tbl-card-fill">
          <div className="hd"><h3>Re-Pledged Loans</h3></div>
          {pledgedError && <div className="notice" style={{ margin: 14 }}>{pledgedError}</div>}
          <div className="tbl-wrap">
            <table className="tbl tbl-cards">
              <thead>
                <tr><th>Loan</th><th>Customer</th><th>Bank</th><th className="num">Weight</th><th className="num">Pledged Amount</th><th>Cash</th><th>Pledged On</th><th className="col-act"></th></tr>
              </thead>
              <tbody>
                {pledgedLoading && !(cards && pledged.length > 0) ? (
                  <tr><td colSpan={8} className="empty">Loading…</td></tr>
                ) : pledged.length === 0 ? (
                  <tr><td colSpan={8} className="empty">No loans currently bank-pledged.</td></tr>
                ) : pledged.map((l) => {
                  const active = l.bankPledges.find((p) => !p.isReleased);
                  const treatment = active?.cashTreatment ?? "CashIn";
                  return (
                    <tr key={l.id} style={focusLoanNumber && l.id === focusLoanNumber ? { background: "var(--brand-pale)" } : undefined}>
                      <td data-label="Loan">{canOpen("loan") ? <a href={routeHref(`loan/${l.id}`)}>{l.id}</a> : l.id}</td>
                      <td data-label="Customer">{l.customerName}</td>
                      <td data-label="Bank">{active?.bankName || "—"}</td>
                      <td className="num" data-label="Weight">{fmtW(l.totalNetWeight)}</td>
                      <td className="num" data-label="Pledged Amount">{active ? fmt(active.pledgedAmount) : "—"}</td>
                      <td data-label="Cash"><CashTreatmentBadge treatment={treatment} /></td>
                      <td data-label="Pledged On">{fmtDate(active?.pledgeDate)}</td>
                      <td className="col-act" style={{ whiteSpace: "nowrap" }}>
                        {active && (
                          <>
                            {canUpdatePledges && <button
                              className="btn ghost sm"
                              disabled={releasingId === active.id}
                              onClick={() => confirmRelease(l.numericId, active.id, active.bankName, active.pledgedAmount, treatment)}
                            >
                              {releasingId === active.id ? "Releasing…" : "Release"}
                            </button>}
                            {canVoid && (
                              <button
                                className="btn ghost sm"
                                style={{ marginLeft: 6 }}
                                title="Cancel the repledge"
                                onClick={() => confirmVoid({
                                  id: active.id,
                                  loanId: l.numericId,
                                  bankName: active.bankName,
                                  pledgedAmount: active.pledgedAmount,
                                  pledgeDate: active.pledgeDate,
                                  releaseDate: null,
                                  bankPledgeDueDate: null,
                                  bankInterestRate: 0,
                                  referenceNumber: "",
                                  cashTreatment: treatment,
                                  status: "Active",
                                  voidedAt: null,
                                  voidReason: "",
                                  events: [],
                                })}
                              >
                                Delete
                              </button>
                            )}
                          </>
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
            <table className="tbl tbl-cards">
              <thead>
                <tr><th>Loan</th><th>Customer</th><th>Bank</th><th className="num">Amount</th><th>Cash</th><th>Pledged</th><th>Released</th><th>Status</th></tr>
              </thead>
              <tbody>
                {historyLoading && !(cards && history.length > 0) ? (
                  <tr><td colSpan={8} className="empty">Loading…</td></tr>
                ) : history.length === 0 ? (
                  <tr><td colSpan={8} className="empty">No re-pledge records yet.</td></tr>
                ) : history.map((r) => (
                  <tr key={r.id}>
                    <td data-label="Loan">{r.loanNumber ? (canOpen("loan") ? <a href={routeHref(`loan/${r.loanNumber}`)}>{r.loanNumber}</a> : r.loanNumber) : `#${r.loanId}`}</td>
                    <td data-label="Customer">{r.customerName || "—"}</td>
                    <td data-label="Bank">{r.bankName}</td>
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

type VoidPledgeModalContentProps = { rec: BankPledgeRecordView; onDone: () => void };

function VoidPledgeModalContent({ rec, onDone }: VoidPledgeModalContentProps) {
  const { closeModal } = useModal();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function submit() {
    if (!reason.trim()) { setErr("Please state why this pledge entry is being deleted."); return; }
    setBusy(true);
    try {
      await voidBankPledge(rec.loanId, rec.id, reason.trim());
      closeModal();
      onDone();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Could not delete the pledge entry — try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="hd"><h3>Delete Repledge Record</h3><button className="x" onClick={closeModal}>×</button></div>
      <div className="bd">
        {/* .notice is display:flex — keep the text in one child element. */}
        <div className="notice" style={{ marginBottom: 14 }}>
          <Icon name="shield" />
          <span>
            Cancel Pledge Entry — this undoes a re-pledge of <strong>{fmt(rec.pledgedAmount)}</strong> to <strong>{rec.bankName}</strong> entered in error.
            {rec.cashTreatment === "CashIn"
              ? ` A compensating cash-out of ${fmt(rec.pledgedAmount)} will be booked, since the original added cash to the till.`
              : " No cash will move — this pledge was recorded only."}
            {" "}The record stays visible in history for audit. To fix a wrong cash treatment, delete this entry and create a fresh re-pledge. Use Release instead if the gold is actually being returned from the bank.
          </span>
        </div>
        <div className="frow"><div>
          <label className="f">Reason *</label>
          <input className="inp" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="why this record is being cancelled" maxLength={255} />
        </div></div>
        <p style={{ color: "var(--red)", fontSize: 12.5, minHeight: 16, marginTop: 8 }}>{err}</p>
      </div>
      <div className="ft">
        <button className="btn ghost" onClick={closeModal} disabled={busy}>Cancel</button>
        <button className="btn danger" onClick={submit} disabled={busy}>{busy ? "Deleting…" : "Delete Entry"}</button>
      </div>
    </>
  );
}
