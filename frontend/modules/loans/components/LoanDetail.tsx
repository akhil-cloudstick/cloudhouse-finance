"use client";

import { useEffect, useRef, useState } from "react";
import { toDataURL } from "qrcode";
import { useDropdownMenu } from "@/hooks/useDropdownMenu";
import { useModal } from "@/common/components/Modal";
import { useToast } from "@/common/components/Toast";
import { useAuth } from "@/common/auth-context";
import { StatusChip } from "@/common/components/ui/StatusChip";
import { Icon } from "@/common/components/Icon";
import { fmt, fmtW } from "@/common/utils/format";
import { appPath } from "@/common/services/tenantSession";
import { rupeesInWords } from "@/common/utils/numberToWords";
import {
  getLoanByNumber,
  approveLoan,
  listTopUps,
  type LoanTopUpView,
  releaseBankPledge,
  completeRelease,
  SANCTION_STAGES,
  SANCTION_STAGE_LABELS,
  SANCTION_STAGE_ROLES,
  startIndemnityBondEsign,
  checkIndemnityBondEsign,
  canAcceptBankPledge,
  downloadLoanStatement,
  hardDeleteLoan,
  downloadIndemnityBondPDF,
  downloadReleaseAgreementPDF,
  type SanctionStage,
  type LoanView,
} from "@/modules/loans/services/loanService";
import { getCustomer } from "@/modules/customers/services/customerService";
import { listPackets } from "@/modules/packets/services/packetService";
import { openPrintWindow, brandHeader } from "@/common/utils/print";
import { BRAND, printColors } from "@/common/config/brand";
import type { BondLang } from "@/modules/loans/utils/indemnityBond";
import { StageTracker } from "@/common/components/ui/StageTracker";
import { ApiError } from "@/common/services/httpClient";
import { useLoans } from "@/modules/loans/store/LoansProvider";
import { PaymentModalContent } from "@/common/components/modals/PaymentModal";
import { RepledgeModalContent } from "@/common/components/modals/RepledgeModal";
import { ConfirmModalContent } from "@/common/components/modals/ConfirmModal";
import { EsignLanguageModalContent, type EsignDeliverBy } from "@/common/components/modals/EsignLanguageModal";
import { RequestExtensionModalContent, RequestReleaseModalContent } from "@/common/components/modals/RequestExtensionModal";
import { EditLoanModalContent } from "@/common/components/modals/EditLoanModal";
import { DisburseLoanModalContent } from "@/common/components/modals/DisburseLoanModal";
import { TopUpLoanModalContent } from "@/common/components/modals/TopUpLoanModal";

/* One row of the "Documents" dropdown below — either a click action
 * (onClick, e.g. printing something in-browser) or a plain link (href,
 * e.g. an already-signed bond opened in a new tab). */
type DocMenuItem = {
  icon: string;
  label: string;
  onClick?: () => void;
  href?: string;
  disabled?: boolean;
};

/* Groups the print/eSign actions that used to be five separate
 * same-width-but-still-crowded buttons in the page header (Print Label,
 * Print Slip, Statement, Print Bond, Signed Bond/eSign) into a single
 * "Documents ▾" trigger — same popover shell as SearchableSelect/
 * GlobalSearch (`.gs-results`), just with click actions instead of a
 * selectable value. */
function DocumentsMenu({ items }: { items: DocMenuItem[] }) {
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("click", onDocClick);
    return () => document.removeEventListener("click", onDocClick);
  }, []);

  return (
    <div className="dp" ref={boxRef} style={{ position: "relative", width: 165, flex: "0 0 auto" }}>
      <button type="button" className="btn ghost sm" style={{ width: 165, overflow: "hidden" }} onClick={() => setOpen((o) => !o)}>
        <Icon name="doc" /> <span className="doc-action-tx">Documents</span>
        <svg className="sel-chevron" viewBox="0 0 10 6" fill="none" style={{ width: 12, height: 12, flexShrink: 0, marginLeft: 4 }}>
          <path d="M1 1l4 4 4-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && (
        <div className="gs-results open" style={{ position: "absolute", top: "calc(100% + 6px)", left: 0, right: 0, width: 165, zIndex: 60 }}>
          {items.map((item, i) =>
            item.href ? (
              <a key={i} href={item.href} target="_blank" rel="noopener noreferrer" onClick={() => setOpen(false)}>
                <span className="ic"><Icon name={item.icon} /></span>
                <span className="tx"><b className="doc-menu-tx">{item.label}</b></span>
              </a>
            ) : (
              <a
                key={i}
                href="#"
                className={item.disabled ? "disabled" : ""}
                onClick={(e) => {
                  e.preventDefault();
                  if (item.disabled) return;
                  item.onClick?.();
                  setOpen(false);
                }}
              >
                <span className="ic"><Icon name={item.icon} /></span>
                <span className="tx"><b className="doc-menu-tx">{item.label}</b></span>
              </a>
            )
          )}
        </div>
      )}
    </div>
  );
}

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
  const { can } = useAuth();
  // Every action on this page is hidden, not disabled, when the role lacks
  // the grant behind it (see Customers.tsx). The print/export buttons are
  // deliberately not gated — they only render what the viewer can already
  // see. Bank pledging is its own module, so it takes its own grants.
  const canUpdateLoans = can("Loan_Management", "can_update_loan");
  const canCreateBankPledges = can("Bank_Pledge_Management", "can_create_bank_pledge");
  const canUpdateBankPledges = can("Bank_Pledge_Management", "can_update_bank_pledge");
  // Independent from "can_update_loan"/"can_delete_loan" — locking down the
  // irreversible full-cascade delete separately from ordinary edit/soft
  // delete rights is deliberate (see internal/authz/catalogue.go's own
  // comment on this permission).
  const canHardDeleteLoans = can("Loan_Management", "can_hard_delete_loan");

  const [loan, setLoan] = useState<LoanView | null>(null);
  const [topUps, setTopUps] = useState<LoanTopUpView[]>([]);
  const [error, setError] = useState("");
  const [approving, setApproving] = useState(false);
  const [releasing, setReleasing] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [statementBusy, setStatementBusy] = useState(false);
  const [printingLabel, setPrintingLabel] = useState(false);
  const [printingSlip, setPrintingSlip] = useState(false);
  const [printingSlipAndLabel, setPrintingSlipAndLabel] = useState(false);
  const [printingBond, setPrintingBond] = useState(false);
  const [printingStatement, setPrintingStatement] = useState(false);
  const [printingReleaseAgreement, setPrintingReleaseAgreement] = useState(false);
  // Indemnity bond Aadhaar eSign (Setu) — same "started, then poll" shape
  // CustomerDetail.tsx's DigiLocker Aadhaar-verify flow uses: "started"
  // means the customer's been sent the eSign URL and we're waiting for
  // them to complete Aadhaar+OTP on their own device, so a "Check Status"
  // button replaces "Send for Aadhaar eSign" until they confirm.
  const [esigning, setEsigning] = useState(false);
  const [esignStarted, setEsignStarted] = useState(false);
  const [checkingEsign, setCheckingEsign] = useState(false);
  // Print Label/Slip/Statement/Bond + the eSign action used to be 5 separate
  // header buttons — collapsed into one "Documents" dropdown (see the doc
  // menu below) so the header doesn't outgrow the space next to the loan
  // title on anything but a very wide screen.
  const {
    open: docsMenuOpen,
    setOpen: setDocsMenuOpen,
    menuRef: docsMenuRef,
    triggerRef: docsMenuTriggerRef,
    onKeyDown: onDocsMenuKeyDown,
  } = useDropdownMenu<HTMLDivElement>();
  // Repledge to Bank / Request Extension / Request Release used to be 3
  // more separate header buttons alongside Record Payment — collapsed into
  // one "Loan Actions" dropdown the same way Documents was, for the same
  // reason (outgrew the header on anything but a very wide screen). Record
  // Payment stays its own visible button — it's the primary action here
  // (styled `btn`, not `btn ghost`, unlike the other three), not something
  // to bury a click deeper for.
  const {
    open: loanActionsMenuOpen,
    setOpen: setLoanActionsMenuOpen,
    menuRef: loanActionsMenuRef,
    triggerRef: loanActionsMenuTriggerRef,
    onKeyDown: onLoanActionsMenuKeyDown,
  } = useDropdownMenu<HTMLDivElement>();
  // An outstanding request must survive a page reload: the loan itself
  // records the Setu status (indemnityBondSignStatus === "sign_initiated"),
  // so seed the local flag from it. Without this, reloading mid-signing put
  // the header back to "Send Indemnity Bond for eSign" — leaving no way to
  // poll the request already in flight, and inviting staff to start a
  // second one against the same bond.
  useEffect(() => {
    if (loan?.indemnityBondSignStatus === "sign_initiated") setEsignStarted(true);
  }, [loan?.indemnityBondSignStatus]);
  function load(isBackgroundRefresh = false) {
    if (!id) return;
    // Direct, atomic lookup by loan number (GET /loans/by-number/:loanNumber)
    // — previously this went through listLoans({q: id}) + a client-side
    // find + getLoan, a racy two-step that could transiently show "Loan
    // not found" if that list call overlapped with another in-flight
    // /loans request (e.g. refreshLoans() below, or a stale request from
    // a just-abandoned page). A single request has nothing to race with.
    getLoanByNumber(id)
      .then(setLoan)
      .catch((e) => {
        // The 20s background poll below shares this function but must never
        // blank out a page that's already showing a valid loan — e.g. an
        // approval that just committed successfully, followed moments later
        // by an unrelated transient failure on this poll's own request. Only
        // the initial mount fetch (isBackgroundRefresh === false) should
        // surface "Loan not found".
        if (isBackgroundRefresh) return;
        setError(e instanceof Error ? e.message : "Failed to load loan.");
      });
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

  // Top-up history — a small, separate fetch (LoanView itself carries
  // ornaments/payments but not top-ups) refreshed whenever the loan's own
  // numbers change, e.g. right after a top-up.
  useEffect(() => {
    if (!loan) return;
    listTopUps(loan.numericId).then(setTopUps).catch(() => setTopUps([]));
  }, [loan?.numericId, loan?.outstanding]);

  // The viewer who clicks Approve/Reject/Verify sees their own change
  // immediately (doApprove below calls setLoan(updated) directly) — this
  // poll is for everyone else who might have this same loan open: the next
  // approver in the chain, say, sitting on this page waiting for their
  // turn. Without it, that stage only "came online" for them after a
  // manual reload, since there's no live-push channel for staff pages
  // (only customer-mobile has one, over internal/notification's
  // WebSocket). 20s is frequent enough that a stage change shows up
  // quickly without a real-time channel, without hammering the loan
  // endpoint on every open tab.
  useEffect(() => {
    if (!id) return;
    const timer = setInterval(() => load(true), 20000);
    return () => clearInterval(timer);
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
  // Whether the viewer may act at the CURRENT pending stage is now a real
  // "Loan Sanction" permission grant (see internal/authz.Catalogue),
  // not a role-name match — an admin can grant e.g. "can approve branch
  // manager stage" to any role, not just one literally named "Branch
  // Manager". This mirrors the backend's real check (Service.Approve,
  // checkStagePermission) so someone outside the flow doesn't see
  // clickable Approve/Reject buttons that would just 403; it's a UX
  // nicety only — the server enforces it regardless of what the client
  // shows. requiredRole is kept purely for the "Awaiting <role>
  // approval" display text below.
  const requiredRole = pendingStage ? SANCTION_STAGE_ROLES[pendingStage] : null;
  // The LoanOperator stage is a verification, not a sanction — the operator
  // who made the loan confirms it and it moves on to the Branch Manager,
  // who is the first real approver (backend: Service.Approve). So the
  // affirmative action at that stage is "Verified", "Approved" above it.
  const isVerifyStage = pendingStage === "LoanOperator";
  const STAGE_PERMISSIONS: Record<SanctionStage, string> = {
    LoanOperator: "can_verify_loan",
    BranchManager: "can_approve_branch_manager_stage",
    FinalSanction: "can_sanction_loan",
  };
  // The stage permission says whose turn it is; "can update loan" says
  // whether the viewer may act on loans at all. Both must hold, or they
  // see the "awaiting …" note instead of clickable buttons.
  const canActOnStage = !!pendingStage && canUpdateLoans && can("Loan_Sanction", STAGE_PERMISSIONS[pendingStage]);
  // `sm` matches the other page-header buttons (Print Label, Print Slip,
  // Record Payment, …) — these used to render at the default, larger size
  // and towered over the row.
  // Edit Loan is reachable during sanction review too, not only once a loan
  // is fully Active — the Loan Officer verifying at the first stage is
  // exactly who most often needs to correct a scheme/weight typo before it
  // moves on, and waiting for full sanction just to fix it would mean
  // re-running the whole chain. Gated the same as the Loan Actions menu's
  // own Edit Loan entry: plain "can update loan", not the stage-specific
  // verify/approve/sanction permission.
  const editLoanButton = canUpdateLoans && l.status !== "Closed" && l.status !== "Auctioned" ? (
    <button className="btn ghost" onClick={() => openModal(<EditLoanModalContent loan={l} onSaved={load} />, true)}>
      <Icon name="edit" /> Edit Loan
    </button>
  ) : null;

  // The FinalSanction stage's Approve action is also the disbursement
  // moment (Service.Approve's disbursing branch) — collect the split-mode
  // breakdown via a modal instead of the earlier stages' plain one-click
  // Approve/Verify, which move no cash.
  function onApproveClick() {
    if (!pendingStage) return;
    if (pendingStage === "FinalSanction") {
      openModal(
        <DisburseLoanModalContent
          loan={l}
          stage={pendingStage}
          onSaved={(updated) => { setLoan(updated); refreshLoans(); toast("Approved and disbursed"); }}
        />
      );
      return;
    }
    doApprove(pendingStage, isVerifyStage ? "Verified" : "Approved");
  }

  const approvalButtons = pendingStage ? (
    canActOnStage ? (
      <>
        <button className="btn" disabled={approving} onClick={onApproveClick}>
          <Icon name="check" /> {isVerifyStage ? "Verify" : "Approve"}
        </button>
        <button className="btn danger" disabled={approving} onClick={() => doApprove(pendingStage, "Rejected")}>
          Reject
        </button>
        {editLoanButton}
      </>
    ) : (
      <>
        <span style={{ color: "var(--muted)", fontSize: 13 }}>
          {isVerifyStage ? `Awaiting ${requiredRole} verification` : `Awaiting ${requiredRole} approval`}
        </span>
        {editLoanButton}
      </>
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

  /* Downloads the account statement PDF. The button is disabled while this
   * runs: the request accrues interest server-side before rendering, so a
   * double-click would otherwise hand the customer two documents whose
   * figures differ by a few seconds of interest. */
  async function doStatement() {
    if (!l) return;
    setStatementBusy(true);
    try {
      await downloadLoanStatement(l.numericId);
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Could not prepare the statement — try again.");
    } finally {
      setStatementBusy(false);
    }
  }

  async function doCompleteRelease() {
    // Checked client-side first, with the exact wording staff need to act
    // on, rather than leaving the button plain `disabled` — a disabled
    // button fires no click at all, so a person who hadn't noticed why (the
    // reason was only ever a hover title) got no feedback whatsoever when
    // they pressed it. The backend still enforces both regardless (see
    // ErrOutstandingBalanceRemains/ErrBankPledgeStillActive) — this is only
    // a clearer, more direct front for the same two rules.
    if (l.totalOutstandingBalance > 0.01) {
      toast("Final settlement must be fully paid before this loan can be released.");
      return;
    }
    if (l.bankPledgeStatus === "Bank Pledged") {
      toast("This loan's ornament is still pledged to a bank — release the ornament from the bank pledge before completing the release.");
      return;
    }
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
  /* Paper copy of the same pledge agreement the eSign flow sends, for
   * offline wet-ink signing — the branch prints it, the customer and two
   * witnesses sign by hand, and it is filed. Independent of the Aadhaar
   * eSign status: staff need this whenever eSign is unavailable, declined,
   * or the customer simply prefers paper.
   *
   * Sends the server-rendered PDF (GET /loans/:id/indemnity-bond/pdf)
   * straight to the print dialog, rather than opening the old client-side
   * window.print() copy — only the backend's chromedp render can produce
   * a real per-page header/footer (see loanService.ts's
   * downloadIndemnityBondPDF doc comment); a browser's own print dialog
   * has no equivalent a page's CSS can drive. NewLoan.tsx's pre-submission
   * preview still uses the old client-side copy — there's no saved loan
   * id yet to render against. */
  function printBond(lang: BondLang = "en") {
    setPrintingBond(true);
    downloadIndemnityBondPDF(l.numericId, lang)
      .catch(() => toast("Could not print the pledge agreement — try again."))
      .finally(() => setPrintingBond(false));
  }

  /* Inner markup only (no <html>/brand-window wrapper) — shared by
   * printPledgeSlip (its own print window) and printSlipAndLabel (combined
   * with the packet label below into one print job). Needs the customer
   * record the same way printPledgeSlip always has. */
  function pledgeSlipBodyHTML(c: { name: string; code?: string; id: string; phone?: string; address?: string }): string {
    return `
      ${brandHeader("Gold Loan Pledge Slip")}
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
      <div class="sig"><div><span>Customer Signature</span></div><div><span>Cashier</span></div><div><span>Branch Manager</span></div></div>`;
  }

  async function printPledgeSlip() {
    setPrintingSlip(true);
    try {
      const c = await getCustomer(l.customerId);
      openPrintWindow("Pledge Slip — " + l.id, pledgeSlipBodyHTML(c), toast);
    } catch {
      toast("Could not load customer details — try again");
    } finally {
      setPrintingSlip(false);
    }
  }

  /* Release Agreement — only reachable once the loan has actually closed
   * (CompleteRelease already ran), same Documents dropdown as the other
   * prints. Server-rendered (GET /loans/:id/release-agreement/pdf) — see
   * downloadReleaseAgreementPDF's doc comment — so there's no more
   * client-side data assembly here, unlike the old printReleaseAgreement(). */
  async function printReleaseAgreementDoc(lang: "en" | "ml") {
    setPrintingReleaseAgreement(true);
    try {
      await downloadReleaseAgreementPDF(l.numericId, lang);
    } catch {
      toast("Could not generate the release agreement — try again");
    } finally {
      setPrintingReleaseAgreement(false);
    }
  }

  /* Payment statement — a printable copy of the Payment Ledger card below,
   * plus the same loan/customer header printPledgeSlip uses, restructured
   * as a formal Statement of Account carrying the statutory particulars a
   * moneylender's statement must show: (1) a true account of the
   * transaction with the debtor — the ledger table itself; (2) the loan
   * amount in words and figures, and its date; (3) the maturity date; (4)
   * the nature of the security; (5) the interest rate charged; (6) the
   * debtor's full name and address. l.additionalInfo is whatever staff
   * added when the loan was created (NewLoan.tsx) — there's no prompt for
   * it here, it's just carried through. openPrintWindow opens the
   * document in its own tab first (the "preview" — the browser's own
   * print dialog only appears after, and can be cancelled from there
   * without ever producing a file) rather than silently generating a PDF. */
  async function printStatement() {
    setPrintingStatement(true);
    try {
      const c = await getCustomer(l.customerId);
      const rows = l.payments.length
        ? l.payments.map((p) => {
          const isCash = p.type !== "Adjustment" && p.type !== "Waiver";
          const breakdown = [
            p.processingFeeApplied > 0 && `Fee ${fmt(p.processingFeeApplied)}`,
            p.penalInterestApplied > 0 && `Penal ${fmt(p.penalInterestApplied)}`,
            p.interestApplied > 0 && `Interest ${fmt(p.interestApplied)}`,
            p.principalApplied > 0 && `Principal ${fmt(p.principalApplied)}`,
          ].filter(Boolean).join(" · ");
          return `<tr>
              <td>${p.paidOn}</td>
              <td>${p.type}${p.description ? " — " + p.description : ""}${breakdown ? `<br><span class="muted">${breakdown}</span>` : ""}</td>
              <td>${isCash ? p.method || "—" : "Non-cash"}</td>
              <td>${p.reference || "—"}</td>
              <td class="num">${fmt(p.amount)}</td>
              <td class="num">${fmt(p.runningBalance)}</td>
            </tr>`;
        }).join("")
        : `<tr><td colspan="6" style="text-align:center;color:#777">No ledger entries yet.</td></tr>`;
      const security = l.ornaments.length
        ? l.ornaments.map((o) => `${o.quantity} × ${o.name} (${o.purity}, net ${o.netWeight.toFixed(1)}g)`).join("; ") +
        ` — total net weight ${fmtW(l.totalNetWeight)}`
        : "—";
      openPrintWindow("Statement — " + l.id, `
        ${brandHeader("Statement of Account")}
        <table>
          <tr><th style="width:150px">Loan No</th><td>${l.id}</td><th style="width:150px">Statement Date</th><td>${new Date().toLocaleDateString("en-IN")}</td></tr>
          <tr><th>Debtor Name</th><td colspan="3">${c.name}</td></tr>
          <tr><th>Debtor Address</th><td colspan="3">${c.address || "—"}</td></tr>
          <tr><th>Amount of Loan</th><td>${fmt(l.principal)}</td><th>Amount in Words</th><td>${rupeesInWords(l.principal)}</td></tr>
          <tr><th>Date of Loan</th><td>${l.opened}</td><th>Date of Maturity</th><td>${l.due}</td></tr>
          <tr><th>Rate of Interest</th><td>${l.schemeRate}% p.a.</td><th>Status</th><td>${l.status}</td></tr>
          <tr><th>Nature of Security</th><td colspan="3">${security}</td></tr>
          ${l.additionalInfo ? `<tr><th>Additional Information</th><td colspan="3">${l.additionalInfo}</td></tr>` : ""}
        </table>
        <p><b>True account of the transaction with the debtor:</b></p>
        <table>
          <thead><tr><th>Date</th><th>Description</th><th>Method</th><th>Reference</th><th class="num">Amount</th><th class="num">Running Balance</th></tr></thead>
          <tbody>${rows}</tbody>
          <tfoot><tr><th colspan="4">Outstanding Principal</th><th class="num">${fmt(l.outstanding)}</th><th></th></tr></tfoot>
        </table>
        <p class="muted">Running balance = outstanding principal + outstanding interest + outstanding penal interest, immediately after each entry.</p>`,
        toast);
    } catch {
      toast("Could not load customer details — try again");
    } finally {
      setPrintingStatement(false);
    }
  }

  /* Resolves the QR code + packet code shared by printPacketLabel (its own
   * die-cut-stock print window) and printSlipAndLabel (the label reworked
   * to sit centered on a normal A4 page instead). Kept separate from the
   * two functions' own HTML/window logic since only this data-gathering
   * part is identical between them — the markup around it differs (sticker
   * page size vs. A4). Returns null (after toasting) on QR failure so
   * callers can bail the same way the original try/catch did. */
  async function packetLabelData(): Promise<{ c: Awaited<ReturnType<typeof getCustomer>>; packetLabel: string; url: string; qr: string } | null> {
    const [c, packets] = await Promise.all([
      getCustomer(l.customerId),
      listPackets({ loanId: l.numericId }).catch(() => []),
    ]);
    const packet = packets[0];
    const packetLabel = packet?.code || "PKT-" + l.numericId;
    // appPath keeps the business slug, so a scanned label opens the right
    // organisation's app rather than a bare /app that has forgotten which
    // business the reader belongs to.
    const url = packet
      ? location.origin + appPath(undefined, "#packet/" + packet.code)
      : location.origin + appPath(undefined, "#loan/" + l.id);
    let qr: string;
    try {
      qr = await toDataURL(url, { width: 256, errorCorrectionLevel: "M" });
    } catch {
      toast("Could not generate QR code");
      return null;
    }
    return { c, packetLabel, url, qr };
  }

  /* The label's own CSS + markup, shared by printPacketLabel (label-only,
   * its own 81mm×12mm die-cut-stock page) and printSlipAndLabel (label
   * reworked onto a normal A4 page via labelStyleForA4/labelBodyHTML
   * below). Kept as one source of truth so the two never drift apart —
   * see printSlipAndLabel's own comment for why the combined print can't
   * just reuse this page size unchanged. */
  function labelStyle(): string {
    return `
      body{margin:0;font-family:Arial,Helvetica,sans-serif;-webkit-print-color-adjust:exact}
      .label{width:50mm;height:30mm;box-sizing:border-box;padding:1.6mm;display:flex;align-items:center;gap:1.8mm;
        border:0.3mm dashed #aaa;overflow:hidden;page-break-inside:avoid}
      .label img{width:25mm;height:25mm;flex:none}
      .t{font-size:2.5mm;line-height:1.45;min-width:0}
      .t .brand{font-size:2mm;letter-spacing:0.3mm;color:${printColors().brand}}
      .t .id{font-size:3.4mm;font-weight:bold}
      .t div{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}`;
  }

  function labelBodyHTML(data: { c: Awaited<ReturnType<typeof getCustomer>>; packetLabel: string; qr: string }): string {
    const { c, packetLabel, qr } = data;
    return `<div class="label">
      <img src="${qr}" alt="QR">
      <div class="t">
        <div class="brand">${BRAND.name.toUpperCase()}</div>
        <div class="id">${l.id} · ${packetLabel}</div>
        <div>${c.name || "—"}</div>
        <div>${c.code || c.id || "—"} · ${c.phone || ""}</div>
        <div>${new Date().toLocaleDateString("en-IN")} · ${l.totalNetWeight.toFixed(1)} g · ${l.ornaments.length} item(s)</div>
      </div>
    </div>`;
  }

  async function printPacketLabel() {
    setPrintingLabel(true);
    try {
      const data = await packetLabelData();
      if (!data) return;
      const w = window.open("", "_blank");
      if (!w) { toast("Popup blocked — please allow popups for this site to print"); return; }
      // Die-cut "flag tag" stock: 81mm total — a 56mm×12mm head (perforated
      // at the 28mm midpoint) plus a blank 25mm×3mm strap for wrapping
      // around/through the item and tearing off. See the approved wire
      // diagram (packet-flag-tag artifact) — same layout as NewLoan.tsx's
      // printPacketLabel: first 28mm segment holds the QR, the second (the
      // half that stays with the item once torn) holds the readable
      // identifiers, the strap stays blank.
      w.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Packet Label — ${l.id}</title><style>
        @page{size:81mm 12mm;margin:0}
        ${labelStyle()}
        .noprint{text-align:center;margin:8mm;font-family:Arial}
        @media print{.noprint{display:none} .head{border:none} .infocell{border-left:none} .strap .band{border:none}}
      </style></head><body>
        ${labelBodyHTML(data)}
        <div class="noprint">
          <p style="font-size:13px;color:#555">81mm × 12mm flag tag — scanning the QR opens ${data.url}</p>
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

  /* Combined "Print Slip + Label" — one print job, one A4 page: the slip's
   * own content followed directly by the label (a dashed rule separates the
   * two), NOT a hard page-break onto a second sheet. The label's native
   * stock is a 81mm×12mm die-cut tag, a different physical size from the
   * slip's A4, but at natural size it's small enough to sit comfortably
   * below the slip's table/signature block on a single A4 sheet — same
   * markup/CSS (labelStyle/labelBodyHTML) as the standalone label print,
   * just without the 81mm @page override. Order is slip then label, per the
   * print-format request this was added for. */
  async function printSlipAndLabel() {
    setPrintingSlipAndLabel(true);
    try {
      const [c, data] = await Promise.all([getCustomer(l.customerId), packetLabelData()]);
      if (!data) return;
      openPrintWindow(
        "Pledge Slip + Label — " + l.id,
        `${pledgeSlipBodyHTML(c)}
        <div style="margin-top:24px;padding-top:16px;border-top:1px dashed #ccc;text-align:center">
          <style>${labelStyle()}</style>
          <div style="display:inline-block">${labelBodyHTML(data)}</div>
          <p class="muted" style="margin-top:12px">Packet label — scanning the QR opens ${data.url}</p>
        </div>`,
        toast
      );
    } catch {
      toast("Could not load customer/packet details — try again");
    } finally {
      setPrintingSlipAndLabel(false);
    }
  }

  // Renders the bond server-side in the requested language (see
  // BondLang/BOND_LANG_OPTIONS in indemnityBond.ts — "en" or "ml", chosen
  // by the officer in EsignLanguageModal below) and starts the Aadhaar
  // eSign request. This is an ADDITIONAL path alongside NewLoan.tsx's
  // print-and-sign-by-hand buttons, not a replacement — eSign needs the
  // customer's own device and network, so the wet-signature route stays
  // available regardless.
  async function startIndemnityEsign(lang: BondLang, deliverBy: EsignDeliverBy = "whatsapp") {
    setEsigning(true);
    try {
      const redirectUrl = `${window.location.origin}/esign-callback`;
      const started = await startIndemnityBondEsign(l.numericId, lang, redirectUrl, deliverBy);
      if (deliverBy === "open" && started.url) {
        window.open(started.url, "_blank", "noopener,noreferrer");
      }
      setEsignStarted(true);
      if (deliverBy === "whatsapp") {
        toast("Pledge agreement eSign link sent to customer via WhatsApp. Click \"Check Status\" once signed.");
      } else if (deliverBy === "dashboard") {
        toast("Pledge agreement eSign link sent to customer mobile app. Click \"Check Status\" once signed.");
      } else {
        toast("Aadhaar eSign opened in a new tab — ask the customer to complete Aadhaar + OTP signing there, then click \"Check Status\" here.");
      }
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Could not start indemnity bond eSign.");
    } finally {
      setEsigning(false);
    }
  }

  // Opens EsignLanguageModalContent so the officer picks English/Malayalam before
  // printing the bond.
  function openPrintBondLanguagePicker() {
    openModal(
      <EsignLanguageModalContent
        loanNumber={l.id}
        customerName={l.customerName}
        title="Print Pledge Agreement"
        confirmLabel="🖨 Print Bond"
        onConfirm={(lang) => printBond(lang)}
      />
    );
  }

  // Opens EsignLanguageModal so the officer picks English/Malayalam and delivery
  // channel (WhatsApp, customer mobile app, or browser tab) before starting the request.
  async function openEsignLanguagePicker() {
    let phone: string | undefined;
    try {
      const c = await getCustomer(l.customerId);
      phone = c.phone;
    } catch {
      // ignore
    }
    openModal(
      <EsignLanguageModalContent
        loanNumber={l.id}
        customerName={l.customerName}
        customerPhone={phone}
        showDelivery={true}
        onConfirm={(lang, deliverBy) => startIndemnityEsign(lang, deliverBy)}
      />
    );
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
        {/* flex:1;min-width:0 (app.css's .page-h-title) lets this block
         * shrink and truncate its subtitle line instead of holding its
         * full natural width and forcing `.page-h-actions` below it — the
         * combined width of a long customer name/scheme/date line plus
         * Documents/Record Payment/Loan Actions was landing right at
         * `.page-h`'s own wrap threshold, dropping the whole button
         * cluster to its own line on anything but a very wide window even
         * though there was visibly still room for it beside the title. */}
        <div className="page-h-title"><h1>{l.id} <StatusChip status={l.status} />
          {l.isDefaulted && <StatusChip status="Defaulted" />}
          {/* A past-term loan whose interest is paid off comes back from the
              backend as "Active" (see refreshServicingStatus in
              loan/accrual.go). isOverdue stays true — the term really has
              expired — so suppress the duplicate chip here, or a serviced
              loan would read "Active" and "Overdue" at the same time. */}
          {!l.isDefaulted && l.isOverdue && l.status !== "Active" && <StatusChip status="Overdue" />}
          {!l.isOverdue && l.isDueSoon && <StatusChip status="Due Soon" />}
          </h1>
          <p style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}><a href={`#customer/${l.customerId}`}>{l.customerName}</a> · {l.schemeName} · opened {l.opened} · due {l.due}{l.isOverdue ? ` · ${l.daysOverdue} days overdue` : ""}</p></div>
        {/* Everything from here down is one right-aligned group rather than
         * flat siblings of `.page-h` itself — `.page-h`'s own flex-wrap
         * only right-aligns this whole cluster while it fits on the title's
         * line; once it wraps to its own line(s) (a narrow window, or the
         * approval stage growing the button count), a plain sibling wrap
         * starts flush at the container's LEFT edge instead, so a lone
         * wrapped button (e.g. "Loan Actions") stranded left of empty space
         * read as misplaced. `.page-h-actions` wraps internally with its
         * own `justify-content:flex-end` (app.css), so every wrapped line
         * — including a single leftover button — stays right-aligned. */}
        {/* Order: Record Payment, Complete Release, Loan Actions, Documents
         * (left to right) — Documents sits last since it's read-only
         * paperwork (print/eSign), while the other three all change the
         * loan's own state and read more naturally leading. */}
        <div className="page-h-actions">
          {approvalButtons ? approvalButtons : (
            l.status !== "Closed" && canUpdateLoans && (
              <button className="btn" onClick={() => openModal(<PaymentModalContent loan={l} onSaved={load} />)}><Icon name="coin" /> Record Payment</button>
            )
          )}
          {l.status === "Closure Requested" && canUpdateLoans && (
            // Only actually disabled while the request is in flight — the
            // settlement/pledge gates below are enforced (and explained) by
            // doCompleteRelease itself via a toast, since a plain `disabled`
            // button never fires a click at all, leaving a hover-only title
            // as the sole explanation. The title stays as a bonus hint for
            // anyone who hovers before clicking.
            <button className="btn" disabled={completing} onClick={doCompleteRelease} title={l.totalOutstandingBalance > 0.01 ? "Final settlement must be fully paid first" : l.bankPledgeStatus === "Bank Pledged" ? "Release the bank pledge first" : undefined}>
              <Icon name="unlock" /> {completing ? "Releasing…" : "Complete Release"}
            </button>
          )}
          {!approvalButtons && ((canAcceptBankPledge(l.status, l.bankPledgeStatus) && !activePledge && canCreateBankPledges) || (l.status !== "Closed" && canUpdateLoans) || canHardDeleteLoans) && (
            <div className="docs-dd" ref={loanActionsMenuRef} onKeyDown={onLoanActionsMenuKeyDown}>
              <button
              ref={loanActionsMenuTriggerRef}
              className="btn ghost"
              onClick={() => setLoanActionsMenuOpen((v) => !v)}
              aria-haspopup="menu"
              aria-expanded={loanActionsMenuOpen}
            >
                <Icon name="gear" /> Loan Actions <Icon name="chevronDown" className="docs-dd-chev" />
              </button>
              {loanActionsMenuOpen && (
                <div className="docs-dd-menu" role="menu">
                  {canAcceptBankPledge(l.status, l.bankPledgeStatus) && !activePledge && canCreateBankPledges && (
                    <a href="#" title="Repledge to Bank" onClick={(e) => { e.preventDefault(); setLoanActionsMenuOpen(false); openModal(<RepledgeModalContent loan={l} onSaved={load} />); }}>
                      <Icon name="bank" /><span className="tx">Repledge to Bank</span>
                    </a>
                  )}
                  {l.status !== "Closed" && canUpdateLoans && (
                    <a href="#" title="Request Extension" onClick={(e) => { e.preventDefault(); setLoanActionsMenuOpen(false); openModal(<RequestExtensionModalContent loan={l} onSaved={load} />); }}>
                      <Icon name="clock" /><span className="tx">Request Extension</span>
                    </a>
                  )}
                  {l.status !== "Closed" && canUpdateLoans && (
                    <a href="#" title="Request Release" onClick={(e) => { e.preventDefault(); setLoanActionsMenuOpen(false); openModal(<RequestReleaseModalContent loan={l} onSaved={load} />); }}>
                      <Icon name="unlock" /><span className="tx">Request Release</span>
                    </a>
                  )}
                {l.status !== "Closed" && l.status !== "Auctioned" && canUpdateLoans && (
                  <a href="#" title="Edit Loan" onClick={(e) => { e.preventDefault(); setLoanActionsMenuOpen(false); openModal(<EditLoanModalContent loan={l} onSaved={load} />, true); }}>
                    <Icon name="edit" /><span className="tx">Edit Loan</span>
                  </a>
                )}
                {l.status === "Active" && canUpdateLoans && (
                  <a href="#" title="Top Up Loan" onClick={(e) => { e.preventDefault(); setLoanActionsMenuOpen(false); openModal(<TopUpLoanModalContent loan={l} onSaved={load} />); }}>
                    <Icon name="coin" /><span className="tx">Top Up</span>
                  </a>
                )}
                {/* Deliberately the ONLY delete action offered here — there
                 * is no separate "soft delete" alternative next to it, by
                 * explicit product decision. Gated by its own permission
                 * ("can hard delete loan"), independent of ordinary
                 * update/delete rights. */}
                {canHardDeleteLoans && (
                  <a
                    href="#"
                    title="Delete Loan Permanently"
                    className="danger"
                    onClick={(e) => {
                      e.preventDefault();
                      setLoanActionsMenuOpen(false);
                      openModal(
                        <ConfirmModalContent
                          title="Delete Loan Permanently"
                          confirmLabel="Delete Permanently"
                          busyLabel="Deleting…"
                          message={
                            <>
                              This permanently and irreversibly deletes loan <strong>{l.id}</strong>.
                              <br /><br />
                              Every record tied to it will be removed: payments, ornaments, approvals,
                              extension/release requests, auctions, bank pledges, packets, and reminders.
                              <br /><br />
                              This cannot be undone.
                            </>
                          }
                          onConfirm={async () => {
                            await hardDeleteLoan(l.numericId);
                            toast("Loan deleted permanently");
                            refreshLoans();
                            location.hash = "loans";
                          }}
                        />
                      );
                    }}
                  >
                    <Icon name="trash" /><span className="tx">Delete Loan Permanently</span>
                  </a>
                )}
                </div>
              )}
            </div>
          )}
          {/* Print Label/Slip/Statement/Bond + the eSign action — always
         * available regardless of approval stage (staff may need to
         * (re)print the packet label or pledge slip at any point in the
         * loan's life, not just before it's sanctioned) — collapsed into
         * one "Documents" dropdown rather than 5 separate header buttons,
         * which outgrew the space next to the loan title on anything but a
         * very wide screen. */}
          <div className="docs-dd" ref={docsMenuRef} onKeyDown={onDocsMenuKeyDown}>
            <button
            ref={docsMenuTriggerRef}
            className="btn ghost"
            onClick={() => setDocsMenuOpen((v) => !v)}
            aria-haspopup="menu"
            aria-expanded={docsMenuOpen}
          >
              <Icon name="doc" /> Documents <Icon name="chevronDown" className="docs-dd-chev" />
            </button>
            {docsMenuOpen && (
              <div className="docs-dd-menu" role="menu">
                <a href="#" title="Print Label" className={printingLabel ? "disabled" : ""} onClick={(e) => { e.preventDefault(); if (printingLabel) return; setDocsMenuOpen(false); printPacketLabel(); }}>
                  <Icon name="box" /><span className="tx">{printingLabel ? "Preparing…" : "Print Label"}</span>
                </a>
                <a href="#" title="Print Slip" className={printingSlip ? "disabled" : ""} onClick={(e) => { e.preventDefault(); if (printingSlip) return; setDocsMenuOpen(false); printPledgeSlip(); }}>
                  <Icon name="doc" /><span className="tx">{printingSlip ? "Preparing…" : "Print Slip"}</span>
                </a>
                <a href="#" title="Print Slip + Label" className={printingSlipAndLabel ? "disabled" : ""} onClick={(e) => { e.preventDefault(); if (printingSlipAndLabel) return; setDocsMenuOpen(false); printSlipAndLabel(); }}>
                  <Icon name="doc" /><span className="tx">{printingSlipAndLabel ? "Preparing…" : "Print Slip + Label"}</span>
                </a>
                <a href="#" title="Statement" className={printingStatement ? "disabled" : ""} onClick={(e) => { e.preventDefault(); if (printingStatement) return; setDocsMenuOpen(false); printStatement(); }}>
                  <Icon name="doc" /><span className="tx">{printingStatement ? "Preparing…" : "Statement"}</span>
                </a>
                <a href="#" title="Print Bond" className={printingBond ? "disabled" : ""} onClick={(e) => { e.preventDefault(); if (printingBond) return; setDocsMenuOpen(false); openPrintBondLanguagePicker(); }}>
                  <Icon name="doc" /><span className="tx">{printingBond ? "Preparing…" : "Print Bond"}</span>
                </a>
              {l.status === "Closed" && (
                <>
                  <a href="#" title="Release Agreement (English)" className={printingReleaseAgreement ? "disabled" : ""} onClick={(e) => { e.preventDefault(); if (printingReleaseAgreement) return; setDocsMenuOpen(false); printReleaseAgreementDoc("en"); }}>
                    <Icon name="unlock" /><span className="tx">{printingReleaseAgreement ? "Preparing…" : "Release Agreement (English)"}</span>
                  </a>
                  <a href="#" title="Release Agreement (Malayalam)" className={printingReleaseAgreement ? "disabled" : ""} onClick={(e) => { e.preventDefault(); if (printingReleaseAgreement) return; setDocsMenuOpen(false); printReleaseAgreementDoc("ml"); }}>
                    <Icon name="unlock" /><span className="tx">{printingReleaseAgreement ? "Preparing…" : "Release Agreement (Malayalam)"}</span>
                  </a>
                </>
              )}
                {l.indemnityBondSignStatus === "sign_complete" && l.indemnityBondSignedUrl ? (
                  <a href={l.indemnityBondSignedUrl} title="Signed Bond" target="_blank" rel="noopener noreferrer" onClick={() => setDocsMenuOpen(false)}>
                    <Icon name="check" /><span className="tx">Signed Bond</span>
                  </a>
                ) : !canUpdateLoans ? null : esignStarted ? (
                  <a href="#" title="Check eSign Status" className={checkingEsign ? "disabled" : ""} onClick={(e) => { e.preventDefault(); if (checkingEsign) return; setDocsMenuOpen(false); checkIndemnityEsign(); }}>
                    <Icon name="doc" /><span className="tx">{checkingEsign ? "Checking…" : "Check eSign Status"}</span>
                  </a>
                ) : (
                  <a href="#" title="Send Indemnity Bond for eSign" className={esigning ? "disabled" : ""} onClick={(e) => { e.preventDefault(); if (esigning) return; setDocsMenuOpen(false); openEsignLanguagePicker(); }}>
                    <Icon name="doc" /><span className="tx">{esigning ? "Preparing…" : "Send Indemnity Bond for eSign"}</span>
                  </a>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
      {/* A loan sits in Closure Requested from the moment the release is
        * approved, but the gold can only be handed back once the final
        * settlement is actually paid — Complete Release stays disabled until
        * then. Without this banner the disabled button gave no on-screen
        * reason (only a hover title), which read as "the loan is closed but
        * stuck". */}
      {l.status === "Closure Requested" && l.totalOutstandingBalance > 0.01 && (
        <div className="notice" style={{ marginBottom: 14, color: "var(--amber)" }}>
          <Icon name="shield" /> Final settlement of {fmt(l.totalOutstandingBalance)} has not been recorded yet — record the payment before completing the release. The loan stays in Closure Requested until then.
        </div>
      )}
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

      <div className="grid cols12">
        <div className="grid">
          <div className="card gtop"><div className="hd"><h3>Financial Summary</h3></div>
            <div className="bd"><div className="kv" style={{ gridTemplateColumns: "1fr 1fr" }}>
              <div className="i"><div className="k">Principal</div><div className="v">{fmt(l.principal)}</div></div>
              <div className="i"><div className="k">Outstanding Principal</div><div className="v" style={{ color: "var(--brand-deep)", fontWeight: 600 }}>{fmt(l.outstanding)}</div></div>
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
                  {canUpdateBankPledges && (
                    <button className="btn ghost sm" style={{ marginTop: 12 }} disabled={releasing} onClick={doReleasePledge}>
                      {releasing ? "Releasing…" : "Release from Bank"}
                    </button>
                  )}
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
                <span style={{ fontWeight: 600 }}>Final settlement</span><b style={{ color: "var(--brand-deep)" }}>{fmt(l.settlementAmount)}</b></div>
            </div>
            <div className="ft">Principal + Interest + Penal Interest + Processing Fee − Payments/Waivers = Final Settlement Amount</div></div>
        </div>

        <div className="grid">
          <div className="card gtop"><div className="hd"><h3>Pledged Ornaments — {fmtW(l.totalNetWeight)} total</h3></div>
            <div className="tbl-wrap"><table className="tbl">
              <thead><tr><th>Ornament</th><th>Purity</th><th className="num" style={{ paddingRight: 18 }}>Gross (g)</th><th className="num">Net (g)</th><th className="num">Qty</th><th className="num">Gold Value</th><th style={{ textAlign: "center" }}>Photo</th></tr></thead>
              <tbody>
                {l.ornaments.map((o) => (
                  <tr key={o.id}>
                    <td>{o.name}</td><td><span className="chip brand">{o.purity}</span></td>
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
                        {p.type}
                        {p.processingFee > 0 && (
                          <div style={{ fontSize: "0.85em", color: "var(--red)" }}>+{fmt(p.processingFee)} fee charged</div>
                        )}
                        {breakdown && <div style={{ fontSize: "0.85em", color: "var(--muted)" }}>{breakdown}</div>}
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
            {/* <div className="ft">Running balance = outstanding principal + outstanding interest + outstanding penal interest, immediately after this entry</div> */}
            </div>

          {topUps.length > 0 && (
            <div className="card"><div className="hd"><h3>Top-Up History</h3></div>
              <div className="tbl-wrap"><table className="tbl">
                <thead><tr><th>Date</th><th className="num">Amount</th><th>Mode</th><th>Reference</th><th className="num">Eligible at Top-Up</th></tr></thead>
                <tbody>
                  {topUps.map((t) => {
                    const modeParts = [
                      t.cashAmount > 0 && `Cash ${fmt(t.cashAmount)}`,
                      t.upiAmount > 0 && `UPI ${fmt(t.upiAmount)}`,
                      t.bankTransferAmount > 0 && `Bank Transfer ${fmt(t.bankTransferAmount)}`,
                      t.chequeAmount > 0 && `Cheque ${fmt(t.chequeAmount)}`,
                    ].filter(Boolean).join(" · ");
                    return (
                      <tr key={t.id}>
                        <td>{t.occurredOn.slice(0, 10)}</td>
                        <td className="num" style={{ color: "var(--green)" }}>+{fmt(t.amount)}</td>
                        <td>{modeParts || "—"}</td>
                        <td>{t.reference || "—"}</td>
                        <td className="num">{fmt(t.eligibleAmountAtTopUp)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table></div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
