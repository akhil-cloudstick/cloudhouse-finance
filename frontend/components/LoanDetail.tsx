"use client";

import { useEffect, useState } from "react";
import { useModal } from "@/components/Modal";
import { useToast } from "@/components/Toast";
import { StatusChip } from "@/components/StatusChip";
import { Icon } from "@/lib/icons";
import { fmt, fmtW } from "@/lib/format";
import { getLoan, listLoans, approveLoan, type LoanView } from "@/lib/loansApi";
import { ApiError } from "@/lib/api";
import { PaymentModalContent } from "@/components/modals/PaymentModal";
import { RepledgeModalContent } from "@/components/modals/RepledgeModal";

/* Ported from legacy/app.js's `renderLoanDetail(id)`. Now reads/writes the
 * real loan API instead of the mock db. `id` is the loan's loanNumber
 * (e.g. "LN-00001"), matching how LoanRow/Loans link to #loan/<loanNumber>. */
export function LoanDetail({ id }: { id?: string }) {
  const { openModal, closeModal } = useModal();
  const toast = useToast();

  const [loan, setLoan] = useState<LoanView | null>(null);
  const [error, setError] = useState("");
  const [approving, setApproving] = useState(false);

  function load() {
    if (!id) return;
    // The backend's Get is by numeric id, not loanNumber, but List supports
    // a `q` filter matching LoanNumber (partial, case-insensitive) — since
    // loanNumber is unique, this reliably finds the one loan.
    listLoans({ q: id })
      .then((list) => {
        const match = list.find((l) => l.loanNumber === id) || null;
        if (!match) { setError("Loan not found."); return; }
        return getLoan(match.numericId).then(setLoan);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load loan."));
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

  async function doApprove(stage: "Manager" | "Management", action: "Approved" | "Rejected") {
    setApproving(true);
    try {
      // No auth/session exists anywhere in this codebase yet — mirrors
      // NewLoan.tsx's "pick a sensible default, since there's no session
      // to read a real actor id from" approach. employeeId 1 is a
      // placeholder until a real session/auth system exists.
      const updated = await approveLoan(l.numericId, { stage, action, employeeId: 1 });
      setLoan(updated);
      toast(action === "Approved" ? "Approved" : "Rejected");
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Could not record the decision — try again");
    } finally {
      setApproving(false);
    }
  }

  const approvalButtons = l.approvalStage === "PendingManager" || l.approvalStage === "PendingManagement" ? (
    <>
      <button className="btn" disabled={approving} onClick={() => doApprove(l.approvalStage === "PendingManager" ? "Manager" : "Management", "Approved")}>
        <Icon name="check" /> Approve
      </button>
      <button className="btn danger" disabled={approving} onClick={() => doApprove(l.approvalStage === "PendingManager" ? "Manager" : "Management", "Rejected")}>
        Reject
      </button>
    </>
  ) : null;

  const activePledge = l.bankPledges.find((p) => !p.isReleased);

  return (
    <>
      <div className="page-h">
        <div><h1>{l.id} <StatusChip status={l.status} /></h1>
          <p><a href={`#customer/${l.customerId}`}>{l.customerName}</a> · {l.schemeName} · opened {l.opened} · due {l.due}</p></div>
        <div className="sp" />
        {approvalButtons || (
          <>
            <button className="btn ghost sm" onClick={() => toast("Receipt/statement PDF — full build")}><Icon name="doc" /> Statement</button>
            {l.status !== "Closed" && !activePledge && (
              <button className="btn ghost sm" onClick={() => openModal(<RepledgeModalContent loan={l} onSaved={load} />)}><Icon name="bank" /> Repledge to Bank</button>
            )}
            {l.status !== "Closed" && (
              <button className="btn sm" onClick={() => openModal(<PaymentModalContent loan={l} onSaved={load} />)}><Icon name="coin" /> Record Payment</button>
            )}
          </>
        )}
      </div>
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

          <div className="card"><div className="hd"><h3>Payment History</h3></div>
            <div className="tbl-wrap"><table className="tbl">
              <thead><tr><th>Date</th><th>Type</th><th className="num">Amount</th></tr></thead>
              <tbody>
                {l.payments.length === 0 ? (
                  <tr><td colSpan={3} className="empty">No payments recorded yet.</td></tr>
                ) : l.payments.map((p) => (
                  <tr key={p.id}>
                    <td>{p.paidOn}</td><td>{p.type}</td>
                    <td className="num" style={{ color: "var(--green)" }}>{fmt(p.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table></div></div>
        </div>

        <div className="grid">
          <div className="card gtop"><div className="hd"><h3>Financial Summary</h3></div>
            <div className="bd"><div className="kv" style={{ gridTemplateColumns: "1fr 1fr" }}>
              <div className="i"><div className="k">Principal</div><div className="v">{fmt(l.principal)}</div></div>
              <div className="i"><div className="k">Outstanding</div><div className="v" style={{ color: "var(--gold-deep)", fontWeight: 600 }}>{l.outstanding ? fmt(l.outstanding) : "—"}</div></div>
              <div className="i"><div className="k">Scheme Rate</div><div className="v">{l.schemeRate}% p.a.</div></div>
              <div className="i"><div className="k">LTV</div><div className="v">{l.schemeLtv}%</div></div>
              <div className="i"><div className="k">Interest Method</div><div className="v">{l.schemeMethod}</div></div>
              <div className="i"><div className="k">Penal Interest</div><div className="v">{l.schemePenal != null ? l.schemePenal + "% / month" : "—"}</div></div>
            </div></div></div>
          <div className="card"><div className="hd"><h3>Bank Pledge</h3></div>
            <div className="bd">
              {activePledge ? (
                <>
                  <div className="kv" style={{ gridTemplateColumns: "1fr 1fr" }}>
                    <div className="i"><div className="k">Bank</div><div className="v">{activePledge.bankName}</div></div>
                    <div className="i"><div className="k">Pledged On</div><div className="v">{activePledge.pledgeDate}</div></div>
                    <div className="i"><div className="k">Pledged Amount</div><div className="v">{fmt(activePledge.pledgedAmount)}</div></div>
                    <div className="i"><div className="k">Gold Covered</div><div className="v">{fmtW(l.totalNetWeight)}</div></div>
                    <div className="i"><div className="k">Status</div><div className="v"><StatusChip status="Bank Pledged" /></div></div>
                  </div>
                  <div className="notice" style={{ marginTop: 12 }}><Icon name="shield" /> Closure requires bank release process first.</div>
                </>
              ) : (
                <p style={{ fontSize: 13.5, color: "var(--muted)" }}>
                  Gold is {l.bankPledgeStatus === "Released" ? "released to customer" : "held in-house"} — <StatusChip status={l.bankPledgeStatus} />
                </p>
              )}
            </div></div>
          <div className="card"><div className="hd"><h3>Settlement Preview</h3></div>
            <div className="bd" style={{ fontSize: 13.5 }}>
              <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0" }}><span>Principal</span><b>{fmt(l.principal)}</b></div>
              <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0" }}><span>Interest accrued</span><b>{fmt(Math.max(0, l.outstanding - l.principal))}</b></div>
              <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0" }}><span>Penal / charges</span><b>₹0</b></div>
              <div style={{ display: "flex", justifyContent: "space-between", padding: "8px 0 2px", borderTop: "1px dashed var(--line)", marginTop: 6 }}>
                <span style={{ fontWeight: 600 }}>Final settlement</span><b style={{ color: "var(--gold-deep)" }}>{l.outstanding ? fmt(l.outstanding) : "—"}</b></div>
            </div></div>
        </div>
      </div>
    </>
  );
}
