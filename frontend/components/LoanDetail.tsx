"use client";

import { useEffect, useState } from "react";
import { useModal } from "@/components/Modal";
import { useToast } from "@/components/Toast";
import { StatusChip } from "@/components/StatusChip";
import { Icon } from "@/lib/icons";
import { fmt, fmtW } from "@/lib/format";
import {
  getLoanByNumber,
  approveLoan,
  releaseBankPledge,
  completeRelease,
  SANCTION_STAGES,
  SANCTION_STAGE_LABELS,
  SANCTION_STAGE_ROLES,
  type SanctionStage,
  type LoanView,
} from "@/lib/loansApi";
import { StageTracker } from "@/components/StageTracker";
import { ApiError } from "@/lib/api";
import { useLoans } from "@/lib/LoansProvider";
import { PaymentModalContent } from "@/components/modals/PaymentModal";
import { RepledgeModalContent } from "@/components/modals/RepledgeModal";
import { RequestExtensionModalContent, RequestReleaseModalContent } from "@/components/modals/RequestExtensionModal";

/* Ported from legacy/app.js's `renderLoanDetail(id)`. Now reads/writes the
 * real loan API instead of the mock db. `id` is the loan's loanNumber
 * (e.g. "LN-00001"), matching how LoanRow/Loans link to #loan/<loanNumber>. */
export function LoanDetail({ id }: { id?: string }) {
  const { openModal, closeModal } = useModal();
  const toast = useToast();
  // Approving/paying/repledging updates this page's own `loan` state
  // directly from the API response, but Loans.tsx/Dashboard.tsx/
  // CustomerDetail.tsx/etc. all read the *shared* LoansProvider list —
  // without also refreshing that, those pages kept showing the
  // pre-change status until a full page reload re-fetched everything.
  const { refresh: refreshLoans } = useLoans();

  const [loan, setLoan] = useState<LoanView | null>(null);
  const [error, setError] = useState("");
  const [approving, setApproving] = useState(false);
  const [releasing, setReleasing] = useState(false);
  const [completing, setCompleting] = useState(false);

  function load() {
    if (!id) return;
    // Direct, atomic lookup by loan number (GET /loans/by-number/:loanNumber)
    // — previously this went through listLoans({q: id}) + a client-side
    // find + getLoan, a racy two-step that could transiently show "Loan
    // not found" if that list call overlapped with another in-flight
    // /loans request (e.g. refreshLoans() below, or a stale request from
    // a just-abandoned page). A single request has nothing to race with.
    getLoanByNumber(id)
      .then(setLoan)
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load loan."));
    // load() also runs as PaymentModal/RepledgeModal's onSaved after a
    // payment/repledge — those change this loan's status/outstanding too,
    // so the shared list other pages read needs the same refresh.
    refreshLoans();
  }

  useEffect(() => {
    setLoan(null);
    setError("");
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (error) return <div className="empty">Loan not found — {error}</div>;
  if (!loan) return <div className="empty">Loading loan…</div>;
  const l = loan;

  function viewOrnImg(url: string, name: string) {
    openModal(
      <>
        <div className="hd"><h3>{name} — {l.id}</h3><button className="x" onClick={closeModal}>×</button></div>
        <div className="bd" style={{ textAlign: "center" }}>
          <img src={url} style={{ maxWidth: "100%", maxHeight: "70vh", borderRadius: 8 }} alt={name} />
        </div>
      </>,
      true
    );
  }

  // No auth/session exists anywhere in this codebase yet — `actorRole`
  // lets a tester pick which role is "acting" so the stage-match/
  // Administrator-override behavior in Approve() is actually exercisable.
  // employeeId 1 is a placeholder until a real session/auth system exists.
  const [actorRole, setActorRole] = useState<string>("Administrator");

  async function doApprove(stage: SanctionStage, action: "Approved" | "Rejected") {
    setApproving(true);
    try {
      const updated = await approveLoan(l.numericId, { stage, action, employeeId: 1, role: actorRole });
      setLoan(updated);
      refreshLoans();
      toast(action === "Approved" ? "Approved" : "Rejected");
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Could not record the decision — try again");
    } finally {
      setApproving(false);
    }
  }

  const pendingStageIndex = SANCTION_STAGES.indexOf(l.approvalStage as SanctionStage);
  const pendingStage = pendingStageIndex >= 0 ? SANCTION_STAGES[pendingStageIndex] : null;
  const approvalButtons = pendingStage ? (
    <>
      <select className="inp sm" value={actorRole} onChange={(e) => setActorRole(e.target.value)} style={{ maxWidth: 180 }}>
        <option value="Administrator">Acting as: Administrator</option>
        <option value={SANCTION_STAGE_ROLES[pendingStage]}>Acting as: {SANCTION_STAGE_ROLES[pendingStage]}</option>
      </select>
      <button className="btn" disabled={approving} onClick={() => doApprove(pendingStage, "Approved")}>
        <Icon name="check" /> Approve
      </button>
      <button className="btn danger" disabled={approving} onClick={() => doApprove(pendingStage, "Rejected")}>
        Reject
      </button>
    </>
  ) : null;

  const activePledge = l.bankPledges.find((p) => !p.isReleased);

  async function doReleasePledge() {
    if (!activePledge) return;
    setReleasing(true);
    try {
      await releaseBankPledge(l.numericId, activePledge.id);
      toast("Bank pledge released");
      load();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Could not release the pledge — try again");
    } finally {
      setReleasing(false);
    }
  }

  async function doCompleteRelease() {
    setCompleting(true);
    try {
      // No auth/session exists yet — employeeId 1 is a placeholder, same
      // convention as the rest of this page.
      await completeRelease(l.numericId, 1);
      toast("Gold released to customer — loan closed");
      load();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Could not complete the release — try again");
    } finally {
      setCompleting(false);
    }
  }

  return (
    <>
      <div className="page-h">
        <div><h1>{l.id} <StatusChip status={l.status} />
          {l.isDefaulted && <StatusChip status="Defaulted" />}
          {!l.isDefaulted && l.isOverdue && <StatusChip status="Overdue" />}
          {!l.isOverdue && l.isDueSoon && <StatusChip status="Due Soon" />}
          </h1>
          <p><a href={`#customer/${l.customerId}`}>{l.customerName}</a> · {l.schemeName} · opened {l.opened} · due {l.due}{l.isOverdue ? ` · ${l.daysOverdue} days overdue` : ""}</p></div>
        <div className="sp" />
        {l.status === "Closure Requested" && (
          <button className="btn" disabled={completing || l.totalOutstandingBalance > 0.01 || l.bankPledgeStatus === "Bank Pledged"} onClick={doCompleteRelease} title={l.totalOutstandingBalance > 0.01 ? "Final settlement must be fully paid first" : l.bankPledgeStatus === "Bank Pledged" ? "Release the bank pledge first" : undefined}>
            <Icon name="unlock" /> {completing ? "Releasing…" : "Complete Release"}
          </button>
        )}
        {approvalButtons || (
          <>
            <button className="btn ghost sm" onClick={() => toast("Receipt/statement PDF — full build")}><Icon name="doc" /> Statement</button>
            {l.status !== "Closed" && !activePledge && (
              <button className="btn ghost sm" onClick={() => openModal(<RepledgeModalContent loan={l} onSaved={load} />)}><Icon name="bank" /> Repledge to Bank</button>
            )}
            {l.status !== "Closed" && (
              <button className="btn sm" onClick={() => openModal(<PaymentModalContent loan={l} onSaved={load} />)}><Icon name="coin" /> Record Payment</button>
            )}
            {l.status !== "Closed" && (
              <button className="btn ghost sm" onClick={() => openModal(<RequestExtensionModalContent loan={l} onSaved={load} />)}><Icon name="clock" /> Request Extension</button>
            )}
            {l.status !== "Closed" && (
              <button className="btn ghost sm" onClick={() => openModal(<RequestReleaseModalContent loan={l} onSaved={load} />)}><Icon name="unlock" /> Request Release</button>
            )}
          </>
        )}
      </div>
      {pendingStage && (
        <div className="card" style={{ marginBottom: 14 }}>
          <div className="bd">
            <StageTracker stages={SANCTION_STAGES.map((s) => SANCTION_STAGE_LABELS[s])} currentIndex={pendingStageIndex} />
            {l.approvalWarning && (
              <div className="notice" style={{ marginTop: 10, color: "var(--amber)" }}><Icon name="shield" /> {l.approvalWarning}</div>
            )}
          </div>
        </div>
      )}
      <hr className="gold-rule" />

      <div className="grid cols21">
        <div className="grid">
          <div className="card gtop"><div className="hd"><h3>Pledged Ornaments — {fmtW(l.totalNetWeight)} total</h3></div>
            <div className="tbl-wrap"><table className="tbl">
              <thead><tr><th>Ornament</th><th>Purity</th><th className="num">Gross (g)</th><th className="num">Net (g)</th><th className="num">Qty</th><th className="num">Gold Value</th><th style={{ textAlign: "center" }}>Photo</th></tr></thead>
              <tbody>
                {l.ornaments.map((o) => (
                  <tr key={o.id}>
                    <td>{o.name}</td><td><span className="chip gold">{o.purity}</span></td>
                    <td className="num">{o.grossWeight.toFixed(1)}</td><td className="num">{o.netWeight.toFixed(1)}</td>
                    <td className="num">{o.quantity}</td><td className="num">{fmt(o.goldValue)}</td>
                    <td style={{ textAlign: "center", whiteSpace: "nowrap" }}>
                      {o.photoUrl ? (
                        <>
                          <img src={o.photoUrl} style={{ width: 34, height: 34, objectFit: "cover", borderRadius: 6, border: "1px solid var(--line)", cursor: "pointer", verticalAlign: "middle" }} title="View photo" onClick={() => viewOrnImg(o.photoUrl!, o.name)} />
                          <button className="btn plain sm" style={{ padding: "4px 8px", verticalAlign: "middle" }} onClick={() => viewOrnImg(o.photoUrl!, o.name)}>View</button>
                        </>
                      ) : (
                        <span style={{ color: "var(--muted)" }}>—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table></div>
            <div className="ft">Jewellery images linked to loan record</div></div>

          <div className="card"><div className="hd"><h3>Payment Ledger</h3></div>
            <div className="tbl-wrap"><table className="tbl">
              <thead><tr><th>Date</th><th>Description</th><th>Method</th><th>Reference</th><th className="num">Debit</th><th className="num">Credit</th><th className="num">Running Balance</th></tr></thead>
              <tbody>
                {l.payments.length === 0 ? (
                  <tr><td colSpan={7} className="empty">No ledger entries yet.</td></tr>
                ) : l.payments.map((p) => {
                  // Interest/Principal/Partial/Full Settlement/Waiver all
                  // reduce what's owed (credit); an Adjustment can go
                  // either way depending on what it corrected — shown as a
                  // credit here since today's only use is reducing
                  // principal (see loan.allocatePayment's Adjustment case).
                  const isCash = p.type !== "Adjustment" && p.type !== "Waiver";
                  const breakdown = [
                    p.principalApplied > 0 && `Principal ${fmt(p.principalApplied)}`,
                    p.interestApplied > 0 && `Interest ${fmt(p.interestApplied)}`,
                    p.penalInterestApplied > 0 && `Penal ${fmt(p.penalInterestApplied)}`,
                  ].filter(Boolean).join(" · ");
                  return (
                    <tr key={p.id}>
                      <td>{p.paidOn}</td>
                      <td>
                        {p.type}{p.description ? " — " + p.description : ""}
                        {breakdown && <div style={{ fontSize: 11, color: "var(--muted)" }}>{breakdown}</div>}
                      </td>
                      <td>{isCash ? p.method || "—" : <span style={{ color: "var(--muted)" }}>Non-cash</span>}</td>
                      <td>{p.reference || "—"}</td>
                      <td className="num">—</td>
                      <td className="num" style={{ color: "var(--green)" }}>{fmt(p.amount)}</td>
                      <td className="num">{fmt(p.runningBalance)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table></div>
            <div className="ft">Running balance = outstanding principal + outstanding interest + outstanding penal interest, immediately after this entry</div></div>
        </div>

        <div className="grid">
          <div className="card gtop"><div className="hd"><h3>Financial Summary</h3></div>
            <div className="bd"><div className="kv" style={{ gridTemplateColumns: "1fr 1fr" }}>
              <div className="i"><div className="k">Principal</div><div className="v">{fmt(l.principal)}</div></div>
              <div className="i"><div className="k">Outstanding Principal</div><div className="v" style={{ color: "var(--gold-deep)", fontWeight: 600 }}>{fmt(l.outstanding)}</div></div>
              <div className="i"><div className="k">Accrued Interest</div><div className="v">{fmt(l.accruedInterest)}</div></div>
              <div className="i"><div className="k">Interest Paid</div><div className="v">{fmt(l.interestPaid)}</div></div>
              <div className="i"><div className="k">Outstanding Interest</div><div className="v">{fmt(l.outstandingInterest)}</div></div>
              {l.accruedPenalInterest > 0 && <>
                <div className="i"><div className="k">Accrued Penal Interest</div><div className="v" style={{ color: "var(--red)" }}>{fmt(l.accruedPenalInterest)}</div></div>
                <div className="i"><div className="k">Outstanding Penal Interest</div><div className="v" style={{ color: "var(--red)" }}>{fmt(l.outstandingPenalInterest)}</div></div>
              </>}
              <div className="i"><div className="k">Total Paid</div><div className="v">{fmt(l.totalPaid)}</div></div>
              <div className="i"><div className="k">Scheme Rate</div><div className="v">{l.schemeRate}% p.a.</div></div>
              <div className="i"><div className="k">LTV</div><div className="v">{l.schemeLtv}%</div></div>
              <div className="i"><div className="k">Interest Method</div><div className="v">{l.schemeMethod}</div></div>
              <div className="i"><div className="k">Penal Rate</div><div className="v">{l.schemePenal != null ? l.schemePenal + "% p.a." : "—"}</div></div>
            </div></div></div>
          <div className="card"><div className="hd"><h3>Bank Pledge</h3></div>
            <div className="bd">
              {activePledge ? (
                <>
                  <div className="kv" style={{ gridTemplateColumns: "1fr 1fr" }}>
                    <div className="i"><div className="k">Bank</div><div className="v">{activePledge.bankName}</div></div>
                    <div className="i"><div className="k">Pledged On</div><div className="v">{activePledge.pledgeDate}</div></div>
                    <div className="i"><div className="k">Pledged Amount</div><div className="v">{fmt(activePledge.pledgedAmount)}</div></div>
                    <div className="i"><div className="k">Bank Interest Rate</div><div className="v">{activePledge.bankInterestRate ? `${activePledge.bankInterestRate}% p.a.` : "—"}</div></div>
                    <div className="i"><div className="k">Reference Number</div><div className="v">{activePledge.referenceNumber || "—"}</div></div>
                    <div className="i"><div className="k">Gold Covered</div><div className="v">{fmtW(l.totalNetWeight)}</div></div>
                    <div className="i"><div className="k">Status</div><div className="v"><StatusChip status="Bank Pledged" /></div></div>
                  </div>
                  <div className="notice" style={{ marginTop: 12 }}><Icon name="shield" /> Closure requires bank release process first.</div>
                  <button className="btn ghost sm" style={{ marginTop: 12 }} disabled={releasing} onClick={doReleasePledge}>
                    {releasing ? "Releasing…" : "Release from Bank"}
                  </button>
                </>
              ) : (
                <p style={{ fontSize: 13.5, color: "var(--muted)" }}>
                  Gold is {l.bankPledgeStatus === "Released" ? "released to customer" : "held in-house"} — <StatusChip status={l.bankPledgeStatus} />
                </p>
              )}
            </div></div>
          <div className="card"><div className="hd"><h3>Settlement Preview</h3></div>
            <div className="bd" style={{ fontSize: 13.5 }}>
              <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0" }}><span>Outstanding principal</span><b>{fmt(l.outstanding)}</b></div>
              <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0" }}><span>Outstanding interest</span><b>{fmt(l.outstandingInterest)}</b></div>
              <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0" }}><span>Outstanding penal interest</span><b>{fmt(l.outstandingPenalInterest)}</b></div>
              <div style={{ display: "flex", justifyContent: "space-between", padding: "8px 0 2px", borderTop: "1px dashed var(--line)", marginTop: 6 }}>
                <span style={{ fontWeight: 600 }}>Final settlement</span><b style={{ color: "var(--gold-deep)" }}>{fmt(l.settlementAmount)}</b></div>
            </div>
            <div className="ft">Principal + Interest + Penal Interest − Payments/Waivers = Final Settlement Amount</div></div>
        </div>
      </div>
    </>
  );
}
