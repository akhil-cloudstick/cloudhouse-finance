"use client";

import { FilterPanel, type FilterCategory, type FilterValue } from "@/common/components/ui/FilterPanel";
import { usePersistedState } from "@/common/hooks/use-persisted-state";
import { Fragment, useEffect, useRef, useState } from "react";
import { toDataURL } from "qrcode";
import { useDropdownMenu } from "@/common/hooks/use-dropdown-menu";
import { useModal } from "@/common/components/ModalProvider";
import { SafeImage } from "@/common/components/ui/SafeImage";
import { OrnamentPhotoSlider } from "@/modules/loans/components/OrnamentPhotoSlider";
import { useToast } from "@/common/components/ToastProvider";
import { useAuth, useApprovalWorkflow } from "@/common/providers/AuthProvider";
import {
  canActAtStage,
  chainFor,
  isFinalStage,
  nextStage,
  stageByPending,
  trackerLabels,
} from "@/common/services/approvalWorkflowService";
import { StatusChip } from "@/common/components/ui/StatusChip";
import { Icon } from "@/common/components/Icon";
import { fmt, fmtW, fmtDate, fmtDateTime, fmtToday } from "@/common/utils/format";
import { rupeesInWords } from "@/common/utils/numberToWords";
import { LedgerRefLink } from "@/common/components/LedgerRefLink";
import { FooterTotals } from "@/common/components/ui/FooterTotals";
import { modeCellFor } from "@/modules/cash/utils/ledgerCells";
import { ledgerFocusTarget, useLedgerFocus } from "@/common/hooks/use-ledger-focus";
import { getLoanByNumber, approveLoan, listTopUps, approveTopUp, getLoanLedger, releaseBankPledge, completeRelease, startIndemnityBondEsign, checkIndemnityBondEsign, canAcceptBankPledge, downloadLoanStatement, hardDeleteLoan, downloadIndemnityBondPDF, downloadTmlStatementReceipt, downloadPledgeSlipPDF, fetchPledgeSlipParts, downloadReleaseAgreementPDF, startPledgeSlipEsign, checkPledgeSlipEsign } from "@/modules/loans/services/loanService";
import { type LoanTopUpView, type LoanLedgerEntry, type LoanLedgerPage, type AuctionRecordView, type LoanView, type EsignWitnessInput } from "@/modules/loans/types/loan-types";
import { getCustomer } from "@/modules/customers/services/customerService";
import { listPackets } from "@/modules/packets/services/packetService";
import { type PacketView } from "@/modules/packets/types/packet-types";
import { openPrintWindow, brandHeader, canPrintInline, downloadBlob } from "@/common/utils/print";
import { printColors, tenantLenderProfile } from "@/common/config/brand";
import type { BondLang } from "@/modules/loans/utils/indemnityBond";
import { StageTracker } from "@/common/components/StageTracker";
import { ApiError } from "@/common/services/httpClient";
import { useBranding } from "@/common/providers/BrandingProvider";
import { useLoans } from "@/modules/loans/store/LoansProvider";
import { PaymentModalContent } from "@/common/components/modals/PaymentModalContent";
import { RepledgeModalContent } from "@/common/components/modals/RepledgeModalContent";
import { ConfirmModalContent } from "@/common/components/modals/ConfirmModalContent";
import { ReleasePledgeModalContent } from "@/modules/loans/components/ReleasePledgeModalContent";
import { EsignLanguageModalContent, type EsignDeliverBy } from "@/modules/loans/components/EsignLanguageModalContent";
import { fetchUploadFile } from "@/common/services/uploadService";
import { EsignStatusModalContent,type EsignStatusSigner } from "@/modules/loans/components/EsignStatusModalContent";
import { PledgeSlipModalContent } from "@/modules/loans/components/PledgeSlipModalContent";
import { RequestExtensionModalContent } from "@/common/components/modals/RequestExtensionModalContent";
import { RequestReleaseModalContent } from "@/common/components/modals/RequestReleaseModalContent";
import { EditLoanModalContent } from "@/modules/loans/components/EditLoanModalContent";
import { navigate, routeHref } from "@/common/services/appRoutes";
import { useCanOpenRoute } from "@/common/hooks/use-can-open-route";
import { DisburseLoanModalContent } from "@/modules/loans/components/DisburseLoanModalContent";
import { useBalanceInHand } from "@/common/hooks/use-balance-in-hand";
import { TopUpLoanModalContent } from "@/modules/loans/components/TopUpLoanModalContent";
import { RejectRemarksModalContent } from "@/common/components/modals/RejectRemarksModalContent";
import { singleFlight } from "@/common/utils/singleFlight";
import { useShowBranch } from "@/common/hooks/use-branch-switch";
import { PageBar } from "@/modules/loans/components/PageBar";
import { SplitPartNote } from "@/modules/loans/components/SplitPartNote";

// Payment Ledger rows per page.
const LEDGER_PAGE_SIZE = 10;
// Pledged Ornaments / Pledge History rows per page.
const PLEDGE_PAGE_SIZE = 5;

function auctionBreakdown(a: AuctionRecordView) {
  return `Sold ${fmt(a.saleAmount)} · Expenses ${fmt(a.auctionExpenses)} · Net ${fmt(a.saleAmount - a.auctionExpenses)}`;
}

type LoanDetailPageProps = { id?: string };

export function LoanDetailPage({ id }: LoanDetailPageProps) {
  const { openModal, closeModal } = useModal();
  const canOpen = useCanOpenRoute();
  const showBranch = useShowBranch();
  const toast = useToast();
  // Also refreshes the shared LoansProvider list so other pages don't show the pre-change status.
  const { refresh: refreshLoans } = useLoans();
  const { can, role, isSystem } = useAuth();
  const { policy } = useBranding();
  const canExport = can("Ledger_Export", "can_export_ledger");
  const { config: workflow } = useApprovalWorkflow();
  // Every action on this page is hidden, not disabled, when the role lacks the grant behind it.
  const canUpdateLoans = can("Loan_Management", "can_update_loan");
  const canTopUpLoans = can("Loan_Management", "can_top_up_loan");
  const canCreateBankPledges = can("Bank_Pledge_Management", "can_create_bank_pledge");
  const canUpdateBankPledges = can("Bank_Pledge_Management", "can_update_bank_pledge");
  // Independent from "can_update_loan"/"can_delete_loan" — the irreversible full-cascade delete is its own grant.
  const canHardDeleteLoans = can("Loan_Management", "can_hard_delete_loan");
  const canViewPackets = can("Packet_Management", "can_view_packet_module");

  const [loan, setLoan] = useState<LoanView | null>(null);
  const [topUps, setTopUps] = useState<LoanTopUpView[]>([]);
  // Bumped after a top-up is submitted/decided — a pending top-up leaves the loan itself unchanged.
  const [topUpsVersion, setTopUpsVersion] = useState(0);
  const [decidingTopUp, setDecidingTopUp] = useState(false);
  const [packet, setPacket] = useState<PacketView | null>(null);
  const [error, setError] = useState("");
  const [pledgeTab, setPledgeTab] = useState<"ornaments" | "bank">("ornaments");
  const [ornamentsPage, setOrnamentsPage] = useState(1);
  const [pledgeHistoryPage, setPledgeHistoryPage] = useState(1);
  const [approving, setApproving] = useState(false);
  const [releasing, setReleasing] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [statementBusy, setStatementBusy] = useState(false);
  const [ledgerFilters, setLedgerFilters] = usePersistedState<FilterValue>("loan-ledger:filters", {});
  const ledgerFromDate = ledgerFilters.__dateFrom || "";
  const ledgerToDate = ledgerFilters.__dateTo || "";
  const ledgerKinds = Array.isArray(ledgerFilters.kind) ? ledgerFilters.kind : [];
  const ledgerCategories: FilterCategory[] = [
    {
      key: "kind", label: "Type", kind: "static",
      options: [
        { value: "sanction", label: "Sanction" },
        { value: "payment", label: "Payment" },
        { value: "topup", label: "Top-Up" },
        { value: "interest", label: "Interest" },
        { value: "penal", label: "Penal Interest" },
        { value: "service-charge", label: "Service Charge" },
        { value: "auction", label: "Auction" },
      ],
    },
    { key: "__date", label: "Date", kind: "date" },
  ];
  const [ledgerExporting, setLedgerExporting] = useState(false);
  const [ledgerPage, setLedgerPage] = useState(1);
  const [ledger, setLedger] = useState<LoanLedgerPage | null>(null);
  const [ledgerError, setLedgerError] = useState(false);
  // Opened from another ledger, the first fetch asks for the page holding that row, adopted not refetched.
  const ledgerFocusPending = useRef(true);
  const ledgerAdoptedPage = useRef<number | null>(null);
  useLedgerFocus("loan-ledger", !!ledger, [ledger]);
  useEffect(() => { setLedgerPage(1); }, [ledgerFromDate, ledgerToDate, JSON.stringify(ledgerKinds)]);
  const [printingLabel, setPrintingLabel] = useState(false);
  const [printingSlip, setPrintingSlip] = useState(false);
  const [printingSlipAndLabel, setPrintingSlipAndLabel] = useState(false);
  const [printingBond, setPrintingBond] = useState(false);
  const [printingStatement, setPrintingStatement] = useState(false);
  const [printingReleaseAgreement, setPrintingReleaseAgreement] = useState(false);
  // "started" means the eSign URL was sent and we're waiting for Aadhaar+OTP, so "Check Status" replaces "Send".
  const [esigning, setEsigning] = useState(false);
  const [esignStarted, setEsignStarted] = useState(false);
  // Kept separate from the bond's eSign state because the two documents are signed independently.
  const [slipEsignStarted, setSlipEsignStarted] = useState(false);
  const bondSignersRef = useRef<EsignStatusSigner[]>([]);
  const slipSignersRef = useRef<EsignStatusSigner[]>([]);
  const {
    open: docsMenuOpen,
    setOpen: setDocsMenuOpen,
    menuRef: docsMenuRef,
    triggerRef: docsMenuTriggerRef,
    onKeyDown: onDocsMenuKeyDown,
  } = useDropdownMenu<HTMLDivElement>();
  const [slipSubOpen, setSlipSubOpen] = useState(false);
  const [bondSubOpen, setBondSubOpen] = useState(false);
  const {
    open: loanActionsMenuOpen,
    setOpen: setLoanActionsMenuOpen,
    menuRef: loanActionsMenuRef,
    triggerRef: loanActionsMenuTriggerRef,
    onKeyDown: onLoanActionsMenuKeyDown,
  } = useDropdownMenu<HTMLDivElement>();
  // Seeded from the loan's own Setu status so reloading mid-signing doesn't lose the in-flight request.
  useEffect(() => {
    if (loan?.indemnityBondSignStatus === "sign_initiated") setEsignStarted(true);
  }, [loan?.indemnityBondSignStatus]);
  useEffect(() => {
    if (loan?.pledgeSlipSignStatus === "sign_initiated") setSlipEsignStarted(true);
  }, [loan?.pledgeSlipSignStatus]);
  function load(isBackgroundRefresh = false) {
    if (!id) return;
    getLoanByNumber(id)
      .then(setLoan)
      .catch((e) => {
        // The 20s background poll shares this function but must never blank a page already showing a valid loan.
        if (isBackgroundRefresh) return;
        setError(e instanceof Error ? e.message : "Failed to load loan.");
      });
    refreshLoans();
  }

  useEffect(() => {
    setLoan(null);
    setError("");
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => {
    if (!loan) return;
    listTopUps(loan.numericId).then(setTopUps).catch(() => setTopUps([]));
  }, [loan?.numericId, loan?.outstanding, topUpsVersion]);

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
      kinds: ledgerKinds.length ? ledgerKinds : undefined,
      limit: LEDGER_PAGE_SIZE,
      offset: (ledgerPage - 1) * LEDGER_PAGE_SIZE,
      ...(focus ? ("key" in focus ? { focusKey: focus.key } : { focusDate: focus.date, focusAmount: focus.amount }) : {}),
    })
      .then((page) => {
        if (cancelled) return;
        // Cleared only once a response lands — dev StrictMode cancels the first run; focus must survive into the second.
        ledgerFocusPending.current = false;
        setLedger(page);
        setLedgerError(false);
        // The server may answer with another page: the focused row's, or the last real one after history shrank.
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loan, topUpsVersion, ledgerFromDate, ledgerToDate, JSON.stringify(ledgerKinds), ledgerPage]);

  // Keeps the packet's stage in sync so the "Gold Pledge / Locker" warning below reflects recent actions.
  useEffect(() => {
    if (!loan || !canViewPackets) return;
    listPackets({ loanId: loan.numericId }).then((ps) => setPacket(ps[0] ?? null)).catch(() => setPacket(null));
  }, [loan?.numericId, loan?.bankPledgeStatus, loan?.status, canViewPackets]);

  // 20s poll so another approver with this loan open sees a stage change without a real-time channel.
  useEffect(() => {
    if (!id) return;
    const timer = setInterval(() => load(true), 20000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // Fetched only while a sanction stage is pending — the final stage's Approve & Disburse pays out of it.
  const balanceInHand = useBalanceInHand(loan?.approvalStage || topUps.some((t) => t.status === "Pending") ? loan?.branchId : undefined);

  if (error) return <div className="empty">Loan not found — {error}</div>;
  if (!loan) return <div className="empty">Loading loan…</div>;
  const l = loan;
  const isFinished = l.status === "Closed" || l.status === "Rejected";

  function viewOrnImg(urls: string[], name: string) {
    openModal(<OrnamentPhotoSlider title={`${name} — ${l.id}`} urls={urls} onClose={closeModal} />, true);
  }

  async function doApprove(stage: string, action: "Approved" | "Rejected" | "Verified") {
    setApproving(true);
    try {
      const updated = await approveLoan(l.numericId, { stage, action });
      setLoan(updated);
      refreshLoans();
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

  // stageByPending also maps the retired "AuthorizedManagement" 4th stage to FinalSanction for pre-migration loans.
  const pendingStageView = stageByPending(workflow, "loan_sanction", l.approvalStage);
  const pendingStage = pendingStageView?.key ?? null;
  const sanctionChain = chainFor(workflow, "loan_sanction", l.approvalStage);
  const pendingStageIndex = pendingStage ? sanctionChain.findIndex((s) => s.key === pendingStage) : -1;
  // UX nicety only — the server (workflow.Service.CanAct) enforces this regardless of what the client shows.
  const requiredRole = pendingStageView?.role ?? null;
  // A Loan Operator step is a verification, not a sanction — "Verified" instead of "Approved" (backend treats both the same).
  const isVerifyStage = requiredRole === "Loan Operator";
  const isDisburseStage = !!pendingStage && isFinalStage(workflow, "loan_sanction", pendingStage);
  const canActOnStage = !!pendingStage && canUpdateLoans && canActAtStage({ role, isSystem }, pendingStageView);

  // Pending/Rejected rows paid nothing out, so the ledger leaves them out.
  const pendingTopUp = topUps.find((t) => t.status === "Pending") ?? null;

  const ledgerEntries = ledger?.items ?? [];
  const ledgerTotal = ledger?.total ?? 0;
  const ledgerTotalPages = Math.max(1, Math.ceil(ledgerTotal / LEDGER_PAGE_SIZE));
  const ledgerRowAttrs = (e: LoanLedgerEntry) => ({
    "data-ledger-key": e.key,
    "data-ledger-date": e.date,
    "data-ledger-amount": e.amount,
  });
  const topUpStageView = pendingTopUp ? stageByPending(workflow, "loan_topup", pendingTopUp.approvalStage) : null;
  const topUpChain = pendingTopUp ? chainFor(workflow, "loan_topup", pendingTopUp.approvalStage) : [];
  const topUpStageIndex = topUpStageView ? topUpChain.findIndex((s) => s.key === topUpStageView.key) : topUpChain.length;
  const canActOnTopUp = canUpdateLoans && canActAtStage({ role, isSystem }, topUpStageView);
  const topUpIsFinal = !!topUpStageView && isFinalStage(workflow, "loan_topup", topUpStageView.key);
  // Only the "require" case is checked here; "deduct" takes interest off the payout instead (backend enforces both).
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
  // Edit Loan is reachable during sanction review too, not just once Active — gated by plain "can update loan".
  // The edit form picks a scheme and a purity standard, so it can only open with both modules viewable.
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

  // The final stage's Approve/Verify is also the disbursement moment, so it collects the split-mode breakdown via a modal.
  function onApproveClick() {
    if (!pendingStage) return;
    if (isDisburseStage) {
      openModal(
        <DisburseLoanModalContent
          loan={l}
          stage={pendingStage}
          onSaved={(updated) => { setLoan(updated); refreshLoans(); }}
        />,
        true
      );
      return;
    }
    doApprove(pendingStage, isVerifyStage ? "Verified" : "Approved");
  }

  // Not gated on balance in hand: the disburse modal always opens and disables its own button until there's enough cash.
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

  // `status` is used instead of `!p.isReleased` since a VOIDED pledge never sets releaseDate either.
  const activePledge = l.bankPledges.find((p) => p.status === "Active");
  // Sorted client-side since preloadAll's Pledges preload carries no ORDER BY.
  const pledgeHistory = [...l.bankPledges].sort((a, b) => b.pledgeDate.localeCompare(a.pledgeDate));

  // Confirms first: releasing moves cash (for a CashIn pledge) and changes where the gold physically sits.
  function doReleasePledge() {
    if (!activePledge) return;
    const p = activePledge;
    openModal(
      <ReleasePledgeModalContent
        bankName={p.bankName}
        amount={p.pledgedAmount}
        cashTreatment={p.cashTreatment}
        onConfirm={async (payment) => {
          setReleasing(true);
          try {
            await releaseBankPledge(l.numericId, p.id, payment);
            toast("Bank pledge released");
            load();
          } finally {
            setReleasing(false);
          }
        }}
      />
    );
  }

  // Disabled while running: a double-click could hand the customer two documents differing by seconds of interest.
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
    // Checked client-side first with clear wording, since a plain `disabled` button gives no feedback on click.
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
      await completeRelease(l.numericId);
      toast("Gold released to customer — loan closed");
      load();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Could not complete the release — try again");
    } finally {
      setCompleting(false);
    }
  }

  // Paper copy for offline wet-ink signing, independent of the Aadhaar eSign status.
  function printBond(lang: BondLang = "en") { void singleFlight("loan:print-bond:"+l.numericId+":"+lang, async () => {
    setPrintingBond(true);
    return downloadIndemnityBondPDF(l.numericId, lang)
      .catch(() => toast("Could not print the pledge agreement — try again."))
      .finally(() => setPrintingBond(false)); });
  }

  async function printPledgeSlip() { return singleFlight("loan:print-pledge-slip:"+l.numericId, async () => {
    setPrintingSlip(true);
    return downloadPledgeSlipPDF(l.numericId)
      .catch(() => toast("Could not print the pledge slip — try again."))
      .finally(() => setPrintingSlip(false));
  }); }

  // Only reachable once the loan has actually closed (CompleteRelease already ran).
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

  // Formal Statement of Account carrying the statutory particulars a moneylender's statement must show.
  async function printStatement() { return singleFlight("loan:print-statement:"+l.numericId, async () => {
    setPrintingStatement(true);
    if (policy === "tml") {
      // TML businesses print the server-rendered payment receipt instead.
      try {
        await downloadTmlStatementReceipt(l.numericId);
      } catch (e) {
        toast(e instanceof ApiError ? e.message : "Could not print the statement — try again.");
      } finally {
        setPrintingStatement(false);
      }
      return;
    }
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

  // Shared by printPacketLabel and printSlipAndLabel. Returns null (after toasting) on QR failure.
  async function packetLabelData(): Promise<{ c: Awaited<ReturnType<typeof getCustomer>>; packetLabel: string; url: string; qr: string } | null> {
    const [c, packets] = await Promise.all([
      getCustomer(l.customerId),
      canViewPackets ? listPackets({ loanId: l.numericId }).catch(() => []) : [],
    ]);
    const packet = packets[0];
    const packetLabel = packet?.code || "PKT-" + l.numericId;
    // routeHref keeps the business slug so a scanned label opens the right organisation's app.
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

  // Shared by printPacketLabel and printSlipAndLabel, as one source of truth so the two never drift apart.
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
      // Die-cut "flag tag" stock: 81mm total, first 28mm holds the QR, the rest the readable identifiers.
      const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Packet Label — ${l.id}</title><style>
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
      </body></html>`;
      // Phones/tablets can't print from a popup — give the user the label as a file instead.
      if (!canPrintInline()) {
        downloadBlob(new Blob([html], { type: "text/html" }), `packet-label-${l.id}.html`);
        return;
      }
      const w = window.open("", "_blank");
      if (!w) { toast("Popup blocked — please allow popups for this site to print"); return; }
      w.document.write(html);
      w.document.close();
      w.addEventListener("afterprint", () => w.close());
      setTimeout(() => { try { w.focus(); w.print(); } catch { /* ignore */ } }, 400);
    } catch {
      toast("Could not load customer details — try again");
    } finally {
      setPrintingLabel(false);
    }
  }); }

  // One print job, one A4 page: slip content followed by the label (dashed rule between), no page-break.
  async function printSlipAndLabel() { return singleFlight("loan:print-slip-label:"+l.numericId, async () => {
    setPrintingSlipAndLabel(true);
    try {
      const [slip, data] = await Promise.all([fetchPledgeSlipParts(l.numericId), packetLabelData()]);
      if (!data) return;
      openPrintWindow(
        "Pledge Slip + Label — " + l.id,
        `<style>${slip.style}</style>${slip.body}
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

  // Additional path alongside the print-and-sign-by-hand buttons, not a replacement — the wet-signature route stays.
  async function startIndemnityEsign(lang: BondLang, deliverBy: EsignDeliverBy = "whatsapp", witnesses?: EsignWitnessInput[]) {
    setEsigning(true);
    try {
      const redirectUrl = `${window.location.origin}/esign-callback`;
      const started = await startIndemnityBondEsign(l.numericId, lang, redirectUrl, deliverBy, witnesses);
      // Nothing opens by itself: in link mode staff open each signer's link from the status modal.
      const signers: EsignStatusSigner[] = (started.signers ?? []).map((s, i) => ({
        label: i === 0 ? "Customer" : `Witness ${i}`,
        name: s.displayName,
        url: deliverBy === "open" ? s.url : undefined,
      }));
      bondSignersRef.current = signers;
      setEsignStarted(true);
      toast(deliverBy === "whatsapp"
        ? "Pledge agreement eSign links sent via WhatsApp."
        : "eSign links are ready — open each signer's link from the next window.");
      // Deferred: the picker modal calls closeModal() right after onConfirm resolves, which would close this one.
      setTimeout(openBondStatus, 0);
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Could not start indemnity bond eSign.");
    } finally {
      setEsigning(false);
    }
  }

  // Customer's phone for the WhatsApp delivery option; the modals still work without it.
  async function customerPhoneForEsign(): Promise<string | undefined> {
    try {
      return (await getCustomer(l.customerId)).phone;
    } catch {
      return undefined;
    }
  }

  function openBondPrintPicker() {
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

  // Fetched with the session token — a plain link to /uploads/… relies on a cookie missing after a restored session.
  async function openSignedDocument(url: string) {
    const w = window.open("", "_blank");
    if (!w) { toast("Popup blocked — please allow popups for this site to view the document"); return; }
    try {
      const res = await fetchUploadFile(url);
      if (!res.ok) throw new Error(String(res.status));
      w.location.href = URL.createObjectURL(await res.blob());
    } catch {
      w.close();
      toast("Could not open the signed document — try again");
    }
  }

  const signedSlipReady = l.pledgeSlipSignStatus === "sign_complete" && !!l.pledgeSlipSignedUrl;
  const signedBondReady = l.indemnityBondSignStatus === "sign_complete" && !!l.indemnityBondSignedUrl;

  async function alreadySigned(doc: "bond" | "slip"): Promise<boolean> {
    try {
      const fresh = await getLoanByNumber(l.id);
      setLoan(fresh);
      const status = doc === "bond" ? fresh.indemnityBondSignStatus : fresh.pledgeSlipSignStatus;
      if (status === "sign_complete") {
        toast(`This loan's ${doc === "bond" ? "pledge agreement" : "pledge slip"} is already signed — see "Signed ${doc === "bond" ? "Bond" : "Slip"}" in Documents.`);
        return true;
      }
    } catch { /* server still guards the request */ }
    return false;
  }

  async function openBondEsignPicker() {
    if (await alreadySigned("bond")) return;
    const phone = await customerPhoneForEsign();
    openModal(
      <EsignLanguageModalContent
        loanNumber={l.id}
        customerName={l.customerName}
        customerPhone={phone}
        title="Pledge Agreement eSign"
        showDelivery
        showWitnesses
        onConfirm={(lang, deliverBy, witnesses) => startIndemnityEsign(lang, deliverBy, witnesses)}
      />
    );
  }

  // GML only: the slip can be printed normally or sent to the customer to eSign.
  async function startSlipEsign(deliverBy: EsignDeliverBy) {
    const started = await startPledgeSlipEsign(l.numericId, `${window.location.origin}/esign-callback`, deliverBy);
    slipSignersRef.current = [{ label: "Customer", name: l.customerName, url: deliverBy === "open" ? started.url : undefined }];
    setSlipEsignStarted(true);
    toast(deliverBy === "open"
      ? "eSign link is ready — open it from the next window."
      : "Pledge slip eSign link sent to the customer via WhatsApp.");
    setTimeout(openSlipStatus, 0);
  }

  // Status windows: one row per signer, flipping to Verified as each completes their Aadhaar eSign.
  function openBondStatus() {
    openModal(
      <EsignStatusModalContent
        title="Pledge Agreement eSign"
        loanNumber={l.id}
        signers={bondSignersRef.current.length ? bondSignersRef.current : [{ label: "Customer" }]}
        check={() => checkIndemnityBondEsign(l.numericId)}
        onComplete={() => { setEsignStarted(false); load(); toast("Pledge agreement signed successfully."); }}
        onFailed={() => setEsignStarted(false)}
      />
    );
  }

  function openSlipStatus() {
    openModal(
      <EsignStatusModalContent
        title="Pledge Slip eSign"
        loanNumber={l.id}
        signers={slipSignersRef.current.length ? slipSignersRef.current : [{ label: "Customer" }]}
        check={() => checkPledgeSlipEsign(l.numericId)}
        onComplete={() => { setSlipEsignStarted(false); load(); toast("Pledge slip signed successfully."); }}
        onFailed={() => setSlipEsignStarted(false)}
      />
    );
  }

  async function openPledgeSlipPicker() {
    if (await alreadySigned("slip")) return;
    const phone = await customerPhoneForEsign();
    openModal(
      <PledgeSlipModalContent
        loanNumber={l.id}
        customerName={l.customerName}
        customerPhone={phone}
        onEsign={startSlipEsign}
      />
    );
  }

  return (
    <>
      <div className="page-h">
        <div className="page-h-title"><h1>{l.id} {/* Defaulted is more specific — avoids showing both "Overdue" and "Defaulted" for the same loan. */}
          {!l.isDefaulted && <StatusChip status={l.status} />}
          {l.isDefaulted && <StatusChip status="Defaulted" />}
          {/* A serviced past-term loan comes back "Active" with isOverdue still true — suppress the duplicate chip. */}
          {!l.isDefaulted && l.isOverdue && l.status !== "Active" && l.status !== "Overdue" && <StatusChip status="Overdue" />}
          {!l.isOverdue && l.isDueSoon && <StatusChip status="Due Soon" />}
          </h1>
        </div>
        {/* .page-h-actions wraps as one group with justify-content:flex-end so a wrapped button stays right-aligned. */}
        <div className="page-h-actions">
          {approvalButtons ? approvalButtons : (
            !isFinished && canUpdateLoans && (
              <button className="btn" onClick={() => openModal(<PaymentModalContent loan={l} onSaved={load} />, true)}><Icon name="coin" /> Record Payment</button>
            )
          )}
          {l.status === "Closure Requested" && canUpdateLoans && (
            // The settlement/pledge gates are enforced (and explained via toast) by doCompleteRelease itself.
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
                {/* Deliberately the ONLY delete action here — no separate soft-delete alternative, by product decision. */}
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
                              extension/release requests, auctions, bank pledges, packets, reminders, and
                              all of its ledger (cash &amp; bank) entries.
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
          <div className="docs-dd" ref={docsMenuRef} onKeyDown={onDocsMenuKeyDown}>
            <button
            ref={docsMenuTriggerRef}
            className="btn ghost"
            onClick={() => { setSlipSubOpen(false); setBondSubOpen(false); setDocsMenuOpen((v) => !v); }}
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
                {policy === "gml" && (signedSlipReady || canUpdateLoans) ? (
                  <div className="docs-dd-sub">
                    <a href="#" title="Print Slip" aria-haspopup="menu" aria-expanded={slipSubOpen} className={printingSlip ? "disabled" : ""} onClick={(e) => { e.preventDefault(); e.stopPropagation(); if (printingSlip) return; setBondSubOpen(false); setSlipSubOpen((v) => !v); }}>
                      <Icon name="doc" /><span className="tx">{printingSlip ? "Preparing…" : "Print Slip"}</span>
                      <Icon name="chevronDown" className="docs-dd-sub-chev" />
                    </a>
                    {slipSubOpen && (
                      <div className="docs-dd-submenu" role="menu">
                        <a href="#" onClick={(e) => { e.preventDefault(); setSlipSubOpen(false); setDocsMenuOpen(false); void printPledgeSlip(); }}>
                          <span className="tx">Normal print</span>
                        </a>
                        {signedSlipReady ? (
                          <a href="#" onClick={(e) => { e.preventDefault(); setSlipSubOpen(false); setDocsMenuOpen(false); void openSignedDocument(l.pledgeSlipSignedUrl); }}>
                            <span className="tx">Signed slip</span>
                          </a>
                        ) : slipEsignStarted ? (
                          <a href="#" onClick={(e) => { e.preventDefault(); setSlipSubOpen(false); setDocsMenuOpen(false); openSlipStatus(); }}>
                            <span className="tx">eSign status</span>
                          </a>
                        ) : (
                          <a href="#" onClick={(e) => { e.preventDefault(); setSlipSubOpen(false); setDocsMenuOpen(false); void openPledgeSlipPicker(); }}>
                            <span className="tx">eSign (Aadhaar)</span>
                          </a>
                        )}
                      </div>
                    )}
                  </div>
                ) : (
                  <a href="#" title="Print Slip" className={printingSlip ? "disabled" : ""} onClick={(e) => { e.preventDefault(); if (printingSlip) return; setDocsMenuOpen(false); void printPledgeSlip(); }}>
                    <Icon name="doc" /><span className="tx">{printingSlip ? "Preparing…" : "Print Slip"}</span>
                  </a>
                )}
                <a href="#" title="Print Slip + Label" className={printingSlipAndLabel ? "disabled" : ""} onClick={(e) => { e.preventDefault(); if (printingSlipAndLabel) return; setDocsMenuOpen(false); printSlipAndLabel(); }}>
                  <Icon name="doc" /><span className="tx">{printingSlipAndLabel ? "Preparing…" : "Print Slip + Label"}</span>
                </a>
                {canExport && (
                  <a href="#" title="Statement" className={printingStatement ? "disabled" : ""} onClick={(e) => { e.preventDefault(); if (printingStatement) return; setDocsMenuOpen(false); printStatement(); }}>
                    <Icon name="doc" /><span className="tx">{printingStatement ? "Preparing…" : "Statement"}</span>
                  </a>
                )}
                {signedBondReady || canUpdateLoans ? (
                  <div className="docs-dd-sub">
                    <a href="#" title="Print Bond" aria-haspopup="menu" aria-expanded={bondSubOpen} className={printingBond ? "disabled" : ""} onClick={(e) => { e.preventDefault(); e.stopPropagation(); if (printingBond) return; setSlipSubOpen(false); setBondSubOpen((v) => !v); }}>
                      <Icon name="doc" /><span className="tx">{printingBond ? "Preparing…" : "Print Bond"}</span>
                      <Icon name="chevronDown" className="docs-dd-sub-chev" />
                    </a>
                    {bondSubOpen && (
                      <div className="docs-dd-submenu" role="menu">
                        <a href="#" onClick={(e) => { e.preventDefault(); setBondSubOpen(false); setDocsMenuOpen(false); openBondPrintPicker(); }}>
                          <span className="tx">Normal print</span>
                        </a>
                        {signedBondReady ? (
                          <a href="#" onClick={(e) => { e.preventDefault(); setBondSubOpen(false); setDocsMenuOpen(false); void openSignedDocument(l.indemnityBondSignedUrl); }}>
                            <span className="tx">Signed bond</span>
                          </a>
                        ) : esignStarted ? (
                          <a href="#" onClick={(e) => { e.preventDefault(); setBondSubOpen(false); setDocsMenuOpen(false); openBondStatus(); }}>
                            <span className="tx">eSign status</span>
                          </a>
                        ) : (
                          <a href="#" onClick={(e) => { e.preventDefault(); setBondSubOpen(false); setDocsMenuOpen(false); void openBondEsignPicker(); }}>
                            <span className="tx">eSign (Aadhaar)</span>
                          </a>
                        )}
                      </div>
                    )}
                  </div>
                ) : (
                  <a href="#" title="Print Bond" className={printingBond ? "disabled" : ""} onClick={(e) => { e.preventDefault(); if (printingBond) return; setDocsMenuOpen(false); openBondPrintPicker(); }}>
                    <Icon name="doc" /><span className="tx">{printingBond ? "Preparing…" : "Print Bond"}</span>
                  </a>
                )}
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
              </div>
            )}
          </div>
        </div>
      </div>
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
            <div className="bd"><div className="kv">
              <div className="i"><div className="k">Principal</div><div className="v">{fmt(l.principal)}</div></div>
              {l.serviceChargeAmount > 0 && <>
                <div className="i"><div className="k">Service Charge</div><div className="v">{fmt(l.serviceChargeAmount)}</div></div>
                <div className="i"><div className="k">Charge Mode</div><div className="v">{l.serviceChargeMode === "WithheldFromPayout" ? "Deducted from payout" : "Added to principal"}</div></div>
                {l.serviceChargeMode === "WithheldFromPayout" && (
                  <div className="i"><div className="k">Net Payout</div><div className="v">{fmt(l.principal - l.serviceChargeAmount)}</div></div>
                )}
              </>}
              <div className="i"><div className="k">Remaining</div><div className="v" style={{ color: "var(--brand-deep)", fontWeight: 600 }}>{fmt(l.outstanding)}</div></div>
              {/* Nothing accrues until disbursement, so show the monthly interest a pending loan will carry instead. */}
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
              <div className="i" style={showBranch ? undefined : { gridColumn: "1 / -1" }}><div className="k">Gold Scheme</div><div className="v">{l.schemeName}</div></div>
              {showBranch && <div className="i"><div className="k">Branch</div><div className="v">{l.branchName || "—"}</div></div>}
              <div className="i"><div className="k">Opening Date</div><div className="v">{fmtDate(l.opened)}</div></div>
              <div className="i"><div className="k">Due Date</div><div className="v" style={l.isOverdue ? { color: "var(--red)" } : undefined}>{fmtDate(l.due)}{l.isOverdue ? ` · ${l.daysOverdue}d overdue` : ""}</div></div>
              {l.overallPhotoUrl && (
                <div className="i" style={{ gridColumn: "1 / -1" }}>
                  <div className="k">Overall Photo</div>
                  <div className="v">
                    <SafeImage src={l.overallPhotoUrl} style={{ width: "100%", maxHeight: 150, objectFit: "cover", borderRadius: 8, border: "1px solid var(--line)", cursor: "pointer" }} title="View overall photo" alt="Overall photo of pledged ornaments" onClick={() => viewOrnImg([l.overallPhotoUrl], "Overall photo")} />
                  </div>
                </div>
              )}
            </div></div></div>
      </div>

      <div className="card gtop ld-card" style={{ marginTop: 16 }}>
            <div className="hd">
              <h3>Payment Ledger</h3>
              <div className="sp" />
              <FilterPanel categories={ledgerCategories} value={ledgerFilters} onChange={setLedgerFilters} hideChips hideClearAll />
              {canExport && <button className="btn ghost sm" disabled={ledgerExporting} onClick={onExportLedger}><Icon name="download" /> {ledgerExporting ? "Exporting…" : "Download"}</button>}
            </div>
            <div className="tbl-wrap"><table className="tbl tbl-center ledger-nowrap ledger-amt" data-ledger-scope="loan-ledger" data-ledger-page={ledgerPage}>
              <thead><tr><th>Date</th><th>Ref No</th><th>Particulars</th><th>Method</th><th className="num">Debit</th><th className="num">Credit</th><th className="num">Balance</th></tr></thead>
              <tbody>
                {ledgerError ? (
                  <tr><td colSpan={7} className="empty">Couldn&apos;t load the ledger — refresh the page to try again.</td></tr>
                ) : !ledger ? (
                  <tr><td colSpan={7} className="empty">Loading ledger…</td></tr>
                ) : ledgerEntries.length === 0 ? (
                  <tr><td colSpan={7} className="empty">{ledgerFromDate || ledgerToDate || ledgerKinds.length ? "No ledger entries match these filters." : "No ledger entries yet."}</td></tr>
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

                      if (entry.kind === "interest" || entry.kind === "penal" || entry.kind === "service-charge") {
                        const penal = entry.kind === "penal";
                        return (
                          <tr key={entry.key} {...ledgerRowAttrs(entry)}>
                            <td>{fmtDate(entry.date)}</td>
                            <td>{l.loanNumber}</td>
                            <td>{entry.kind === "service-charge" ? "Service Charge" : penal ? (entry.accruing ? "Penal Interest" : "Penal Interest Charged") : (entry.accruing ? "Interest" : "Interest Charged")}</td>
                            <td>—</td>
                            <td className="num" style={{ color: "var(--red)" }}>{fmt(entry.amount)}</td>
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
                      // The allocation breakdown is the whole payment's — shown once, on its first part.
                      const firstPart = !part || part.index === 0;
                      const component = entry.component;
                      // Adjustment can go either way; shown as credit since today's only use reduces principal.
                      const isCash = p.type !== "Adjustment" && p.type !== "Waiver";
                      // A newly-charged fee (p.processingFee) is noted separately — it's not part of what Amount paid down.
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
                            {component ? `${component} — ${p.type}` : p.type}
                            {part && <SplitPartNote part={part} total={p.amount} />}
                            {firstPart && p.processingFee > 0 && (
                              <div style={{ fontSize: "0.85em", color: "var(--red)" }}>+{fmt(p.processingFee)} fee charged</div>
                            )}
                            {firstPart && p.type === "Auction Sale" && (() => {
                              const a = entry.auction;
                              return a ? <div style={{ fontSize: "0.85em", color: "var(--muted)" }}>{auctionBreakdown(a)}</div> : null;
                            })()}
                            {firstPart && !component && breakdown && <div style={{ fontSize: "0.85em", color: "var(--muted)" }}>{breakdown}</div>}
                            {p.bankId && part?.mode !== "Cash" && (
                              <div style={{ marginTop: 4 }}>
                                <LedgerRefLink kind="bank" id={p.bankId} label={p.bankName || "Bank"} />
                              </div>
                            )}
                          </td>
                          <td>{isCash ? modeCellFor(entry.mode || part?.mode || p.method) : <span style={{ color: "var(--muted)" }}>Non-cash</span>}</td>
                          <td className="num">—</td>
                          <td className="num" style={{ color: "var(--green)" }}>{fmt(part ? part.amount : component ? entry.amount : p.amount)}</td>
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
                    <td className="num">{o.grossWeight.toFixed(3)} g</td>
                    <td className="num">{o.netWeight.toFixed(3)} g</td>
                    <td className="num">{fmt(o.goldValue)}</td>
                    <td>
                      {o.photoUrl ? (
                        <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <SafeImage src={o.photoUrl} style={{ width: 34, height: 34, objectFit: "cover", borderRadius: 6, border: "1px solid var(--line)", cursor: "pointer" }} title={o.photoUrls.length > 1 ? `View all ${o.photoUrls.length} photos` : "View photo"} onClick={() => viewOrnImg(o.photoUrls, o.name)} />
                          <button className="btn plain sm" style={{ padding: "4px 8px" }} onClick={() => viewOrnImg(o.photoUrls, o.name)}>{o.photoUrls.length > 1 ? `View all (${o.photoUrls.length})` : "View"}</button>
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
                    <div className="i"><div className="k">Cash Treatment</div><div className="v">
                      {activePledge.cashTreatment === "CashIn" ? "Added to Cash-in-Hand" : "Record only — no cash effect"}
                    </div></div>
                    <div className="i"><div className="k">Status</div><div className="v"><StatusChip status="Bank Pledged" /></div></div>
                  </div>
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
                              {/* Wire value stays "Voided"; only the displayed label is "Deleted". */}
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
