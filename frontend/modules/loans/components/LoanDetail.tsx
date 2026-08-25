"use client";

import { useEffect, useState } from "react";
import { toDataURL } from "qrcode";
import { useModal } from "@/common/components/Modal";
import { useToast } from "@/common/components/Toast";
import { useAuth } from "@/common/auth-context";
import { StatusChip } from "@/common/components/ui/StatusChip";
import { Icon } from "@/common/components/Icon";
import { fmt, fmtW } from "@/common/utils/format";
import {
  getLoanByNumber,
  approveLoan,
  releaseBankPledge,
  completeRelease,
  SANCTION_STAGES,
  SANCTION_STAGE_LABELS,
  SANCTION_STAGE_ROLES,
  startIndemnityBondEsign,
  checkIndemnityBondEsign,
  type SanctionStage,
  type LoanView,
} from "@/modules/loans/services/loanService";
import { getCustomer } from "@/modules/customers/services/customerService";
import { listPackets } from "@/modules/packets/services/packetService";
import { openPrintWindow } from "@/common/utils/print";
import { StageTracker } from "@/common/components/ui/StageTracker";
import { ApiError } from "@/common/services/httpClient";
import { useLoans } from "@/modules/loans/store/LoansProvider";
import { PaymentModalContent } from "@/common/components/modals/PaymentModal";
import { RepledgeModalContent } from "@/common/components/modals/RepledgeModal";
import { ConfirmModalContent } from "@/common/components/modals/ConfirmModal";
import { RequestExtensionModalContent, RequestReleaseModalContent } from "@/common/components/modals/RequestExtensionModal";

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
  const { role: myRole } = useAuth();

  const [loan, setLoan] = useState<LoanView | null>(null);
  const [error, setError] = useState("");
  const [approving, setApproving] = useState(false);
  const [releasing, setReleasing] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [printingLabel, setPrintingLabel] = useState(false);
  const [printingSlip, setPrintingSlip] = useState(false);
  // Indemnity bond Aadhaar eSign (Setu) — same "started, then poll" shape
  // CustomerDetail.tsx's DigiLocker Aadhaar-verify flow uses: "started"
  // means the customer's been sent the eSign URL and we're waiting for
  // them to complete Aadhaar+OTP on their own device, so a "Check Status"
  // button replaces "Send for Aadhaar eSign" until they confirm.
  const [esigning, setEsigning] = useState(false);
  const [esignStarted, setEsignStarted] = useState(false);
  const [checkingEsign, setCheckingEsign] = useState(false);
  // An outstanding request must survive a page reload: the loan itself
  // records the Setu status (indemnityBondSignStatus === "sign_initiated"),
  // so seed the local flag from it. Without this, reloading mid-signing put
  // the header back to "Send Indemnity Bond for eSign" — leaving no way to
  // poll the request already in flight, and inviting staff to start a
  // second one against the same bond.
  useEffect(() => {
    if (loan?.indemnityBondSignStatus === "sign_initiated") setEsignStarted(true);
  }, [loan?.indemnityBondSignStatus]);
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

  async function doApprove(stage: SanctionStage, action: "Approved" | "Rejected" | "Verified") {
    setApproving(true);
    try {
      // The acting employee/role are derived server-side from the
      // logged-in user's JWT — never sent from here (see
      // loansApi.ts's ApprovalInput doc comment).
      const updated = await approveLoan(l.numericId, { stage, action });
      setLoan(updated);
      refreshLoans();
      toast(action === "Approved" ? "Approved" : action === "Rejected" ? "Rejected" : "Verified — sent to the Branch Manager");
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Could not record the decision — try again");
    } finally {
      setApproving(false);
    }
  }

  // "AuthorizedManagement" is the retired 4th stage — the backend migrates
  // rows off it, but map it here too so a loan fetched before that ran
  // still renders its pending stage instead of silently showing no buttons.
  const currentStage = (l.approvalStage === "AuthorizedManagement" ? "FinalSanction" : l.approvalStage) as SanctionStage;
  const pendingStageIndex = SANCTION_STAGES.indexOf(currentStage);
  const pendingStage = pendingStageIndex >= 0 ? SANCTION_STAGES[pendingStageIndex] : null;
  // Only the role required by the current pending stage (or Administrator,
  // who may act at any stage) can act — mirrors the backend's real check
  // (Service.Approve) so someone outside the flow doesn't see clickable
  // Approve/Reject buttons that would just 403. This is a UX nicety only;
  // the server enforces it regardless of what the client shows.
  const requiredRole = pendingStage ? SANCTION_STAGE_ROLES[pendingStage] : null;
  // The LoanOperator stage is a verification, not a sanction — the operator
  // who made the loan confirms it and it moves on to the Branch Manager,
  // who is the first real approver (backend: Service.Approve). So the
  // affirmative action at that stage is "Verified", "Approved" above it.
  const isVerifyStage = pendingStage === "LoanOperator";
  const canActOnStage = !!requiredRole && (myRole === "Administrator" || myRole === requiredRole);
  // `sm` matches the other page-header buttons (Print Label, Print Slip,
  // Record Payment, …) — these used to render at the default, larger size
  // and towered over the row.
  const approvalButtons = pendingStage ? (
    canActOnStage ? (
      <>
        <button className="btn sm" disabled={approving} onClick={() => doApprove(pendingStage, isVerifyStage ? "Verified" : "Approved")}>
          <Icon name="check" /> {isVerifyStage ? "Verify" : "Approve"}
        </button>
        <button className="btn danger sm" disabled={approving} onClick={() => doApprove(pendingStage, "Rejected")}>
          Reject
        </button>
      </>
    ) : (
      <span style={{ color: "var(--muted)", fontSize: 13 }}>
        {isVerifyStage ? `Awaiting ${requiredRole} verification` : `Awaiting ${requiredRole} approval`}
      </span>
    )
  ) : null;

  const activePledge = l.bankPledges.find((p) => !p.isReleased);

  /* Confirms first: releasing moves cash (for a CashIn pledge) and changes
   * where the gold physically sits, which is too consequential for a single
   * unconfirmed click. The wording states the cash effect explicitly, since it
   * depends on the treatment chosen when the pledge was created. */
  function doReleasePledge() {
    if (!activePledge) return;
    const p = activePledge;
    openModal(
      <ConfirmModalContent
        title="Release Bank Pledge"
        message={
          <>
            Release the gold pledged to <strong>{p.bankName}</strong> for <strong>{fmt(p.pledgedAmount)}</strong>?
            {p.cashTreatment === "CashIn"
              ? ` ${fmt(p.pledgedAmount)} will be booked out of Cash-in-Hand.`
              : " No cash movement will be created — this pledge was recorded only."}
          </>
        }
        confirmLabel="Release"
        busyLabel="Releasing…"
        danger={false}
        onConfirm={async () => {
          setReleasing(true);
          try {
            await releaseBankPledge(l.numericId, p.id);
            toast("Bank pledge released");
            load();
          } finally {
            setReleasing(false);
          }
        }}
      />
    );
  }

  async function doCompleteRelease() {
    setCompleting(true);
    try {
      // The acting employee is derived server-side from the logged-in
      // user's JWT — no employeeId sent from here.
      await completeRelease(l.numericId);
      toast("Gold released to customer — loan closed");
      load();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Could not complete the release — try again");
    } finally {
      setCompleting(false);
    }
  }

  /* Ported from legacy/app.js's `printPledgeSlip()`/`printPacketLabel()`
   * (legacy/app.js:990-1119) — NewLoan.tsx's versions of these build the
   * slip/label from an in-progress draft that doesn't exist yet on the
   * backend, while this page reads the loan's real, already-persisted
   * data straight from `l`, plus one extra lookup each for details the
   * loan view alone doesn't carry (customer phone/address, packet code). */
  async function printPledgeSlip() {
    setPrintingSlip(true);
    try {
      const c = await getCustomer(l.customerId);
      openPrintWindow("Pledge Slip — " + l.id, `
        <h1>AMBIKA GOLD FINANCE</h1><h2>Gold Loan Pledge Slip</h2>
        <table>
          <tr><th style="width:110px">Loan No</th><td>${l.id}</td><th style="width:110px">Date</th><td>${new Date().toLocaleDateString("en-IN")}</td></tr>
          <tr><th>Customer</th><td>${c.name} (${c.code || c.id})</td><th>Phone</th><td>${c.phone || "—"}</td></tr>
          <tr><th>Address</th><td>${c.address || "—"}</td><th>Branch</th><td>${l.branchName || "—"}</td></tr>
          <tr><th>Scheme</th><td>${l.schemeName} @ ${l.schemeRate}% p.a. (LTV ${l.schemeLtv}%)</td>
              <th>Opened</th><td>${l.opened}</td></tr>
        </table>
        <table>
          <thead><tr><th>#</th><th>Ornament</th><th>Purity</th><th class="num">Net Wt (g)</th><th class="num">Qty</th><th class="num">Value</th><th>Photo</th></tr></thead>
          <tbody>
            ${l.ornaments.map((o, i) => `<tr><td>${i + 1}</td><td>${o.name}</td><td>${o.purity}</td>
              <td class="num">${o.netWeight.toFixed(1)}</td><td class="num">${o.quantity}</td><td class="num">${fmt(o.goldValue)}</td>
              <td style="text-align:center">${o.photoUrl ? `<img src="${o.photoUrl}" style="width:56px;height:56px;object-fit:cover">` : "—"}</td></tr>`).join("")}
            <tr><th colspan="3">Total</th><th class="num">${l.totalNetWeight.toFixed(1)}</th><th></th><th class="num">${fmt(l.totalGoldValue)}</th><th></th></tr>
          </tbody>
        </table>
        <p><b>Principal disbursed: ${fmt(l.principal)}</b> &nbsp;<span class="muted">(eligible amount at pledge time: ${fmt(l.eligibleLoanAmount)})</span></p>
        <div class="sig"><div><span>Customer Signature</span></div><div><span>Cashier</span></div><div><span>Branch Manager</span></div></div>`,
        toast);
    } catch {
      toast("Could not load customer details — try again");
    } finally {
      setPrintingSlip(false);
    }
  }

  async function printPacketLabel() {
    setPrintingLabel(true);
    try {
      const [c, packets] = await Promise.all([
        getCustomer(l.customerId),
        listPackets({ loanId: l.numericId }).catch(() => []),
      ]);
      const packet = packets[0];
      const packetLabel = packet?.code || "PKT-" + l.numericId;
      const url = packet
        ? location.origin + "/app#packet/" + packet.code
        : location.origin + "/app#loan/" + l.id;
      let qr: string;
      try {
        qr = await toDataURL(url, { width: 256, errorCorrectionLevel: "M" });
      } catch {
        toast("Could not generate QR code");
        return;
      }
      const w = window.open("", "_blank");
      if (!w) { toast("Popup blocked — please allow popups for this site to print"); return; }
      w.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Packet Label — ${l.id}</title><style>
        @page{size:50mm 30mm;margin:0}
        body{margin:0;font-family:Arial,Helvetica,sans-serif;-webkit-print-color-adjust:exact}
        .label{width:50mm;height:30mm;box-sizing:border-box;padding:1.6mm;display:flex;align-items:center;gap:1.8mm;
          border:0.3mm dashed #aaa;overflow:hidden;page-break-inside:avoid}
        .label img{width:25mm;height:25mm;flex:none}
        .t{font-size:2.5mm;line-height:1.45;min-width:0}
        .t .brand{font-size:2mm;letter-spacing:0.3mm;color:#7a5c14}
        .t .id{font-size:3.4mm;font-weight:bold}
        .t div{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
        .noprint{text-align:center;margin:8mm;font-family:Arial}
        @media print{.noprint{display:none} .label{border:none}}
      </style></head><body>
        <div class="label">
          <img src="${qr}" alt="QR">
          <div class="t">
            <div class="brand">AMBIKA GOLD FINANCE</div>
            <div class="id">${l.id} · ${packetLabel}</div>
            <div>${c.name || "—"}</div>
            <div>${c.code || c.id || "—"} · ${c.phone || ""}</div>
            <div>${new Date().toLocaleDateString("en-IN")} · ${l.totalNetWeight.toFixed(1)} g · ${l.ornaments.length} item(s)</div>
          </div>
        </div>
        <div class="noprint">
          <p style="font-size:13px;color:#555">50mm × 30mm packet label — scanning the QR opens ${url}</p>
          <button onclick="window.print()" style="padding:10px 26px;font-size:14px;cursor:pointer">🖨 Print Label</button>
        </div>
      </body></html>`);
      w.document.close();
      setTimeout(() => { try { w.focus(); w.print(); } catch { /* ignore */ } }, 400);
    } catch {
      toast("Could not load customer details — try again");
    } finally {
      setPrintingLabel(false);
    }
  }

  // Renders the bond server-side (English — see documents/api_documentation.md
  // for how to pass "hi"/"gu" instead) and starts the Aadhaar eSign request.
  // This is an ADDITIONAL path alongside NewLoan.tsx's print-and-sign-by-hand
  // buttons, not a replacement — eSign needs the customer's own device and
  // network, so the wet-signature route stays available regardless.
  async function startIndemnityEsign() {
    setEsigning(true);
    try {
      const redirectUrl = `${window.location.origin}/esign-callback`;
      const started = await startIndemnityBondEsign(l.numericId, "en", redirectUrl);
      if (started.url) window.open(started.url, "_blank", "noopener,noreferrer");
      setEsignStarted(true);
      toast("Aadhaar eSign opened in a new tab — ask the customer to complete Aadhaar + OTP signing there, then click \"Check Status\" here.");
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Could not start indemnity bond eSign.");
    } finally {
      setEsigning(false);
    }
  }

  async function checkIndemnityEsign() {
    setCheckingEsign(true);
    try {
      const result = await checkIndemnityBondEsign(l.numericId);
      if (result.status === "sign_complete") {
        setEsignStarted(false);
        load();
        toast("Indemnity bond signed successfully.");
      } else if (result.status === "failed") {
        setEsignStarted(false);
        toast("Aadhaar eSign failed — please try again.");
      } else {
        toast("Still waiting on the customer to complete Aadhaar eSign.");
      }
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Could not check eSign status.");
    } finally {
      setCheckingEsign(false);
    }
  }

  return (
    <>
      <div className="page-h">
        <div><h1>{l.id} <StatusChip status={l.status} />
          {l.isDefaulted && <StatusChip status="Defaulted" />}
          {/* A past-term loan whose interest is paid off comes back from the
              backend as "Active" (see refreshServicingStatus in
              loan/accrual.go). isOverdue stays true — the term really has
              expired — so suppress the duplicate chip here, or a serviced
              loan would read "Active" and "Overdue" at the same time. */}
          {!l.isDefaulted && l.isOverdue && l.status !== "Active" && <StatusChip status="Overdue" />}
          {!l.isOverdue && l.isDueSoon && <StatusChip status="Due Soon" />}
          </h1>
          <p><a href={`#customer/${l.customerId}`}>{l.customerName}</a> · {l.schemeName} · opened {l.opened} · due {l.due}{l.isOverdue ? ` · ${l.daysOverdue} days overdue` : ""}</p></div>
        <div className="sp" />
        {/* Always available regardless of approval stage — staff may need
         * to (re)print the packet label or pledge slip at any point in the
         * loan's life, not just before it's sanctioned. */}
        <button className="btn ghost sm" disabled={printingLabel} onClick={printPacketLabel}>
          <Icon name="box" /> {printingLabel ? "Preparing…" : "Print Label"}
        </button>
        <button className="btn ghost sm" disabled={printingSlip} onClick={printPledgeSlip}>
          <Icon name="doc" /> {printingSlip ? "Preparing…" : "Print Slip"}
        </button>
        {l.indemnityBondSignStatus === "sign_complete" && l.indemnityBondSignedUrl ? (
          <a className="btn ghost sm" href={l.indemnityBondSignedUrl} target="_blank" rel="noopener noreferrer">
            <Icon name="check" /> Signed Bond
          </a>
        ) : esignStarted ? (
          <button className="btn ghost sm" disabled={checkingEsign} onClick={checkIndemnityEsign}>
            <Icon name="doc" /> {checkingEsign ? "Checking…" : "Check eSign Status"}
          </button>
        ) : (
          <button className="btn ghost sm" disabled={esigning} onClick={startIndemnityEsign}>
            <Icon name="doc" /> {esigning ? "Preparing…" : "Send Indemnity Bond for eSign"}
          </button>
        )}
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
            <StageTracker
              stages={SANCTION_STAGES.map((s) => SANCTION_STAGE_LABELS[s])}
              currentIndex={pendingStageIndex}
            />
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
                  // Fee-applied (from allocatePayment's waterfall) shows
                  // alongside the other buckets; a newly-charged fee this
                  // entry (p.processingFee) is noted separately since it's
                  // not part of what Amount paid down — it's what got
                  // added to the balance in the first place.
                  const breakdown = [
                    p.processingFeeApplied > 0 && `Fee ${fmt(p.processingFeeApplied)}`,
                    p.penalInterestApplied > 0 && `Penal ${fmt(p.penalInterestApplied)}`,
                    p.interestApplied > 0 && `Interest ${fmt(p.interestApplied)}`,
                    p.principalApplied > 0 && `Principal ${fmt(p.principalApplied)}`,
                  ].filter(Boolean).join(" · ");
                  return (
                    <tr key={p.id}>
                      <td>{p.paidOn}</td>
                      <td>
                        {p.type}{p.description ? " — " + p.description : ""}
                        {p.processingFee > 0 && (
                          <div style={{ fontSize: 11, color: "var(--red)" }}>+{fmt(p.processingFee)} fee charged</div>
                        )}
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
              {l.outstandingProcessingFee > 0 && (
                <div className="i"><div className="k">Outstanding Processing Fee</div><div className="v" style={{ color: "var(--red)" }}>{fmt(l.outstandingProcessingFee)}</div></div>
              )}
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
                    {/* Whether this pledge put money in the till decides whether
                      * releasing it books cash back out — worth seeing here
                      * rather than having to guess. */}
                    <div className="i"><div className="k">Cash Treatment</div><div className="v">
                      {activePledge.cashTreatment === "CashIn" ? "Added to Cash-in-Hand" : "Record only — no cash effect"}
                    </div></div>
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
              {l.outstandingProcessingFee > 0 && (
                <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0" }}><span>Outstanding processing fee</span><b>{fmt(l.outstandingProcessingFee)}</b></div>
              )}
              <div style={{ display: "flex", justifyContent: "space-between", padding: "8px 0 2px", borderTop: "1px dashed var(--line)", marginTop: 6 }}>
                <span style={{ fontWeight: 600 }}>Final settlement</span><b style={{ color: "var(--gold-deep)" }}>{fmt(l.settlementAmount)}</b></div>
            </div>
            <div className="ft">Principal + Interest + Penal Interest + Processing Fee − Payments/Waivers = Final Settlement Amount</div></div>
        </div>
      </div>
    </>
  );
}
