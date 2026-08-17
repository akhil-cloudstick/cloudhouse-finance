"use client";

import { useCallback, useState } from "react";
import { useLoans } from "@/lib/LoansProvider";
import { useModal } from "@/components/Modal";
import { useToast } from "@/components/Toast";
import { useAuth } from "@/lib/auth-context";
import { Icon } from "@/lib/icons";
import { fmt, fmtW } from "@/lib/format";
import {
  releaseBankPledge,
  voidBankPledge,
  listBankPledgeHistory,
  CASH_TREATMENT_LABELS,
  type BankPledgeRecordView,
} from "@/lib/loansApi";
import { RepledgeModalContent, SelectLoanForRepledgeModalContent } from "@/components/modals/RepledgeModal";
import { BankModalContent } from "@/components/modals/BankModal";
import { ConfirmModalContent } from "@/components/modals/ConfirmModal";
import { ApiError } from "@/lib/api";

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
export function BankPledge() {
  const { loans, loading, error, refresh } = useLoans();
  const { openModal, closeModal } = useModal();
  const { role } = useAuth();
  const toast = useToast();
  const [tab, setTab] = useState<"active" | "history">("active");
  const [releasingId, setReleasingId] = useState<number | null>(null);
  const [history, setHistory] = useState<BankPledgeRecordView[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState("");

  const pledged = loans.filter((l) => l.bankPledgeStatus === "Bank Pledged");
  const canVoid = !!role && VOID_ROLES.includes(role);

  /* Fetched lazily — the history query spans every loan, so there is no reason
   * to pay for it until someone opens the tab. Triggered from the click handler
   * rather than an effect on `tab`: the fetch responds to a user action rather
   * than synchronizing state, and doing it in an effect trips
   * react-hooks/set-state-in-effect for the cascading render it causes. */
  const loadHistory = useCallback(async () => {
    setHistoryLoading(true);
    setHistoryError("");
    try {
      setHistory(await listBankPledgeHistory());
    } catch (e) {
      setHistoryError(e instanceof ApiError ? e.message : "Could not load re-pledge history.");
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  function showHistory() {
    setTab("history");
    void loadHistory();
  }

  function refreshAll() {
    refresh();
    if (tab === "history") void loadHistory();
  }

  function startNewRepledge() {
    openModal(
      <SelectLoanForRepledgeModalContent
        onPicked={(loan) => {
          closeModal();
          openModal(<RepledgeModalContent loan={loan} onSaved={refreshAll} />);
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
    openModal(<VoidPledgeModalContent rec={rec} onDone={() => { refreshAll(); toast("Bank pledge voided"); }} />);
  }

  return (
    <>
      <div className="page-h">
        <div><h1>Bank &amp; Gold Re-Pledge</h1><p>Customer gold re-pledged with external banks</p></div>
        <div className="sp" />
        <button className="btn ghost" onClick={() => openModal(<BankModalContent onSaved={() => {}} />)}><Icon name="plus" /> Add Bank</button>
        <button className="btn" onClick={startNewRepledge}><Icon name="plus" /> New Re-Pledge</button>
      </div>
      <hr className="gold-rule" />

      <div className="tabs" style={{ display: "flex", gap: 8, marginBottom: 14 }}>
        <button className={`btn ${tab === "active" ? "" : "ghost"} sm`} onClick={() => setTab("active")}>Active</button>
        <button className={`btn ${tab === "history" ? "" : "ghost"} sm`} onClick={showHistory}>History</button>
      </div>

      {error && <div className="notice" style={{ marginBottom: 14 }}>{error}</div>}

      {tab === "active" ? (
        <div className="card">
          <div className="hd"><h3>Re-Pledged Loans</h3></div>
          <div className="tbl-wrap">
            <table className="tbl">
              <thead>
                <tr><th>Loan</th><th>Customer</th><th>Bank</th><th className="num">Weight</th><th className="num">Pledged Amount</th><th>Cash</th><th>Pledged On</th><th></th></tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={8} className="empty">Loading…</td></tr>
                ) : pledged.length === 0 ? (
                  <tr><td colSpan={8} className="empty">No loans currently bank-pledged.</td></tr>
                ) : pledged.map((l) => {
                  const active = l.bankPledges.find((p) => !p.isReleased);
                  const treatment = active?.cashTreatment ?? "CashIn";
                  return (
                    <tr key={l.id}>
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
                            <button
                              className="btn ghost sm"
                              disabled={releasingId === active.id}
                              onClick={() => confirmRelease(l.numericId, active.id, active.bankName, active.pledgedAmount, treatment)}
                            >
                              {releasingId === active.id ? "Releasing…" : "Release"}
                            </button>
                            {canVoid && (
                              <button
                                className="btn ghost sm"
                                style={{ marginLeft: 6 }}
                                title="Cancel a re-pledge recorded in error — the only way to correct a wrong cash treatment"
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
                                Void
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
          <div className="ft">If a customer requests closure while gold is bank-pledged, the release workflow flags the bank release step first.</div>
        </div>
      ) : (
        <div className="card">
          <div className="hd"><h3>Re-Pledge History</h3></div>
          {historyError && <div className="notice" style={{ margin: 14 }}>{historyError}</div>}
          <div className="tbl-wrap">
            <table className="tbl">
              <thead>
                <tr><th>Loan</th><th>Bank</th><th className="num">Amount</th><th>Cash</th><th>Pledged</th><th>Released</th><th>Status</th></tr>
              </thead>
              <tbody>
                {historyLoading ? (
                  <tr><td colSpan={7} className="empty">Loading…</td></tr>
                ) : history.length === 0 ? (
                  <tr><td colSpan={7} className="empty">No re-pledge records yet.</td></tr>
                ) : history.map((r) => (
                  <tr key={r.id}>
                    <td>#{r.loanId}</td>
                    <td>{r.bankName}</td>
                    <td className="num">{fmt(r.pledgedAmount)}</td>
                    <td><CashTreatmentBadge treatment={r.cashTreatment} /></td>
                    <td>{r.pledgeDate || "—"}</td>
                    <td>{r.releaseDate || "—"}</td>
                    <td>
                      <span className={`pill ${r.status === "Voided" ? "red" : r.status === "Released" ? "" : "green"}`}>{r.status}</span>
                      {r.status === "Voided" && r.voidReason && (
                        <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 2 }}>{r.voidReason}</div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="ft">Every re-pledge ever recorded, including released and voided ones. Voided records are kept for audit and never deleted.</div>
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
    if (!reason.trim()) { setErr("Please state why this re-pledge is being voided."); return; }
    setBusy(true);
    try {
      await voidBankPledge(rec.loanId, rec.id, reason.trim());
      closeModal();
      onDone();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Could not void the pledge — try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="hd"><h3>Void Bank Re-Pledge</h3><button className="x" onClick={closeModal}>×</button></div>
      <div className="bd">
        {/* .notice is display:flex — keep the text in one child element. */}
        <div className="notice" style={{ marginBottom: 14 }}>
          <Icon name="shield" />
          <span>
            Voiding cancels this re-pledge of <strong>{fmt(rec.pledgedAmount)}</strong> to <strong>{rec.bankName}</strong>.
            {rec.cashTreatment === "CashIn"
              ? ` A compensating cash-out of ${fmt(rec.pledgedAmount)} will be booked, since the original added cash to the till.`
              : " No cash will move — this pledge was recorded only."}
            {" "}The record stays visible in history. To fix a wrong cash treatment, void this and create a fresh re-pledge.
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
        <button className="btn danger" onClick={submit} disabled={busy}>{busy ? "Voiding…" : "Void Re-Pledge"}</button>
      </div>
    </>
  );
}
