"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import { toDataURL } from "qrcode";
import { useDropdownMenu } from "@/product/hooks/useDropdownMenu";
import { useModal } from "@/product/components/Modal";
import { useToast } from "@/product/components/Toast";
import { useAuth, useApprovalWorkflow } from "@/product/providers/auth-context";
import {
  canActAtStage,
  chainFor,
  isFinalStage,
  nextStage,
  stageByPending,
  trackerLabels,
} from "@/product/services/approvalWorkflowService";
import { StatusChip } from "@/product/components/ui/StatusChip";
import { Icon } from "@/product/components/Icon";
import { fmt, fmtW, fmtDate, fmtDateTime, fmtToday } from "@/product/utils/format";
import { rupeesInWords } from "@/product/utils/numberToWords";
import { DatePicker } from "@/product/components/ui/DatePicker";
import { LedgerRefLink } from "@/product/components/ui/LedgerRefLink";
import { FooterTotals } from "@/product/components/ui/FooterTotals";
import { modeCellFor } from "@/product/pages/cash/components/ledgerCells";
import { ledgerFocusTarget, useLedgerFocus } from "@/product/hooks/useLedgerFocus";
import {
  getLoanByNumber,
  approveLoan,
  listTopUps,
  approveTopUp,
  type LoanTopUpView,
  getLoanLedger,
  type LoanLedgerEntry,
  type LoanLedgerPage,
  type AuctionRecordView,
  releaseBankPledge,
  completeRelease,
  startIndemnityBondEsign,
  checkIndemnityBondEsign,
  canAcceptBankPledge,
  downloadLoanStatement,
  hardDeleteLoan,
  downloadIndemnityBondPDF,
  downloadReleaseAgreementPDF,
  type LoanView,
} from "@/product/pages/loans/services/loanService";
import { getCustomer } from "@/product/pages/customers/services/customerService";
import { listPackets, type PacketView } from "@/product/pages/packets/services/packetService";
import { openPrintWindow, brandHeader } from "@/product/utils/print";
import { printColors, tenantLenderProfile } from "@/product/config/brand";
import type { BondLang } from "@/product/pages/loans/utils/indemnityBond";
import { StageTracker } from "@/product/components/ui/StageTracker";
import { ApiError } from "@/product/services/httpClient";
import { useLoans } from "@/product/pages/loans/store/LoansProvider";
import { PaymentModalContent } from "@/product/components/modals/PaymentModal";
import { RepledgeModalContent } from "@/product/components/modals/RepledgeModal";
import { ConfirmModalContent } from "@/product/components/modals/ConfirmModal";
import { EsignLanguageModalContent, type EsignDeliverBy } from "@/product/components/modals/EsignLanguageModal";
import { RequestExtensionModalContent, RequestReleaseModalContent } from "@/product/components/modals/RequestExtensionModal";
import { EditLoanModalContent } from "@/product/components/modals/EditLoanModal";
import { navigate, routeHref } from "@/product/services/appRoutes";
import { useCanOpenRoute } from "@/product/hooks/useCanOpenRoute";
import { DisburseLoanModalContent } from "@/product/components/modals/DisburseLoanModal";
import { useBalanceInHand } from "@/product/hooks/useBalanceInHand";
import { TopUpLoanModalContent } from "@/product/components/modals/TopUpLoanModal";
import { RejectRemarksModalContent } from "@/product/components/modals/RejectRemarksModal";
import { singleFlight } from "@/product/utils/singleFlight";

// Payment Ledger rows per page.
const LEDGER_PAGE_SIZE = 10;
// Pledged Ornaments / Pledge History rows per page.
const PLEDGE_PAGE_SIZE = 5;

/* Prev / Next footer under a table. Always rendered, even for a single page,
 * so every table on this page ends the same way. */
function PageBar({ page, total, pageSize, onChange, children }: { page: number; total: number; pageSize: number; onChange: (p: number) => void; children?: React.ReactNode }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <div className="ft ft-static" style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
      <button className="btn plain sm" disabled={page <= 1} onClick={() => onChange(Math.max(1, page - 1))}>‹ Prev</button>
      <span style={{ fontSize: 13 }}>Page {page} of {pages}</span>
      <button className="btn plain sm" disabled={page >= pages} onClick={() => onChange(Math.min(pages, page + 1))}>Next ›</button>
      {children}
    </div>
  );
}

/* An auction case's sale/expense breakdown, shown under its Payment Ledger
 * row (the backend ties each Auction Sale payment to its case). */
function auctionBreakdown(a: AuctionRecordView) {
  return `Sold ${fmt(a.saleAmount)} · Expenses ${fmt(a.auctionExpenses)} · Net ${fmt(a.saleAmount - a.auctionExpenses)}`;
}

/* The Payment Ledger note on one mode's row of a split payment/payout. */
function SplitPartNote({ part, total }: { part: { index: number; count: number }; total: number }) {
  return (
    <div style={{ fontSize: "0.85em", color: "var(--muted)" }}>
      Split {part.index + 1} of {part.count} · total {fmt(total)}
    </div>
  );
}

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
  // Links off this page only to pages the role can open.
  const canOpen = useCanOpenRoute();
  const toast = useToast();
  // Approving/paying/repledging updates this page's own `loan` state
  // directly from the API response, but Loans.tsx/Dashboard.tsx/
  // CustomerDetail.tsx/etc. all read the *shared* LoansProvider list —
  // without also refreshing that, those pages kept showing the
  // pre-change status until a full page reload re-fetched everything.
  const { refresh: refreshLoans } = useLoans();
  const { can, role, isAdmin } = useAuth();
  const canExport = can("Ledger_Export", "can_export_ledger");
  // Which sanction/top-up stages apply is per-business configuration — see
  // approvalWorkflowService.ts.
  const { config: workflow } = useApprovalWorkflow();
  // Every action on this page is hidden, not disabled, when the role lacks
  // the grant behind it (see Customers.tsx). The print/export buttons are
  // deliberately not gated — they only render what the viewer can already
  // see. Bank pledging is its own module, so it takes its own grants.
  const canUpdateLoans = can("Loan_Management", "can_update_loan");
  const canTopUpLoans = can("Loan_Management", "can_top_up_loan");
  const canCreateBankPledges = can("Bank_Pledge_Management", "can_create_bank_pledge");
  const canUpdateBankPledges = can("Bank_Pledge_Management", "can_update_bank_pledge");
  // Independent from "can_update_loan"/"can_delete_loan" — locking down the
  // irreversible full-cascade delete separately from ordinary edit/soft
  // delete rights is deliberate (see internal/authz/catalogue.go's own
  // comment on this permission).
  const canHardDeleteLoans = can("Loan_Management", "can_hard_delete_loan");

  const [loan, setLoan] = useState<LoanView | null>(null);
  const [topUps, setTopUps] = useState<LoanTopUpView[]>([]);
  // Bumped after a top-up is submitted/decided — a top-up submitted into the
  // loan_topup approval chain leaves the loan itself unchanged, so the
  // outstanding-keyed refetch below wouldn't notice it.
  const [topUpsVersion, setTopUpsVersion] = useState(0);
  const [decidingTopUp, setDecidingTopUp] = useState(false);
  // This loan's tracking packet — small, separate fetch (LoanView itself
  // carries no packet/locker info), used only to drive the "Gold Pledge /
  // Locker" release warning below.
  const [packet, setPacket] = useState<PacketView | null>(null);
  const [error, setError] = useState("");
  // Pledged Ornaments / Bank Pledge and Locker share one card, one tab at a time.
  const [pledgeTab, setPledgeTab] = useState<"ornaments" | "bank">("ornaments");
  const [ornamentsPage, setOrnamentsPage] = useState(1);
  const [pledgeHistoryPage, setPledgeHistoryPage] = useState(1);
  const [approving, setApproving] = useState(false);
  const [releasing, setReleasing] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [statementBusy, setStatementBusy] = useState(false);
  // Payment Ledger — filtered and paged by the backend (getLoanLedger), one
  // page held at a time. A date filter change goes back to page 1.
  const [ledgerFromDate, setLedgerFromDate] = useState("");
  const [ledgerToDate, setLedgerToDate] = useState("");
  const [ledgerExporting, setLedgerExporting] = useState(false);
  const [ledgerPage, setLedgerPage] = useState(1);
  const [ledger, setLedger] = useState<LoanLedgerPage | null>(null);
  const [ledgerError, setLedgerError] = useState(false);
  // Opened from (or back from) another ledger, the first fetch asks for the
  // page holding that row; the page it answers with is adopted, not refetched.
  const ledgerFocusPending = useRef(true);
  const ledgerAdoptedPage = useRef<number | null>(null);
  useLedgerFocus("loan-ledger", !!ledger, [ledger]);
  function setLedgerRange(from: string, to: string) {
    setLedgerFromDate(from);
    setLedgerToDate(to);
    setLedgerPage(1);
  }
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
  // the header back to "Send Bond for eSign" — leaving no way to
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
  }, [loan?.numericId, loan?.outstanding, topUpsVersion]);

  // Refetched whenever the loan reloads (after a payment, top-up, auction
  // step…) or a top-up is decided, as well as on a page/date-filter change.
  useEffect(() => {
    if (!loan) return;
    if (ledgerAdoptedPage.current === ledgerPage) {
      ledgerAdoptedPage.current = null;
      return;
    }
    ledgerAdoptedPage.current = null;
    const focus = ledgerFocusPending.current ? ledgerFocusTarget("loan-ledger") : null;
    let cancelled = false;
    getLoanLedger(loan.numericId, {
      from: ledgerFromDate || undefined,
      to: ledgerToDate || undefined,
      limit: LEDGER_PAGE_SIZE,
      offset: (ledgerPage - 1) * LEDGER_PAGE_SIZE,
      ...(focus ? ("key" in focus ? { focusKey: focus.key } : { focusDate: focus.date, focusAmount: focus.amount }) : {}),
    })
      .then((page) => {
        if (cancelled) return;
        // Cleared only once a response lands — dev StrictMode cancels the
        // first run, and the focus must survive into the second.
        ledgerFocusPending.current = false;
        setLedger(page);
        setLedgerError(false);
        // The server may answer with another page: the focused row's, or the
        // last real one after the history shrank.
        const served = Math.floor(page.offset / LEDGER_PAGE_SIZE) + 1;
        if (served !== ledgerPage) {
          ledgerAdoptedPage.current = served;
          setLedgerPage(served);
        }
      })
      .catch(() => {
        if (!cancelled) setLedgerError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [loan, topUpsVersion, ledgerFromDate, ledgerToDate, ledgerPage]);

  // Re-fetched whenever bankPledgeStatus/status change, e.g. right after a
  // locker check-in/out or the bank pledge being released — the "Gold
  // Pledge / Locker" warning below needs the packet's current stage to
  // stay in sync with those actions.
  useEffect(() => {
    if (!loan) return;
    listPackets({ loanId: loan.numericId }).then((ps) => setPacket(ps[0] ?? null)).catch(() => setPacket(null));
  }, [loan?.numericId, loan?.bankPledgeStatus, loan?.status]);

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

  // Branch Balance in Hand, fetched only while a sanction stage is pending —
  // the final stage's Approve & Disburse pays the principal out of it.
  const balanceInHand = useBalanceInHand(loan?.approvalStage || topUps.some((t) => t.status === "Pending") ? loan?.branchId : undefined);

  if (error) return <div className="empty">Loan not found — {error}</div>;
  if (!loan) return <div className="empty">Loading loan…</div>;
  const l = loan;
  // Closed (gold released) and Rejected (turned down in the sanction chain,
  // never disbursed) are both finished — nothing left to pay, extend,
  // release or edit.
  const isFinished = l.status === "Closed" || l.status === "Rejected";

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

  async function doApprove(stage: string, action: "Approved" | "Rejected" | "Verified") {
    setApproving(true);
    try {
      // The acting employee/role are derived server-side from the
      // logged-in user's JWT — never sent from here (see
      // loansApi.ts's ApprovalInput doc comment).
      const updated = await approveLoan(l.numericId, { stage, action });
      setLoan(updated);
      refreshLoans();
      // Name the stage the loan moved on to, from this business's own chain
      // (a stage may have been switched off, so it isn't always the next
      // one in the catalogue).
      const next = nextStage(workflow, "loan_sanction", stage);
      toast(
        action === "Rejected"
          ? "Rejected"
          : `${action === "Verified" ? "Verified" : "Approved"}${next ? ` — sent to ${next.label}` : ""}`
      );
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Could not record the decision — try again");
    } finally {
      setApproving(false);
    }
  }

  // The pending sanction stage, looked up in this business's configured
  // chain. stageByPending also maps the retired "AuthorizedManagement" 4th
  // stage to FinalSanction, so a loan fetched before the backend migrated it
  // still renders its pending stage instead of silently showing no buttons.
  // A loan parked on a stage that has since been switched off still finds
  // it here (and chainFor keeps it on the tracker) — it can still be acted
  // on there.
  const pendingStageView = stageByPending(workflow, "loan_sanction", l.approvalStage);
  const pendingStage = pendingStageView?.key ?? null;
  const sanctionChain = chainFor(workflow, "loan_sanction", l.approvalStage);
  const pendingStageIndex = pendingStage ? sanctionChain.findIndex((s) => s.key === pendingStage) : -1;
  // Each stage is one approver role from the business's configured chain
  // (Roles & Permissions → Approval Workflow); only that role or
  // Administrator may act at it. This mirrors the backend's real check
  // (workflow.Service.CanAct) so someone outside the flow doesn't see
  // clickable Approve/Reject buttons that would just 403; it's a UX nicety
  // only — the server enforces it regardless of what the client shows.
  const requiredRole = pendingStageView?.role ?? null;
  // A Loan Operator step is a verification, not a sanction — the operator
  // who made the loan confirms it and it moves on. So the affirmative
  // action there is "Verified", "Approved" elsewhere (the backend treats
  // both the same).
  const isVerifyStage = requiredRole === "Loan Operator";
  // The last ENABLED stage of the chain disburses — whichever one that is.
  const isDisburseStage = !!pendingStage && isFinalStage(workflow, "loan_sanction", pendingStage);
  // The stage permission (from the stage's own config entry) says whose
  // turn it is; "can update loan" says whether the viewer may act on loans
  // at all. Both must hold, or they see the "awaiting …" note instead of
  // clickable buttons.
  const canActOnStage = !!pendingStage && canUpdateLoans && canActAtStage({ role, isAdmin }, pendingStageView);

  // A top-up waiting in the loan_topup approval chain (only one per loan).
  // Pending/Rejected rows paid nothing out, so the ledger leaves them out.
  const pendingTopUp = topUps.find((t) => t.status === "Pending") ?? null;

  const ledgerEntries = ledger?.items ?? [];
  const ledgerTotal = ledger?.total ?? 0;
  const ledgerTotalPages = Math.max(1, Math.ceil(ledgerTotal / LEDGER_PAGE_SIZE));
  // The data-ledger-* attributes useLedgerFocus matches rows by.
  const ledgerRowAttrs = (e: LoanLedgerEntry) => ({
    "data-ledger-key": e.key,
    "data-ledger-date": e.date,
    "data-ledger-amount": e.amount,
  });
  const topUpStageView = pendingTopUp ? stageByPending(workflow, "loan_topup", pendingTopUp.approvalStage) : null;
  const topUpChain = pendingTopUp ? chainFor(workflow, "loan_topup", pendingTopUp.approvalStage) : [];
  const topUpStageIndex = topUpStageView ? topUpChain.findIndex((s) => s.key === topUpStageView.key) : topUpChain.length;
  const canActOnTopUp = canUpdateLoans && canActAtStage({ role, isAdmin }, topUpStageView);
  const topUpIsFinal = !!topUpStageView && isFinalStage(workflow, "loan_topup", topUpStageView.key);
  // The final top-up stage pays the amount out of the till. With "deduct",
  // outstanding interest comes off the payout (backend: amount − deducted),
  // so only the "require" case is checked here — the backend still enforces both.
  const topUpBlocked = topUpIsFinal && !!pendingTopUp && pendingTopUp.settleInterest !== "deduct" && balanceInHand !== null && pendingTopUp.amount > balanceInHand + 0.005;

  async function decideTopUp(action: "Approved" | "Rejected", remarks = "") {
    if (!pendingTopUp || !topUpStageView) return;
    setDecidingTopUp(true);
    try {
      const updated = await approveTopUp(pendingTopUp.id, { stage: topUpStageView.key, action, remarks: remarks || undefined });
      const next = nextStage(workflow, "loan_topup", topUpStageView.key);
      toast(
        action === "Rejected"
          ? "Top-up rejected"
          : updated.status === "Active"
            ? `Top-up approved — ${fmt(updated.amount)} disbursed`
            : `Top-up approved${next ? ` — sent to ${next.label}` : ""}`
      );
      setTopUpsVersion((v) => v + 1);
      load();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Could not record the decision — try again");
      // Rethrown so the reject prompt keeps itself open with the message.
      if (action === "Rejected") throw err;
    } finally {
      setDecidingTopUp(false);
    }
  }
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
  // The edit form picks a scheme and a purity standard, so it can only open
  // with both modules viewable — disabled with the reason rather than hidden.
  const editLoanBlocked = !can("Scheme_Management", "can_view_scheme_module")
    ? "Scheme module is disabled"
    : !can("Purity_Standard_Management", "can_view_purity_standard_module")
      ? "Purity standard module is disabled"
      : "";
  const editLoanButton = canUpdateLoans && !isFinished && l.status !== "Auctioned" ? (
    <button className="btn ghost" title={editLoanBlocked || undefined} disabled={!!editLoanBlocked} onClick={() => openModal(<EditLoanModalContent loan={l} onSaved={load} />, true)}>
      <Icon name="edit" /> Edit Loan
    </button>
  ) : null;

  // The final enabled stage's Approve/Verify is also the disbursement
  // moment (Service.Approve's disbursing branch) — collect the split-mode
  // breakdown via a modal instead of the earlier stages' plain one-click
  // Approve/Verify, which move no cash. DisburseLoanModal toasts itself.
  function onApproveClick() {
    if (!pendingStage) return;
    if (isDisburseStage) {
      openModal(
        <DisburseLoanModalContent
          loan={l}
          stage={pendingStage}
          onSaved={(updated) => { setLoan(updated); refreshLoans(); }}
        />
      );
      return;
    }
    doApprove(pendingStage, isVerifyStage ? "Verified" : "Approved");
  }

  // Not gated on balance in hand: the disburse modal always opens, shows the
  // balance, and disables its own Approve & Disburse until there's enough
  // cash (the backend's EnsureCashInHand enforces it too).
  const approvalButtons = pendingStage ? (
    canActOnStage ? (
      <>
        <button
          className="btn"
          disabled={approving}
          onClick={onApproveClick}
        >
          <Icon name="check" /> {isDisburseStage ? (isVerifyStage ? "Verify & Disburse" : "Approve & Disburse") : isVerifyStage ? "Verify" : "Approve"}
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

  // Was `!p.isReleased` — but isReleased is derived only from releaseDate
  // (see loanService.ts's toBankPledgeView), which a VOIDED pledge never
  // sets either (void cancels the entry, it isn't a release). That let a
  // voided record be picked up here as if it were still the active pledge.
  // `status` is the reliable field (Active/Released/Voided, always present,
  // DB-defaulted, never empty) — use that instead.
  const activePledge = l.bankPledges.find((p) => p.status === "Active");
  // Every pledge/release/repledge cycle this loan has ever had, most recent
  // first — the "which bank, when" trail item #14 asked for, distinct from
  // activePledge above (the one currently in effect, if any). Sorted
  // client-side since preloadAll's Pledges preload carries no ORDER BY.
  const pledgeHistory = [...l.bankPledges].sort((a, b) => b.pledgeDate.localeCompare(a.pledgeDate));

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

  async function onExportLedger() { return singleFlight("loan:ledger-export:"+l.numericId, async () => {
    if (!l) return;
    setLedgerExporting(true);
    try {
      await downloadLoanStatement(l.numericId);
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Could not export the ledger — try again.");
    } finally {
      setLedgerExporting(false);
    }
  }); }

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
  function printBond(lang: BondLang = "en") { void singleFlight("loan:print-bond:"+l.numericId+":"+lang, async () => {
    setPrintingBond(true);
    return downloadIndemnityBondPDF(l.numericId, lang)
      .catch(() => toast("Could not print the pledge agreement — try again."))
      .finally(() => setPrintingBond(false)); });
  }

  /* Inner markup only (no <html>/brand-window wrapper) — shared by
   * printPledgeSlip (its own print window) and printSlipAndLabel (combined
   * with the packet label below into one print job). Needs the customer
   * record the same way printPledgeSlip always has. */
  function pledgeSlipBodyHTML(c: { name: string; code?: string; id: string; phone?: string; address?: string }): string {
    return `
      ${brandHeader("Gold Loan Pledge Slip")}
      <table>
        <tr><th style="width:110px">Loan No</th><td>${l.id}</td><th style="width:110px">Date</th><td>${fmtToday()}</td></tr>
        <tr><th>Customer</th><td>${c.name} (${c.code || c.id})</td><th>Phone</th><td>${c.phone || "—"}</td></tr>
        <tr><th>Address</th><td>${c.address || "—"}</td><th>Branch</th><td>${l.branchName || "—"}</td></tr>
        <tr><th>Scheme</th><td>${l.schemeName} @ ${l.schemeRate}% p.a. (LTV ${l.schemeLtv}%)</td>
            <th>Opened</th><td>${fmtDate(l.opened)}</td></tr>
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
      ${amountDistributionHTML()}
      <div class="sig"><div><span>Customer Signature</span></div><div><span>Cashier</span></div><div><span>Branch Manager</span></div></div>`;
  }

  /* How the principal was advanced — the initial amount on the opening
   * date, then each later additional amount (paid-out top-ups), oldest
   * first. Empty when the loan was advanced in one go. */
  function amountDistributionHTML(): string {
    const extra = topUps.filter((t) => t.status === "Active")
      .sort((a, b) => a.occurredOn.localeCompare(b.occurredOn) || a.id - b.id);
    if (!extra.length) return "";
    const initial = Math.max(l.principal - extra.reduce((s, t) => s + t.amount, 0), 0);
    const rows = [
      `<tr><td>${fmtDate(l.opened)}</td><td>Initial loan amount</td><td class="num">${fmt(initial)}</td></tr>`,
      ...extra.map((t) => `<tr><td>${fmtDate(t.occurredOn)}</td><td>Additional loan amount</td><td class="num">${fmt(t.amount)}</td></tr>`),
    ].join("");
    return `<table>
        <thead><tr><th>Date</th><th>Amount Distribution</th><th class="num">Amount</th></tr></thead>
        <tbody>${rows}<tr><th colspan="2">Total</th><th class="num">${fmt(l.principal)}</th></tr></tbody>
      </table>`;
  }

  async function printPledgeSlip() { return singleFlight("loan:print-pledge-slip:"+l.numericId, async () => {
    setPrintingSlip(true);
    try {
      const c = await getCustomer(l.customerId);
      openPrintWindow("Pledge Slip — " + l.id, pledgeSlipBodyHTML(c), toast);
    } catch {
      toast("Could not load customer details — try again");
    } finally {
      setPrintingSlip(false);
    }
  }); }

  /* Release Agreement — only reachable once the loan has actually closed
   * (CompleteRelease already ran), same Documents dropdown as the other
   * prints. Server-rendered (GET /loans/:id/release-agreement/pdf) — see
   * downloadReleaseAgreementPDF's doc comment — so there's no more
   * client-side data assembly here, unlike the old printReleaseAgreement(). */
  async function printReleaseAgreementDoc(lang: "en" | "ml") { return singleFlight("loan:print-release-agreement:"+l.numericId+":"+lang, async () => {
    setPrintingReleaseAgreement(true);
    try {
      await downloadReleaseAgreementPDF(l.numericId, lang);
    } catch {
      toast("Could not generate the release agreement — try again");
    } finally {
      setPrintingReleaseAgreement(false);
    }
  }); }

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
  async function printStatement() { return singleFlight("loan:print-statement:"+l.numericId, async () => {
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
              <td>${fmtDate(p.paidOn)}</td>
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
          <tr><th style="width:150px">Loan No</th><td>${l.id}</td><th style="width:150px">Statement Date</th><td>${fmtToday()}</td></tr>
          <tr><th>Debtor Name</th><td colspan="3">${c.name}</td></tr>
          <tr><th>Debtor Address</th><td colspan="3">${c.address || "—"}</td></tr>
          <tr><th>Amount of Loan</th><td>${fmt(l.principal)}</td><th>Amount in Words</th><td>${rupeesInWords(l.principal)}</td></tr>
          <tr><th>Date of Loan</th><td>${fmtDate(l.opened)}</td><th>Date of Maturity</th><td>${fmtDate(l.due)}</td></tr>
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
  }); }

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
    // routeHref keeps the business slug, so a scanned label opens the right
    // organisation's app rather than a bare /app that has forgotten which
    // business the reader belongs to.
    const url = packet
      ? location.origin + routeHref(`packet/${packet.code}`)
      : location.origin + routeHref(`loan/${l.id}`);
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
        <div class="brand">${tenantLenderProfile().legalName.toUpperCase()}</div>
        <div class="id">${l.id} · ${packetLabel}</div>
        <div>${c.name || "—"}</div>
        <div>${c.code || c.id || "—"} · ${c.phone || ""}</div>
        <div>${fmtToday()} · ${l.totalNetWeight.toFixed(1)} g · ${l.ornaments.length} item(s)</div>
      </div>
    </div>`;
  }

  async function printPacketLabel() { return singleFlight("loan:print-label:"+l.numericId, async () => {
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
  }); }

  /* Combined "Print Slip + Label" — one print job, one A4 page: the slip's
   * own content followed directly by the label (a dashed rule separates the
   * two), NOT a hard page-break onto a second sheet. The label's native
   * stock is a 81mm×12mm die-cut tag, a different physical size from the
   * slip's A4, but at natural size it's small enough to sit comfortably
   * below the slip's table/signature block on a single A4 sheet — same
   * markup/CSS (labelStyle/labelBodyHTML) as the standalone label print,
   * just without the 81mm @page override. Order is slip then label, per the
   * print-format request this was added for. */
  async function printSlipAndLabel() { return singleFlight("loan:print-slip-label:"+l.numericId, async () => {
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
  }); }

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
        <div className="page-h-title"><h1>{l.id} {/* Defaulted is the more specific state — a defaulted loan's own
              l.status still reads "Overdue" backend-side, so without this
              guard the title showed both "Overdue" and "Defaulted" chips
              side by side for the same loan. */}
          {!l.isDefaulted && <StatusChip status={l.status} />}
          {l.isDefaulted && <StatusChip status="Defaulted" />}
          {/* A past-term loan whose interest is paid off comes back from the
              backend as "Active" (see refreshServicingStatus in
              loan/accrual.go). isOverdue stays true — the term really has
              expired — so suppress the duplicate chip here, or a serviced
              loan would read "Active" and "Overdue" at the same time. Also
              suppress when l.status is already "Overdue" itself, or the
              title would show two identical "Overdue" chips. */}
          {!l.isDefaulted && l.isOverdue && l.status !== "Active" && l.status !== "Overdue" && <StatusChip status="Overdue" />}
          {!l.isOverdue && l.isDueSoon && <StatusChip status="Due Soon" />}
          </h1>
        </div>
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
            !isFinished && canUpdateLoans && (
              <button className="btn" onClick={() => openModal(<PaymentModalContent loan={l} onSaved={load} />, true)}><Icon name="coin" /> Record Payment</button>
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
          {!approvalButtons && ((canAcceptBankPledge(l.status, l.bankPledgeStatus) && !activePledge && canCreateBankPledges) || (!isFinished && canUpdateLoans) || canHardDeleteLoans) && (
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
                    <a href="#" title="Repledge to Bank" onClick={(e) => { e.preventDefault(); setLoanActionsMenuOpen(false); openModal(<RepledgeModalContent loan={l} onSaved={load} />, true); }}>
                      <Icon name="bank" /><span className="tx">Repledge to Bank</span>
                    </a>
                  )}
                  {!isFinished && canUpdateLoans && (
                    <a href="#" title="Request Extension" onClick={(e) => { e.preventDefault(); setLoanActionsMenuOpen(false); openModal(<RequestExtensionModalContent loan={l} onSaved={load} />); }}>
                      <Icon name="clock" /><span className="tx">Request Extension</span>
                    </a>
                  )}
                  {!isFinished && canUpdateLoans && (
                    <a href="#" title="Request Release" onClick={(e) => { e.preventDefault(); setLoanActionsMenuOpen(false); openModal(<RequestReleaseModalContent loan={l} onSaved={load} />); }}>
                      <Icon name="unlock" /><span className="tx">Request Release</span>
                    </a>
                  )}
                {!isFinished && l.status !== "Auctioned" && canUpdateLoans && (
                  <a href="#" title={editLoanBlocked || "Edit Loan"} aria-disabled={!!editLoanBlocked} style={editLoanBlocked ? { opacity: 0.5, cursor: "not-allowed" } : undefined} onClick={(e) => { e.preventDefault(); if (editLoanBlocked) return; setLoanActionsMenuOpen(false); openModal(<EditLoanModalContent loan={l} onSaved={load} />, true); }}>
                    <Icon name="edit" /><span className="tx">Edit Loan</span>
                  </a>
                )}
                {l.status === "Active" && canTopUpLoans && (
                  <a href="#" title="Top Up Loan" onClick={(e) => { e.preventDefault(); setLoanActionsMenuOpen(false); openModal(<TopUpLoanModalContent loan={l} onSaved={() => { load(); setTopUpsVersion((v) => v + 1); }} />); }}>
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
                            navigate("loans");
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
                {canExport && (
                  <a href="#" title="Statement" className={printingStatement ? "disabled" : ""} onClick={(e) => { e.preventDefault(); if (printingStatement) return; setDocsMenuOpen(false); printStatement(); }}>
                    <Icon name="doc" /><span className="tx">{printingStatement ? "Preparing…" : "Statement"}</span>
                  </a>
                )}
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
                  <a href="#" title="Send Bond for eSign" className={esigning ? "disabled" : ""} onClick={(e) => { e.preventDefault(); if (esigning) return; setDocsMenuOpen(false); openEsignLanguagePicker(); }}>
                    <Icon name="doc" /><span className="tx">{esigning ? "Preparing…" : "Send Bond for eSign"}</span>
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
      {l.status === "Rejected" && (
        <div className="notice" style={{ marginBottom: 14, color: "var(--red)" }}>
          <Icon name="shield" /> Rejected{l.rejectedByName ? ` by ${l.rejectedByName}` : ""}
          {l.rejectedAt ? ` on ${fmtDate(l.rejectedAt)}` : ""}
          {l.rejectionRemarks ? ` — ${l.rejectionRemarks}` : ""}. This loan was never disbursed.
        </div>
      )}
      {pendingStage && (
        <div className="card" style={{ marginBottom: 14 }}>
          <div className="bd">
            <StageTracker
              stages={trackerLabels(workflow, "loan_sanction", sanctionChain)}
              currentIndex={pendingStageIndex}
            />
            {l.approvalWarning && (
              <div className="notice" style={{ marginTop: 10, color: "var(--amber)" }}><Icon name="shield" /> {l.approvalWarning}</div>
            )}
          </div>
        </div>
      )}
      {pendingTopUp && (
        <div className="card" style={{ marginBottom: 14 }}>
          <div className="hd">
            <h3>Top-up pending approval — {fmt(pendingTopUp.amount)}</h3>
            <div style={{ display: "flex", gap: 8 }}>
              {topUpStageView && canActOnTopUp ? (
                <>
                  <button
                    className="btn danger sm"
                    disabled={decidingTopUp}
                    onClick={() => openModal(<RejectRemarksModalContent title="Reject Top-up" required onConfirm={(remarks) => decideTopUp("Rejected", remarks)} />)}
                  >
                    Reject
                  </button>
                  <button
                    className="btn sm"
                    disabled={decidingTopUp || topUpBlocked}
                    title={topUpBlocked ? `Balance in hand ${fmt(balanceInHand!)} is lower than the ${fmt(pendingTopUp.amount)} to disburse — add cash first` : undefined}
                    onClick={() => decideTopUp("Approved")}
                  >
                    <Icon name="check" /> {topUpIsFinal ? "Approve & Disburse" : `Approve (${topUpStageView.label})`}
                  </button>
                </>
              ) : topUpStageView ? (
                <span style={{ color: "var(--muted)", fontSize: 13 }}>Awaiting {topUpStageView.role} approval</span>
              ) : null}
            </div>
          </div>
          <div className="bd">
            {topUpChain.length > 0 && (
              <StageTracker stages={trackerLabels(workflow, "loan_topup", topUpChain)} currentIndex={topUpStageIndex} />
            )}
            <p className="ccheck-hint" style={{ marginTop: 10 }}>
              Requested {fmtDate(pendingTopUp.createdAt)}
              {pendingTopUp.reference ? ` · Ref ${pendingTopUp.reference}` : ""}
              {pendingTopUp.settleInterest === "deduct" ? " · outstanding interest to be deducted from the payout" : ""}
              {" "}— nothing is paid out until the final stage approves it.
            </p>
          </div>
        </div>
      )}
      <hr className="gold-rule" />

      <div className="grid loan-detail-c3">
        <div className="card gtop"><div className="hd"><h3>Financial Summary</h3></div>
            <div className="bd"><div className="kv" style={{ gridTemplateColumns: "1fr 1fr 1fr" }}>
              <div className="i"><div className="k">Principal</div><div className="v">{fmt(l.principal)}</div></div>
              <div className="i"><div className="k">Remaining</div><div className="v" style={{ color: "var(--brand-deep)", fontWeight: 600 }}>{fmt(l.outstanding)}</div></div>
              {/* Nothing accrues until disbursement, so a pending loan would
                  read ₹0 here — show the monthly interest it will carry instead. */}
              {l.disbursementDate
                ? <div className="i"><div className="k">Interest</div><div className="v">{fmt(l.accruedInterest)}</div></div>
                : <div className="i"><div className="k">Interest / Month</div><div className="v">{fmt((l.principal * l.schemeRate) / 100 / 12)}</div></div>}
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
              
              <div className="i"><div className="k">Penal Rate</div><div className="v">{l.schemePenal != null ? l.schemePenal + "% p.a." : "—"}</div></div>
              <div className="i"><div className="k">Interest Method</div><div className="v">{l.schemeMethod}</div></div>
            </div></div></div>

        <div className="card gtop"><div className="hd"><h3>Settlement Preview</h3></div>
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

        <div className="card gtop"><div className="hd"><h3>Loan Details</h3></div>
            <div className="bd"><div className="kv" style={{ gridTemplateColumns: "1fr 1fr" }}>
              <div className="i" style={{ gridColumn: "1 / -1" }}><div className="k">Customer</div><div className="v">{canOpen("customer") ? <a href={routeHref(`customer/${l.customerId}`)} style={{ fontWeight: 600 }}>{l.customerName}</a> : l.customerName}</div></div>
              <div className="i"><div className="k">Gold Scheme</div><div className="v">{l.schemeName}</div></div>
              <div className="i"><div className="k">Branch</div><div className="v">{l.branchName || "—"}</div></div>
              <div className="i"><div className="k">Opening Date</div><div className="v">{fmtDate(l.opened)}</div></div>
              <div className="i"><div className="k">Due Date</div><div className="v" style={l.isOverdue ? { color: "var(--red)" } : undefined}>{fmtDate(l.due)}{l.isOverdue ? ` · ${l.daysOverdue}d overdue` : ""}</div></div>
            </div></div></div>
      </div>

      <div className="card gtop ld-card" style={{ marginTop: 16 }}>
            <div className="hd">
              <h3>Payment Ledger</h3>
              <div className="sp" />
              <DatePicker value={ledgerFromDate} onChange={(v) => setLedgerRange(v, ledgerToDate)} placeholder="From…" max={ledgerToDate || undefined} />
              <DatePicker value={ledgerToDate} onChange={(v) => setLedgerRange(ledgerFromDate, v)} placeholder="To…" min={ledgerFromDate || undefined} />
              {(ledgerFromDate || ledgerToDate) && (
                <button className="btn ghost sm" onClick={() => setLedgerRange("", "")}>Clear</button>
              )}
              {canExport && <button className="btn ghost sm" disabled={ledgerExporting} onClick={onExportLedger}><Icon name="download" /> {ledgerExporting ? "Exporting…" : "Download"}</button>}
            </div>
            <div className="tbl-wrap"><table className="tbl ledger-nowrap ledger-amt" data-ledger-scope="loan-ledger" data-ledger-page={ledgerPage}>
              <thead><tr><th>Date</th><th>Ref No</th><th>Particulars</th><th>Method</th><th className="num">Debit</th><th className="num">Credit</th><th className="num">Balance</th></tr></thead>
              <tbody>
                {ledgerError ? (
                  <tr><td colSpan={7} className="empty">Couldn&apos;t load the ledger — refresh the page to try again.</td></tr>
                ) : !ledger ? (
                  <tr><td colSpan={7} className="empty">Loading ledger…</td></tr>
                ) : ledgerEntries.length === 0 ? (
                  <tr><td colSpan={7} className="empty">{ledgerFromDate || ledgerToDate ? "No ledger entries in this date range." : "No ledger entries yet."}</td></tr>
                ) : (
                  ledgerEntries.map((entry) => {
                      if (entry.kind === "sanction") {
                        const part = entry.part;
                        return (
                          <tr key={entry.key} {...ledgerRowAttrs(entry)}>
                            <td>{fmtDate(entry.date)}</td>
                            <td>{l.loanNumber}</td>
                            <td>
                              Loan Sanctioned
                              {part && <SplitPartNote part={part} total={l.disbursedAmount} />}
                              {(!part || part.index === 0) && l.sanctionedAmount !== l.disbursedAmount && (
                                <div style={{ fontSize: "0.85em", color: "var(--muted)" }}>
                                  Sanctioned {fmt(l.sanctionedAmount)} · ₹{fmt(l.sanctionedAmount - l.disbursedAmount)} withheld as service charge
                                </div>
                              )}
                            </td>
                            <td>{modeCellFor(part ? part.mode : entry.payment?.method)}</td>
                            <td className="num" style={{ color: "var(--red)" }}>{fmt(part ? part.amount : l.disbursedAmount)}</td>
                            <td className="num">—</td>
                            <td className="num">{fmt(entry.balance)}</td>
                          </tr>
                        );
                      }

                      if (entry.kind === "auction-sale") {
                        const a = entry.row;
                        return (
                          <tr key={entry.key} {...ledgerRowAttrs(entry)}>
                            <td>{fmtDate(entry.date)}</td>
                            <td>{a.auctionReferenceNumber || "—"}</td>
                            <td>
                              Auction Sale
                              <div style={{ fontSize: "0.85em", color: "var(--muted)" }}>{auctionBreakdown(a)}</div>
                            </td>
                            <td>Auction</td>
                            <td className="num">—</td>
                            <td className="num">—</td>
                            <td className="num">—</td>
                          </tr>
                        );
                      }

                      if (entry.kind === "auction-surplus") {
                        const a = entry.row;
                        const refunded = a.surplusDisposition === "RefundedToCustomer";
                        const note = refunded ? "Refunded to customer"
                          : a.surplusDisposition === "RecordedAsIncome" ? "Retained as income — no cash paid out"
                          : "Payable to customer — awaiting settlement";
                        return (
                          <tr key={entry.key} {...ledgerRowAttrs(entry)}>
                            <td>{fmtDate(entry.date)}</td>
                            <td>{a.auctionReferenceNumber || "—"}</td>
                            <td>
                              Auction Surplus {fmt(a.surplusPayableAmount)}
                              <div style={{ fontSize: "0.85em", color: "var(--muted)" }}>{note}</div>
                            </td>
                            <td>{refunded ? "—" : <span style={{ color: "var(--muted)" }}>Non-cash</span>}</td>
                            <td className="num" style={{ color: refunded ? "var(--red)" : undefined }}>{refunded ? fmt(a.surplusPayableAmount) : "—"}</td>
                            <td className="num">—</td>
                            <td className="num">—</td>
                          </tr>
                        );
                      }

                      if (entry.kind === "topup") {
                        const t = entry.row;
                        const part = entry.part;
                        // Each mode links to its own ledger, same as every other row.
                        const modeParts = part ? [[part.mode, 0] as const] : ([
                          ["Cash", t.cashAmount],
                          ["UPI", t.upiAmount],
                          ["Bank Transfer", t.bankTransferAmount],
                          ["Cheque", t.chequeAmount],
                        ] as const).filter(([, v]) => v > 0);
                        return (
                          <tr key={entry.key} {...ledgerRowAttrs(entry)}>
                            <td>{fmtDate(entry.date)}</td>
                            <td>{t.reference || "—"}</td>
                            <td>
                              Loan Top-Up
                              {part && <SplitPartNote part={part} total={t.amount} />}
                              {(!part || part.index === 0) && (
                                <div style={{ fontSize: "0.85em", color: "var(--muted)" }}>Eligible at top-up {fmt(t.eligibleAmountAtTopUp)}</div>
                              )}
                            </td>
                            <td>
                              {modeParts.length === 0 ? "—" : modeParts.map(([m, v], i) => (
                                <Fragment key={m}>{i > 0 && " · "}{modeCellFor(m)}{v > 0 && ` ${fmt(v)}`}</Fragment>
                              ))}
                            </td>
                            <td className="num" style={{ color: "var(--red)" }}>{fmt(part ? part.amount : t.amount)}</td>
                            <td className="num">—</td>
                            <td className="num">{fmt(entry.balance)}</td>
                          </tr>
                        );
                      }

                      const p = entry.row;
                      const part = entry.part;
                      // The allocation breakdown is the whole payment's —
                      // shown once, on its first part.
                      const firstPart = !part || part.index === 0;
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
                        <tr key={entry.key} {...ledgerRowAttrs(entry)}>
                          <td>{fmtDate(p.paidOn)}</td>
                          <td>{p.reference || "—"}</td>
                          <td>
                            {p.type}
                            {part && <SplitPartNote part={part} total={p.amount} />}
                            {firstPart && p.processingFee > 0 && (
                              <div style={{ fontSize: "0.85em", color: "var(--red)" }}>+{fmt(p.processingFee)} fee charged</div>
                            )}
                            {firstPart && p.type === "Auction Sale" && (() => {
                              const a = entry.auction;
                              return a ? <div style={{ fontSize: "0.85em", color: "var(--muted)" }}>{auctionBreakdown(a)}</div> : null;
                            })()}
                            {firstPart && breakdown && <div style={{ fontSize: "0.85em", color: "var(--muted)" }}>{breakdown}</div>}
                            {p.bankId && part?.mode !== "Cash" && (
                              <div style={{ marginTop: 4 }}>
                                <LedgerRefLink kind="bank" id={p.bankId} label={p.bankName || "Bank"} />
                              </div>
                            )}
                          </td>
                          <td>{isCash ? modeCellFor(part?.mode || p.method) : <span style={{ color: "var(--muted)" }}>Non-cash</span>}</td>
                          <td className="num">—</td>
                          <td className="num" style={{ color: "var(--green)" }}>{fmt(part ? part.amount : p.amount)}</td>
                          <td className="num">{fmt(entry.balance)}</td>
                        </tr>
                      );
                    })
                )}
              </tbody>
            </table></div>
            <PageBar page={ledgerPage} total={ledgerTotal} pageSize={LEDGER_PAGE_SIZE} onChange={setLedgerPage}>
              <FooterTotals aligned items={[
                { value: ledger?.totalDebit ?? 0, color: "var(--red)" },
                { value: ledger?.totalCredit ?? 0, color: "var(--green)" },
              ]} />
            </PageBar>
            {/* <div className="ft">Running balance = outstanding principal + outstanding interest + outstanding penal interest, immediately after this entry</div> */}
            </div>
      <div className="card gtop ld-card" style={{ marginTop: 16 }}>
            <div className="hd">
              <div className="tabs" style={{ border: 0, padding: "4px 8px 10px 4px", margin: 0 }}>
                <button className={pledgeTab === "ornaments" ? "on" : ""} onClick={() => setPledgeTab("ornaments")}>Pledged Ornaments</button>
                <button className={pledgeTab === "bank" ? "on" : ""} onClick={() => setPledgeTab("bank")}>Bank Pledge and Locker</button>
              </div>
              <div className="sp" />
              {pledgeTab === "ornaments" && <span className="chip brand">{l.ornaments.length} item{l.ornaments.length === 1 ? "" : "s"} · {fmtW(l.totalNetWeight)} net</span>}
            </div>
            {pledgeTab === "ornaments" && (
            <div className="tbl-wrap"><table className="tbl">
              <thead><tr><th>Ornament</th><th>Purity</th><th className="num">Qty</th><th className="num">Gross</th><th className="num">Net</th><th className="num">Gold Value</th><th>Photo</th><th>Status</th></tr></thead>
              <tbody>
                {l.ornaments.slice((ornamentsPage - 1) * PLEDGE_PAGE_SIZE, ornamentsPage * PLEDGE_PAGE_SIZE).map((o) => (
                  <tr key={o.id}>
                    <td>{o.name}</td>
                    <td><span className="chip brand">{o.purity}</span></td>
                    <td className="num">{o.quantity}</td>
                    <td className="num">{o.grossWeight.toFixed(1)} g</td>
                    <td className="num">{o.netWeight.toFixed(1)} g</td>
                    <td className="num">{fmt(o.goldValue)}</td>
                    <td>
                      {o.photoUrl ? (
                        <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <img src={o.photoUrl} style={{ width: 34, height: 34, objectFit: "cover", borderRadius: 6, border: "1px solid var(--line)", cursor: "pointer" }} title="View photo" onClick={() => viewOrnImg(o.photoUrl!, o.name)} />
                          <button className="btn plain sm" style={{ padding: "4px 8px" }} onClick={() => viewOrnImg(o.photoUrl!, o.name)}>View</button>
                        </span>
                      ) : (
                        <span style={{ color: "var(--muted)" }}>—</span>
                      )}
                    </td>
                    <td>{o.releasedAt ? <span className="chip" style={{ color: "var(--green, #1a7f37)" }} title={`Released on ${fmtDateTime(o.releasedAt)}`}>Released {fmtDate(o.releasedAt)}</span> : <span className="chip">Held</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table></div>
            )}
            {pledgeTab === "ornaments" && (
              <PageBar page={ornamentsPage} total={l.ornaments.length} pageSize={PLEDGE_PAGE_SIZE} onChange={setOrnamentsPage} />
            )}
            {pledgeTab === "bank" && (
            <div className="bd">
              {activePledge ? (
                <>
                  <div className="kv" style={{ gridTemplateColumns: "1fr 1fr" }}>
                    <div className="i"><div className="k">Bank</div><div className="v">{activePledge.bankName}</div></div>
                    <div className="i"><div className="k">Pledged On</div><div className="v">{fmtDate(activePledge.pledgeDate)}</div></div>
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
                  {/* One combined warning names everything still standing between
                    * this loan and closure — the bank pledge, and a locker if the
                    * gold is also checked into one (see CompleteRelease's guards
                    * on the backend) — instead of leaving staff to guess why
                    * "Complete Release" won't go through. */}
                  <div className="notice" style={{ marginTop: 12 }}>
                    <Icon name="shield" />
                    {" Closure requires releasing this bank pledge first"}
                    {packet?.status === "Locker Stored" ? ", and checking the gold out of its locker." : "."}
                  </div>
                  {canUpdateBankPledges && (
                    <button className="btn ghost sm" style={{ marginTop: 12 }} disabled={releasing} onClick={doReleasePledge}>
                      {releasing ? "Releasing…" : "Release from Bank"}
                    </button>
                  )}
                  {packet?.status === "Locker Stored" && canOpen("packet") && (
                    <a className="btn ghost sm" style={{ marginTop: 12, marginLeft: 8, display: "inline-flex" }} href={routeHref(`packet/${packet.code}`)}>
                      Go to Packet
                    </a>
                  )}
                </>
              ) : (
                <>
                  <p style={{ fontSize: 13.5, color: "var(--muted)" }}>
                    Gold is {l.bankPledgeStatus === "Released" ? "released to customer" : "held in-house"} — <StatusChip status={l.bankPledgeStatus} />
                  </p>
                  {packet?.status === "Locker Stored" && (
                    <>
                      {l.totalOutstandingBalance <= 0.01 ? (
                        <div className="notice" style={{ color: "var(--red)", marginTop: 12 }}>
                          <Icon name="shield" /> This loan is fully paid, but its gold is still checked into a locker — check it out before this loan can be closed.
                        </div>
                      ) : (
                        <p style={{ fontSize: 13.5, color: "var(--muted)", marginTop: 8 }}>Gold is currently held in a locker.</p>
                      )}
                      {canOpen("packet") && (
                        <a className="btn ghost sm" style={{ marginTop: 12, display: "inline-flex" }} href={routeHref(`packet/${packet.code}`)}>
                          Go to Packet
                        </a>
                      )}
                    </>
                  )}
                </>
              )}
              {/* Folded into this same Bank Pledge and Locker card rather
                * than a separate one — the history is every past pledge/
                * release/repledge cycle for this loan, which reads more
                * naturally right below the current pledge status than as
                * its own standalone card. */}
              {pledgeHistory.length > 0 && (
                <>
                  <h4 style={{ marginTop: 16, marginBottom: 8, fontSize: 13 }}>Pledge History</h4>
                  <div className="tbl-wrap">
                    <table className="tbl">
                      <thead>
                        <tr><th>Bank</th><th>Pledged On</th><th>Released On</th><th className="num">Amount</th><th>Status</th></tr>
                      </thead>
                      <tbody>
                        {pledgeHistory.slice((pledgeHistoryPage - 1) * PLEDGE_PAGE_SIZE, pledgeHistoryPage * PLEDGE_PAGE_SIZE).map((p) => (
                          <tr key={p.id}>
                            <td>{p.bankName}</td>
                            <td>{fmtDate(p.pledgeDate)}</td>
                            <td>{fmtDate(p.releaseDate)}</td>
                            <td className="num">{fmt(p.pledgedAmount)}</td>
                            <td>
                              {/* Wire value stays "Voided" (backend status), only the displayed label is "Deleted" — see
                                * BankPledge.tsx's own comment on this same relabel (item #13). */}
                              <StatusChip status={p.status === "Voided" ? "Deleted" : p.status} />
                              {p.status === "Voided" && p.voidReason && (
                                <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>{p.voidReason}</div>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <PageBar page={pledgeHistoryPage} total={pledgeHistory.length} pageSize={PLEDGE_PAGE_SIZE} onChange={setPledgeHistoryPage} />
                </>
              )}
            </div>
            )}
      </div>
    </>
  );
}
