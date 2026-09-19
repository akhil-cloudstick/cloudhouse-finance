"use client";

import { useCallback, useEffect, useState } from "react";
import { useLoans } from "@/modules/loans/store/LoansProvider";
import { useModal } from "@/common/components/Modal";
import { useToast } from "@/common/components/Toast";
import { useAuth } from "@/common/auth-context";
import { Icon } from "@/common/components/Icon";
import { fmt, fmtW } from "@/common/utils/format";
import {
  releaseBankPledge,
  voidBankPledge,
  listBankPledgeHistoryPage,
  listLoansPage,
  CASH_TREATMENT_LABELS,
  type BankPledgeRecordView,
  type LoanView,
} from "@/modules/loans/services/loanService";
import { RepledgeModalContent, SelectLoanForRepledgeModalContent } from "@/common/components/modals/RepledgeModal";
import { BankModalContent } from "@/common/components/modals/BankModal";
import { ConfirmModalContent } from "@/common/components/modals/ConfirmModal";
import { ApiError } from "@/common/services/httpClient";
import { useResponsivePageSize } from "@/common/utils/responsive";

/* Roles permitted to void a re-pledge. Mirrors the server-side guard on
 * PUT /loans/:id/bank-pledge/:pledgeId/void — voiding rewrites booked cash
 * history, so it is not an operator-level action. Hiding the button is a
 * convenience, not the control: the backend rejects it regardless. */
const VOID_ROLES = ["Administrator", "Management", "Branch Manager"];

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
export function BankPledge({ focusLoanNumber }: { focusLoanNumber?: string } = {}) {
  const { error, refresh } = useLoans();
  const { openModal, closeModal } = useModal();
  const { role, can } = useAuth();
  const toast = useToast();
  // Recording a re-pledge (and adding the bank it goes to) is a create;
  // releasing or voiding one is an update. Whatever the role can't do is
  // hidden outright (see Customers.tsx).
  const canCreatePledges = can("Bank_Pledge_Management", "can_create_bank_pledge");
  const canUpdatePledges = can("Bank_Pledge_Management", "can_update_bank_pledge");
  const canCreateBanks = can("Bank_Management", "can_create_bank");
  const pageSize = useResponsivePageSize(10, 7);
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

  const canVoid = !!role && canUpdatePledges && VOID_ROLES.includes(role);
  const loadPledged = useCallback(async (page: number, query: string) => {
    setPledgedLoading(true);
    setPledgedError("");
    try {
      const res = await listLoansPage({ bankPledgeStatus: "Bank Pledged", q: query || undefined, page, limit: pageSize });
      setPledged(res.items);
      setPledgedHasMore(res.hasMore);
      setPledgedTotal(res.total);
    } catch (e) {
      setPledgedError(e instanceof ApiError ? e.message : "Could not load re-pledged loans.");
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
      setHistoryError(e instanceof ApiError ? e.message : "Could not load re-pledge history.");
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trimmedQ]);

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
      <ConfirmModalContent
        title="Release Bank Pledge"
        message={
          <>
            Release the gold pledged to <strong>{bankName}</strong> for <strong>{fmt(amount)}</strong>?
            {treatment === "CashIn"
              ? ` ${fmt(amount)} will be booked out of Cash-in-Hand.`
              : " No cash movement will be created — this pledge was recorded only."}
          </>
        }
        confirmLabel="Release"
        busyLabel="Releasing…"
        danger={false}
        onConfirm={async () => {
          setReleasingId(pledgeId);
          try {
            await releaseBankPledge(loanId, pledgeId);
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
        <div className="search"><Icon name="search" /><input className="inp" placeholder="Search loan no, bank, customer…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        {canCreateBanks && <button className="btn ghost" onClick={() => openModal(<BankModalContent onSaved={() => {}} />)}><Icon name="plus" /> Add Bank</button>}
        {canCreatePledges && <button className="btn" onClick={startNewRepledge}><Icon name="plus" /> New Re-Pledge</button>}
      </div>
      <hr className="gold-rule" style={{ margin: "4px 0 10px" }} />
      <div className="tabs bank-pledge-tabs" style={{ marginTop: 4, marginBottom: 8 }}>
        <button className={tab === "active" ? "on" : ""} onClick={() => setTab("active")}>Active</button>
        <button className={tab === "history" ? "on" : ""} onClick={() => setTab("history")}>History</button>
      </div>

      {error && <div className="notice" style={{ marginBottom: 14 }}>{error}</div>}

      {tab === "active" ? (
        <div className="card tbl-card">
          <div className="hd"><h3>Re-Pledged Loans</h3></div>
          {pledgedError && <div className="notice" style={{ margin: 14 }}>{pledgedError}</div>}
          <div className="tbl-wrap">
            <table className="tbl">
              <thead>
                <tr><th>Loan</th><th>Customer</th><th>Bank</th><th className="num">Weight</th><th className="num">Pledged Amount</th><th>Cash</th><th>Pledged On</th><th></th></tr>
              </thead>
              <tbody>
                {pledgedLoading ? (
                  <tr><td colSpan={8} className="empty">Loading…</td></tr>
                ) : pledged.length === 0 ? (
                  <tr><td colSpan={8} className="empty">No loans currently bank-pledged.</td></tr>
                ) : pledged.map((l) => {
                  const active = l.bankPledges.find((p) => !p.isReleased);
                  const treatment = active?.cashTreatment ?? "CashIn";
                  return (
                    <tr key={l.id} style={focusLoanNumber && l.id === focusLoanNumber ? { background: "var(--brand-pale)" } : undefined}>
                      <td><a href={`#loan/${l.id}`}>{l.id}</a></td>
                      <td>{l.customerName}</td>
                      <td>{active?.bankName || "—"}</td>
                      <td className="num">{fmtW(l.totalNetWeight)}</td>
                      <td className="num">{active ? fmt(active.pledgedAmount) : "—"}</td>
                      <td><CashTreatmentBadge treatment={treatment} /></td>
                      <td>{active?.pledgeDate || "—"}</td>
                      <td style={{ whiteSpace: "nowrap" }}>
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
          <div className="ft" style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <button className="btn plain sm" disabled={pledgedPage <= 1} onClick={() => changePledgedPage(Math.max(1, pledgedPage - 1))}>‹ Prev</button>
            <span style={{ fontSize: 12.5 }}>Page {pledgedPage} of {pledgedTotalPages}</span>
            <button className="btn plain sm" disabled={pledgedPage >= pledgedTotalPages} onClick={() => changePledgedPage(Math.min(pledgedTotalPages, pledgedPage + 1))}>Next ›</button>
          </div>
          {/* <div className="ft">If a customer requests closure while gold is bank-pledged, the release workflow flags the bank release step first.</div> */}
        </div>
      ) : (
        <div className="card tbl-card">
          <div className="hd"><h3>Re-Pledge History</h3></div>
          {historyError && <div className="notice" style={{ margin: 14 }}>{historyError}</div>}
          <div className="tbl-wrap">
            <table className="tbl">
              <thead>
                <tr><th>Loan</th><th>Customer</th><th>Bank</th><th className="num">Amount</th><th>Cash</th><th>Pledged</th><th>Released</th><th>Status</th></tr>
              </thead>
              <tbody>
                {historyLoading ? (
                  <tr><td colSpan={8} className="empty">Loading…</td></tr>
                ) : history.length === 0 ? (
                  <tr><td colSpan={8} className="empty">No re-pledge records yet.</td></tr>
                ) : history.map((r) => (
                  <tr key={r.id}>
                    <td>{r.loanNumber ? <a href={`#loan/${r.loanNumber}`}>{r.loanNumber}</a> : `#${r.loanId}`}</td>
                    <td>{r.customerName || "—"}</td>
                    <td>{r.bankName}</td>
                    <td className="num">{fmt(r.pledgedAmount)}</td>
                    <td><CashTreatmentBadge treatment={r.cashTreatment} /></td>
                    <td>{r.pledgeDate || "—"}</td>
                    <td>{r.releaseDate || "—"}</td>
                    <td>
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
          {/* <div className="ft">Every re-pledge ever recorded, including released and voided ones. Voided records are kept for audit and never deleted.</div> */}
          <div className="ft" style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <button className="btn plain sm" disabled={historyPage <= 1} onClick={() => changeHistoryPage(Math.max(1, historyPage - 1))}>‹ Prev</button>
            <span style={{ fontSize: 12.5 }}>Page {historyPage} of {historyTotalPages}</span>
            <button className="btn plain sm" disabled={historyPage >= historyTotalPages} onClick={() => changeHistoryPage(Math.min(historyTotalPages, historyPage + 1))}>Next ›</button>
          </div>
        </div>
      )}
    </>
  );
}

/* "Cash Added" vs "Record Only" is the single most important thing to be able
 * to see at a glance on a re-pledge: it determines whether releasing it will
 * move money, and it cannot be changed after the fact. */
function CashTreatmentBadge({ treatment }: { treatment: string }) {
  const isCash = treatment === "CashIn";
  return (
    <span className={`pill ${isCash ? "green" : ""}`} title={isCash ? "The bank's advance was added to Cash-in-Hand" : "Recorded as a re-pledge record only — no cash effect"}>
      {CASH_TREATMENT_LABELS[isCash ? "CashIn" : "RecordOnly"]}
    </span>
  );
}

function VoidPledgeModalContent({ rec, onDone }: { rec: BankPledgeRecordView; onDone: () => void }) {
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
