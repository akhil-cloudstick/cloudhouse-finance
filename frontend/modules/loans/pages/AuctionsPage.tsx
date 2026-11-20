  "use client";

import { TableCols } from "@/common/components/ui/TableCols";
import { TableSearch } from "@/common/components/ui/TableSearch";
import { TruncText } from "@/common/components/ui/TruncText";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { usePersistedPage, usePersistedState, useResetPageOnChange } from "@/common/hooks/use-persisted-state";
import { useModal } from "@/common/components/ModalProvider";
import { useToast } from "@/common/components/ToastProvider";
import { useLoans } from "@/modules/loans/store/LoansProvider";
import { Icon } from "@/common/components/Icon";
import { fmt, fmtW, fmtDate } from "@/common/utils/format";
import { StatusChip } from "@/common/components/ui/StatusChip";
import { StageTracker } from "@/common/components/StageTracker";
import { useAuth, useApprovalWorkflow } from "@/common/providers/AuthProvider";
import { canActAtStage, firstStage, isFlowOff } from "@/common/services/approvalWorkflowService";
import { AuctionDecisionModalContent } from "@/modules/loans/components/AuctionDecisionModalContent";
import { SettleAuctionModalContent } from "@/modules/loans/components/SettleAuctionModalContent";
import { RecordSaleModalContent } from "@/modules/loans/components/RecordSaleModalContent";
import { ScheduleAuctionModalContent } from "@/modules/loans/components/ScheduleAuctionModalContent";
import { IssueNoticeModalContent } from "@/modules/loans/components/IssueNoticeModalContent";
import { ReleasePledgeModalContent } from "@/modules/loans/components/ReleasePledgeModalContent";
import { FilterPanel, type FilterCategory } from "@/common/components/ui/FilterPanel";
import { loanDisplayStatus, getAuctionRecord, getLoanByNumber, releaseBankPledge, markAuctionEligible, listConcludedAuctionsPage, listLoans, pendingDecision, hasUndisposedSurplus, isActiveAuctionCase, AUCTION_STAGES, AUCTION_STAGE_LABELS, AUCTION_OUTCOME_LABELS } from "@/modules/loans/services/loanService";
import { type AuctionRecordView, type ConcludedAuctionRowView, type LoanView } from "@/modules/loans/types/loan-types";
import { ApiError } from "@/common/services/httpClient";
import { useScrollPageSize } from "@/common/utils/responsive";
import { ScrollSentinel } from "@/common/components/ui/ScrollSentinel";
import { routeHref } from "@/common/services/appRoutes";
import { useCanOpenRoute } from "@/common/hooks/use-can-open-route";
import { printAuctionLetter } from "@/modules/loans/utils/printAuctionLetter";
import { LoanLedgerInfoModalContent, type LedgerInfoAction } from "@/modules/loans/components/LoanLedgerInfoModalContent";
import { useAuctionEntryActions } from "@/modules/loans/components/useAuctionEntryActions";

// version: bumped by the page after an auction edit, so the card fetches its case again
type AuctionCardProps = { l: LoanView; onLoanChanged: () => void; version?: number };

/* One card per loan currently in (or eligible for) the auction pipeline —
 * drives the real 7-stage AuctionRecord (Overdue/Defaulted are the loan's
 * own isOverdue/isDefaulted flags; AuctionEligible onward come from
 * GET /loans/:id/auction) instead of the old cosmetic 4-box track that
 * just read `l.status`. */
// The auction stepper's step names — the same five as the mobile Auction Flow, in AUCTION_STAGES order.
const AUCTION_STEP_NAMES = ["Eligible", "Notice", "Schedule", "Conduct", "Settle"];

function AuctionCard({ l, onLoanChanged, version }: AuctionCardProps) {
  const { openModal } = useModal();
  const { can, role, isSystem } = useAuth();
  const { config: workflow } = useApprovalWorkflow();
  const toast = useToast();
  // Auctions are a facet of a loan, so every step here (eligible → notice →
  // schedule → sale → settle) needs "can update loan"; without it the card
  // shows the pipeline but offers no actions (see Customers.tsx). Printing
  // the auction letter isn't gated — it only renders what's already shown.
  const canAct = can("Loan_Management", "can_update_loan");
  const [rec, setRec] = useState<AuctionRecordView | null | undefined>(undefined); // undefined = loading
  const [starting, setStarting] = useState(false);

  // A live case exists only once the loan has been marked auction-eligible
  // (status Auction Eligible / Auctioned / Auctioned - Balance Due). An
  // Overdue/Defaulted loan with no case yet would make GET /loans/:id/auction
  // answer 404 — once per card — so skip the request for those.
  const mayHaveCase = l.status === "Auction Eligible" || l.status === "Auctioned" || l.status === "Auctioned - Balance Due";
  function load() {
    if (!mayHaveCase) { setRec(null); return; }
    getAuctionRecord(l.numericId).then(setRec);
  }
  useEffect(load, [l.numericId, mayHaveCase, version]);

  // Settle Surplus's button visibility is gated on this card's own `rec`
  // state, which only refreshes after an action taken FROM this card
  // (onSaved) — if the case moved on elsewhere (another tab/session, or an
  // auto-settle at sale time) the button can still be showing a stale
  // "Auctioned" stage when the server has already moved past it, so opening
  // the modal on that stale read would submit against a stage the backend
  // then rejects with the generic ErrAuctionWrongStage. Re-fetching right
  // before opening closes that window; a genuinely-stale case just makes
  // the button disappear on next render instead of opening a doomed modal.
  const [checkingRec, setCheckingRec] = useState(false);
  const [releasingBank, setReleasingBank] = useState(false);
  async function openSettleModal() {
    setCheckingRec(true);
    try {
      const fresh = await getAuctionRecord(l.numericId);
      setRec(fresh);
      if (!fresh || fresh.stage !== "Auctioned" || !hasUndisposedSurplus(fresh)) {
        toast("This auction case has already moved on — refreshing.");
        return;
      }
      openModal(<SettleAuctionModalContent loan={l} rec={fresh} onSaved={onSaved} onError={load} />);
    } finally {
      setCheckingRec(false);
    }
  }

  async function doMarkEligible() {
    setStarting(true);
    try {
      const created = await markAuctionEligible(l.numericId);
      setRec(created);
      onLoanChanged();
      toast(`${l.id} marked auction-eligible`);
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Could not start the auction case — try again.");
    } finally {
      setStarting(false);
    }
  }

  function onSaved(updated: AuctionRecordView) {
    setRec(updated);
    onLoanChanged();
  }

  // getAuctionRecord only ever returns the loan's ACTIVE case (see
  // loan.Service.getAuctionRecord) — once a case is Settled/Withdrawn it
  // comes back null, same as a loan that has never had one at all. For most
  // statuses that ambiguity is harmless (Overdue/Defaulted/Auction Eligible
  // genuinely mean "no case yet"), but l.status stays "Auctioned" forever
  // once gold is sold (deliberately — see backend's RecordAuctionSale),
  // including after the case concludes. Without this check, a fully
  // settled auction rendered as if it had never started, offering "Mark
  // Auction Eligible" on a loan that plainly already went through the
  // whole pipeline. Concluded cases belong only in the History tab, so
  // this card renders nothing once its case is done.
  if (rec === null && l.status === "Auctioned") return null;

  // AUCTION_STAGES is a readonly tuple of the forward path only, so a Withdrawn
  // case has no position on the stepper — hence the cast plus the -1 fallback.
  const stageIndex = rec ? (AUCTION_STAGES as readonly string[]).indexOf(rec.stage) : -1;

  const decision = pendingDecision(rec);
  const canDecide = canAct && (decision?.kind === "Shortfall"
    ? canActAtStage({ role, isSystem }, firstStage(workflow, "auction_shortfall")) || isSystem
    : canActAtStage({ role, isSystem }, firstStage(workflow, "auction_partial_repayment")) || isSystem);
  // While an escalation is open the pipeline is frozen server-side; hiding the
  // advance buttons keeps the UI honest instead of offering actions that 409.
  const frozen = !!decision;
  // Gold sitting with a bank cannot be noticed, scheduled or sold; the server rejects it too.
  const goldAtBank = l.bankPledgeStatus === "Bank Pledged";
  const canReleaseFromBank = can("Bank_Pledge_Management", "can_update_bank_pledge");
  // The list carries no pledge records, so fetch the loan to find the active one,
  // then confirm and release it exactly as the loan page does.
  async function doReleaseFromBank() {
    setReleasingBank(true);
    try {
      const fresh = await getLoanByNumber(l.loanNumber);
      const p = fresh.bankPledges.find((x) => x.status === "Active");
      if (!p) { toast("No active bank pledge found for this loan."); onLoanChanged(); return; }
      openModal(
        <ReleasePledgeModalContent
          bankName={p.bankName}
          amount={p.pledgedAmount}
          cashTreatment={p.cashTreatment}
          onConfirm={async (payment) => {
            await releaseBankPledge(fresh.numericId, p.id, payment);
            toast("Bank pledge released");
            onLoanChanged();
          }}
        />
      );
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Could not load the bank pledge — try again.");
    } finally {
      setReleasingBank(false);
    }
  }
  const balanceDue = l.status === "Auctioned - Balance Due";
  // With an auction decision flow switched off, the backend raises no
  // decision request for that case — it records the outcome as already
  // decided by "System" — so there is nothing to click; say so instead. A
  // request still Pending from before the switch keeps its buttons above.
  const partialAuto = isFlowOff(workflow, "auction_partial_repayment");
  const lastAutoDecision = rec ? [...rec.decisionRequests].reverse().find((d) => d.decidedByRole === "System") : undefined;
  const preSale = !!rec && (rec.stage === "AuctionEligible" || rec.stage === "NoticeIssued" || rec.stage === "AuctionScheduled");

  return (
    <div className="card gtop" style={{ marginBottom: 16 }}>
      <div className="hd"><h3>{l.id} — {l.customerName}</h3><div className="sp" /><StatusChip status={loanDisplayStatus(l)} /></div>
      <div className="bd">
        <div style={{ marginBottom: 14 }}>
          <StageTracker
            // Same step names as the mobile Auction Flow; a loan that has no case yet shows none highlighted,
            // and a concluded case (Settled / Withdrawn) shows every step done.
            stages={AUCTION_STEP_NAMES}
            currentIndex={!rec ? -1 : rec.stage === "Settled" || rec.stage === "Withdrawn" ? AUCTION_STEP_NAMES.length : stageIndex}
          />
        </div>
        <div className="kv">
          <div className="i"><div className="k">Gold Weight</div><div className="v">{fmtW(l.totalNetWeight)}</div></div>
          <div className="i"><div className="k">Outstanding</div><div className="v" style={{ color: "var(--red)", fontWeight: 600 }}>{fmt(l.totalOutstandingBalance)}</div></div>
          <div className="i"><div className="k">Days Overdue</div><div className="v">{l.daysOverdue || "—"}</div></div>
          <div className="i"><div className="k">Auction Date</div><div className="v">{fmtDate(rec?.auctionDate)}</div></div>
          <div className="i"><div className="k">Reference</div><div className="v"><TruncText text={rec?.auctionReferenceNumber} maxWidth="100%" /></div></div>
          <div className="i"><div className="k">Sale Amount</div><div className="v">{rec && rec.saleAmount ? fmt(rec.saleAmount) : "—"}</div></div>
          {rec && rec.stage !== "AuctionEligible" && rec.stage !== "NoticeIssued" && rec.stage !== "AuctionScheduled" && (
            <div className="i"><div className="k">{rec.surplusShortfall >= 0 ? "Surplus" : "Shortfall"}</div>
              <div className="v" style={{ color: rec.surplusShortfall >= 0 ? "var(--green)" : "var(--red)", fontWeight: 600 }}>{fmt(Math.abs(rec.surplusShortfall))}</div></div>
          )}
        </div>

        {/* A surplus not yet disposed of is money owed to the customer sitting
          * in branch cash — surfaced prominently so it cannot be forgotten. */}
        {/* .notice is display:flex — all text goes inside ONE child element,
          * or each <b> becomes its own flex column mid-sentence. */}
        {rec && hasUndisposedSurplus(rec) && (
          <div className="notice" style={{ marginTop: 12 }}>
            <Icon name="shield" />
            <span>
              <b>{fmt(rec.surplusPayableAmount)}</b> surplus pending. Settle to refund.
            </span>
          </div>
        )}

        {/* Frozen-pipeline banner. Deliberately explicit that no auction step
          * can proceed — this is the guarantee that a paying customer's gold is
          * not sold while their payment is under review. */}
        {decision && (
          <div className="notice" style={{ marginTop: 12, borderColor: "var(--red)" }}>
            <Icon name="shield" />
            <span>
              {decision.kind === "Shortfall" ? (
                <>
                  <b>Shortfall</b> — {fmt(decision.outstandingAtRequest)} owing. Awaiting decision.
                </>
              ) : (
                <>
                  <b>Decision pending.</b> Auction frozen.
                </>
              )}
              {!canDecide && <> View only.</>}
            </span>
          </div>
        )}

        {!decision && (lastAutoDecision || (preSale && partialAuto)) && (
          <div className="notice" style={{ marginTop: 12 }}>
            <Icon name="clock" />
            <span>
              {lastAutoDecision
                ? lastAutoDecision.kind === "Shortfall"
                  ? "Balance pursued automatically."
                  : "No decision needed. Auction continues."
                : "No decision needed. Auction continues."}
            </span>
          </div>
        )}

        {balanceDue && !decision && (
          <div className="notice" style={{ marginTop: 12 }}>
            <Icon name="shield" />
            <span>Balance due. Collect as normal payment.</span>
          </div>
        )}

        {/* Deliberately NO per-case log lists here. Notices are still issued and
          * recorded (and the WhatsApp message still goes out), and staff actions
          * are still written to auction_events for audit — but neither is
          * rendered as a running log on the card. What belongs in "history" is
          * PREVIOUS CONDUCTED AUCTIONS, which live in their own section (see the
          * History tab below), not a per-click activity feed. */}
      </div>
      <div className="ft" style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <span style={{ flex: 1 }} />

        {/* Resolving the escalation is the only action offered while frozen —
          * everything else is genuinely unavailable, not merely discouraged. */}
        {decision && canDecide && (
          <button
            className="btn sm"
            onClick={() => openModal(<AuctionDecisionModalContent loan={l} request={decision} onSaved={onSaved} onError={load} />)}
          >
            <Icon name="shield" /> {decision.kind === "Shortfall" ? "Decide Shortfall" : "Decide (Keep / Remove)"}
          </button>
        )}

        {goldAtBank && !frozen && (
          <>
            <span className="muted" style={{ fontSize: 12 }}>Gold is pledged to a bank — release it before continuing the auction.</span>
            {canReleaseFromBank && (
              <button className="btn sm" disabled={releasingBank} onClick={doReleaseFromBank}><Icon name="bank" /> {releasingBank ? "Loading…" : "Release from Bank"}</button>
            )}
          </>
        )}
        {!frozen && !goldAtBank && canAct && can("Auction_Workflow", "can_mark_loan_auction_eligible") && (rec === undefined ? null : !rec ? (
          <button className="btn sm" disabled={starting} onClick={doMarkEligible}><Icon name="gavel" /> {starting ? "Starting…" : "Mark Auction Eligible"}</button>
        ) : null)}
        {!frozen && !goldAtBank && canAct && can("Auction_Workflow", "can_issue_auction_notice") && rec && (rec.stage === "AuctionEligible" || rec.stage === "NoticeIssued") && (
          <button className="btn sm" onClick={() => openModal(<IssueNoticeModalContent loan={l} onSaved={onSaved} onError={load} />)}><Icon name="doc" /> Issue Notice</button>
        )}
        {!frozen && !goldAtBank && canAct && can("Auction_Workflow", "can_schedule_auction") && rec && rec.stage === "NoticeIssued" && (
          <button className="btn sm" onClick={() => openModal(<ScheduleAuctionModalContent loan={l} onSaved={onSaved} onError={load} />)}><Icon name="clock" /> Schedule Auction</button>
        )}
        {!frozen && !goldAtBank && canAct && can("Auction_Workflow", "can_record_auction_sale") && rec && rec.stage === "AuctionScheduled" && (
          <button className="btn sm" onClick={() => openModal(<RecordSaleModalContent loan={l} onSaved={onSaved} onError={load} />)}><Icon name="gavel" /> Record Sale</button>
        )}
        {/* Settle is the surplus-disposition step, so it only applies when the
          * sale actually left a surplus and the loan is not balance-due. */}
        {!frozen && canAct && can("Auction_Workflow", "can_settle_auction") && rec && rec.stage === "Auctioned" && !balanceDue && hasUndisposedSurplus(rec) && (
          <button className="btn sm" disabled={checkingRec} onClick={openSettleModal}><Icon name="check" /> {checkingRec ? "Checking…" : "Settle Surplus"}</button>
        )}
        {/* The printed notice belongs to the Issue Notice stage only: it is there from the moment the
          * notice is issued until the auction is scheduled. */}
        {rec && rec.stage === "NoticeIssued" && (
          <button className="btn sm ghost" onClick={() => printAuctionLetter(l, toast)}><Icon name="doc" /> Notice</button>
        )}
      </div>
    </div>
  );
}

/* Ported from legacy/app.js's `renderAuctions()`. Shows Defaulted loans
 * (isDefaulted, computed read-time — see loan/accrual.go) plus any loan
 * already in the real auction pipeline, instead of the old always-empty
 * mock `db.auctions` list. */
export function AuctionsPage({ focusLoanNumber }: { focusLoanNumber?: string } = {}) {
  const { loans, loading, error, refresh } = useLoans();
  const canOpenRoute = useCanOpenRoute();
  const { can } = useAuth();  // A link from a ledger line (an auction's proceeds or surplus settlement) arrives as "history:<loan number>": it opens
  // the Auction History for that loan. Any other focus keeps landing on Active Cases.
  const historyFocus = !!focusLoanNumber && focusLoanNumber.startsWith("history:");
  // The dashboard's Auction Cases tile arrives as "notice-issued": it opens Active Cases filtered to that stage.
  const noticePreset = focusLoanNumber === "notice-issued";
  const focusLoan = noticePreset ? undefined : historyFocus ? focusLoanNumber!.slice("history:".length) : focusLoanNumber;
  const [tab, setTab] = useState<"active" | "history">(historyFocus ? "history" : "active");
  const { openModal } = useModal();
  // One search box shared by both tabs — Active Cases filters client-side
  // over the already-loaded loan list (same reason its pagination is
  // client-side, see the comment on `allCases` below); History re-queries
  // the server on each edit (debounced), since its two sub-tables are real
  // paginated backend queries.
  // Search, status filter and page numbers are remembered, so opening a loan and pressing Back returns to the same view.
  const [q, setQ] = usePersistedState("auctions:q", focusLoan || "");
  // Arriving with a loan number (route argument) searches for it even when an older search is remembered.
  useEffect(() => { if (focusLoan) setQ(focusLoan); }, [focusLoan]); // eslint-disable-line react-hooks/exhaustive-deps
  // Auction status (stage) filter, applied by the backend on both tabs.
  const [stages, setStages] = usePersistedState<string[]>("auctions:stages", []);
  const stagesKey = stages.join(",");
  useEffect(() => { if (noticePreset) { setStages(["NoticeIssued"]); setQ(""); } }, [noticePreset]); // eslint-disable-line react-hooks/exhaustive-deps
  // History's own filter: only sales that left a surplus to settle, or fell short. Both ticked (or none) shows every sale.
  const [outcomes, setOutcomes] = usePersistedState<string[]>("auctions:outcome", []);
  const outcome = outcomes.length === 1 && (outcomes[0] === "surplus" || outcomes[0] === "shortfall") ? outcomes[0] : "";
  const ACTIVE_STAGE_VALUES = ["AuctionEligible", "NoticeIssued", "AuctionScheduled", "Auctioned"];
  const activeStages = stages.filter((s) => ACTIVE_STAGE_VALUES.includes(s));
  const activeStagesKey = activeStages.join(",");
  const [stageLoans, setStageLoans] = useState<LoanView[] | null>(null);
  useEffect(() => {
    if (activeStages.length === 0) { setStageLoans(null); return; }
    let cancelled = false;
    listLoans({ auctionStage: activeStages }).then((r) => { if (!cancelled) setStageLoans(r); }).catch(() => { if (!cancelled) setStageLoans([]); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeStagesKey]);
  // Sold cases (status "Auctioned") are left out of the shared open-loan list, yet a sale with a surplus is still
  // waiting for its settlement — fetched here so that case stays on Active Cases until it is settled.
  const [soldLoans, setSoldLoans] = useState<LoanView[]>([]);
  useEffect(() => {
    if (stages.length) { setSoldLoans([]); return; }
    let cancelled = false;
    listLoans({ auctionStage: ["Auctioned"] }).then((r) => { if (!cancelled) setSoldLoans(r); }).catch(() => { if (!cancelled) setSoldLoans([]); });
    return () => { cancelled = true; };
  }, [stages.length, loans]);
  const stageFilterCategories: FilterCategory[] = [{
    key: "stage", label: "Auction Status", kind: "static",
    options: [{ value: "Defaulted", label: "Defaulted (not yet eligible)" }, ...(["AuctionEligible", "NoticeIssued", "AuctionScheduled", "Auctioned"] as const).map((s) => ({ value: s, label: AUCTION_STAGE_LABELS[s] }))],
  }];

  /* The two History sub-tables ("Auctions Conducted" / "Closed Without
   * Auction") are now independently paginated, real server queries — each
   * filtered by hasSale so a sub-table's own page/offset never counts
   * against the other's rows (see loansApi.listConcludedAuctionsPage). */
  // Below 1100px the tables are cards: no Prev/Next, the list grows as you
  // scroll (`more` raises pageSize, page stays 1). Above it, pageSize is fixed.
  const { cards, size: pageSize, more } = useScrollPageSize(15, 1400); // 1400: matches the auction-history card breakpoint in app.css
  const [conducted, setConducted] = useState<ConcludedAuctionRowView[]>([]);
  const [conductedPage, setConductedPage] = usePersistedPage("auctions:conducted");
  const [conductedHasMore, setConductedHasMore] = useState(false);
  const [conductedTotal, setConductedTotal] = useState(0);
  const [conductedLoading, setConductedLoading] = useState(false);
  const [conductedError, setConductedError] = useState("");
  const conductedTotalPages = Math.max(1, Math.ceil(conductedTotal / pageSize));

  const [closedWithoutSale, setClosedWithoutSale] = useState<ConcludedAuctionRowView[]>([]);
  const [closedPage, setClosedPage] = usePersistedPage("auctions:closed");
  const [closedHasMore, setClosedHasMore] = useState(false);
  const [closedTotal, setClosedTotal] = useState(0);
  const [closedLoading, setClosedLoading] = useState(false);
  const [closedError, setClosedError] = useState("");
  const closedTotalPages = Math.max(1, Math.ceil(closedTotal / pageSize));

  // Active Cases — isDefaulted is a computed read-time flag, not a
  // persisted column (see loan/accrual.go), so this can't be a server-side
  // filtered query the way the History tab's sub-tables are. It paginates
  // client-side over LoansProvider's already-loaded list instead, the same
  // approach Loans.tsx uses for its own computed-flag tabs (Due Soon/
  // Overdue/Defaulted).
  const [activePage, setActivePage] = usePersistedPage("auctions:active");

  /* "Auctioned - Balance Due" is included so a loan whose sale fell short stays
   * visible here while its shortfall decision is outstanding — otherwise the
   * case needing the most attention would drop off the page. */
  // With a status filter the server decides which cases match; only in-flight stages apply here.
  // Defaulted loans that have no auction case yet — they appear here so they can be marked auction-eligible from this page.
  const defaultedLoans = loans.filter((l) => isActiveAuctionCase(l) && l.isDefaulted && l.status !== "Auction Eligible" && l.status !== "Auctioned" && l.status !== "Auctioned - Balance Due");
  const auctionEligibleCases = stages.length
    ? [
        ...(activeStages.length ? (stageLoans ?? []).filter((l) => l.status === "Auctioned" || (loanDisplayStatus(l) !== "Closure Requested" && l.status !== "Closed")) : []),
        ...(stages.includes("Defaulted") ? defaultedLoans.filter((d) => !activeStages.length || !(stageLoans ?? []).some((l) => l.numericId === d.numericId)) : []),
      ]
    : [...loans.filter(isActiveAuctionCase), ...soldLoans.filter((s) => !loans.some((l) => l.numericId === s.numericId))];
  const trimmedQ = q.trim().toLowerCase();
  const allCases = trimmedQ
    ? auctionEligibleCases.filter((l) => l.id.toLowerCase().includes(trimmedQ) || l.customerName.toLowerCase().includes(trimmedQ) || l.customerCode.toLowerCase().includes(trimmedQ))
    : auctionEligibleCases;
  const activeTotalPages = Math.max(1, Math.ceil(allCases.length / pageSize));
  const cases = allCases.slice((activePage - 1) * pageSize, activePage * pageSize);

  // The active-tab page must reset when the search narrows/widens the
  // result set, or a search that leaves fewer pages than the current one
  // would strand the viewer on a page that no longer exists.
  useResetPageOnChange(setActivePage, [trimmedQ]);
  // Entering card mode drops back to page 1 — card mode only ever grows page 1.
  useEffect(() => {
    if (cards) { setActivePage(1); setConductedPage(1); setClosedPage(1); }
  }, [cards]);

  /* Loaded on demand — a concluded-case sweep across every loan is not worth
   * paying for until someone opens the tab. Fetched from the click handler
   * rather than an effect on `tab`: the fetch is a response to a user action,
   * not state React needs to synchronize, and doing it in an effect trips
   * react-hooks/set-state-in-effect for the cascading render it causes.
   *
   * Each sub-table is its own paginated query (hasSale=true/false) rather
   * than one fetch split client-side — the backend excludes the other
   * sub-table's rows from the WHERE clause, so page 2 of "Auctions Conducted"
   * is genuinely the next 10 sold cases, not offset by however many
   * closed-without-sale rows happened to land in between. */
  const loadConducted = useCallback(async (page: number, query: string) => {
    setConductedLoading(true);
    setConductedError("");
    try {
      const { items, hasMore, total } = await listConcludedAuctionsPage(page, true, pageSize, query, [], outcome);
      setConducted(items);
      setConductedHasMore(hasMore);
      setConductedTotal(total);
    } catch (e) {
      setConductedError(e instanceof ApiError ? e.message : "Could not load auction history.");
    } finally {
      setConductedLoading(false);
    }
  }, [pageSize, outcome]);

  const loadClosed = useCallback(async (page: number, query: string) => {
    setClosedLoading(true);
    setClosedError("");
    try {
      const { items, hasMore, total } = await listConcludedAuctionsPage(page, false, pageSize, query, []);
      setClosedWithoutSale(items);
      setClosedHasMore(hasMore);
      setClosedTotal(total);
    } catch (e) {
      setClosedError(e instanceof ApiError ? e.message : "Could not load auction history.");
    } finally {
      setClosedLoading(false);
    }
  }, [pageSize]);

  // A concluded auction is edited from its History row: the sale amount and expenses, the surplus settlement, the write-off.
  const canEditAuction = can("Loan_Management", "can_edit_ledger_entry");
  // bumped after an auction edit: every case card and the stage-filtered list fetch again
  const [auctionVersion, setAuctionVersion] = useState(0);
  const auctionActions = useAuctionEntryActions(() => {
    setAuctionVersion((v) => v + 1);
    void loadConducted(conductedPage, q.trim());
    void loadClosed(closedPage, q.trim());
    refresh();
  });
  function viewConducted(r: ConcludedAuctionRowView) {
    const actions: LedgerInfoAction[] = [];
    if (canEditAuction) actions.push({ label: "Edit", icon: "edit", run: () => void auctionActions.editConducted(r) });
    openModal(<LoanLedgerInfoModalContent
      title={`Auction — ${r.loanNumber}`}
      kind="Auction · Sale"
      rows={[
        ["Loan", r.loanNumber], ["Customer", r.customerName], ["Auction date", fmtDate(r.auctionDate)],
        ["Reference", <TruncText key="ref" text={r.auctionReferenceNumber} maxWidth="100%" />], ["Sale amount", fmt(r.saleAmount)], ["Auction expenses", r.auctionExpenses ? fmt(r.auctionExpenses) : "—"], ["Net proceeds", fmt(r.saleAmount - (r.auctionExpenses || 0))],
        // Due at sale time, stored when the sale was recorded; older cases show a dash.
        // Falls back to net proceeds less the surplus (plus the shortfall) for cases that stored no due figure.
        ["Amount due at auction", fmt(r.dueTotal ?? (r.saleAmount - (r.auctionExpenses || 0) - r.surplusShortfall))],
        [r.surplusShortfall >= 0 ? "Surplus" : "Shortfall", fmt(Math.abs(r.surplusShortfall))],
        ...(r.surplusDisposition === "RefundedToCustomer" ? [["Refund to customer", fmt(r.surplusPayableAmount || Math.max(0, r.surplusShortfall))] as [string, string]] : []),
        ["Outcome", AUCTION_OUTCOME_LABELS[r.finalSettlementStatus]],
        // The remarks recorded on this auction: each decision (keep / pursue / write-off) and the settlement.
        ...r.decisionRequests.filter((d) => d.decisionRemarks).map((d, i, all) => [all.length > 1 ? `Decision remarks ${i + 1}` : "Decision remarks", d.decisionRemarks] as [string, string]),
        ...(r.surplusDisposition === "RecordedAsIncome" ? [["Surplus settlement", "Kept as company income"] as [string, string]] : []),
        ...(r.surplusDisposition === "RecordedAsIncome"
          ? [["Reason for keeping surplus", <TruncText key="reason" text={r.surplusRemarks} maxWidth="100%" />] as [string, ReactNode]]
          : r.surplusRemarks ? [["Settlement remarks", <TruncText key="remarks" text={r.surplusRemarks} maxWidth="100%" />] as [string, ReactNode]] : []),
      ]}
      description={<>Auction sale of {fmt(r.saleAmount)} less {fmt(r.auctionExpenses)} expenses.{r.surplusDisposition ? <><br />Surplus {r.surplusDisposition === "RefundedToCustomer" ? "refunded to the customer" : "kept as income"}.</> : null}</>}
      actions={actions}
    />);
  }

  function changeConductedPage(page: number) {
    setConductedPage(page);
    void loadConducted(page, q.trim());
  }

  function changeClosedPage(page: number) {
    setClosedPage(page);
    void loadClosed(page, q.trim());
  }

  // Debounced re-search of both History sub-tables as the user types.
  // Deliberately NOT gated on `tab === "history"` — a loan that has already
  // been through auction and settled drops out of Active Cases' own filter
  // (see auctionEligibleCases above, which only matches loans still
  // in-flight), so it can only ever be found via this History query. Running
  // it unconditionally means the moment a search matches something there,
  // the "no results" hint below can point the viewer at Auction History
  // with an accurate count, rather than requiring them to already know to
  // switch tabs before the same search box finds a concluded case.
  // The first run (page opened) loads the remembered pages; later runs (search, filter or size changed) start at page 1.
  const historyMounted = useRef(false);
  useEffect(() => () => { historyMounted.current = false; }, []);
  useEffect(() => {
    const first = !historyMounted.current;
    historyMounted.current = true;
    const handle = setTimeout(() => {
      if (first) {
        void loadConducted(conductedPage, q.trim());
        void loadClosed(closedPage, q.trim());
        return;
      }
      setConductedPage(1);
      setClosedPage(1);
      void loadConducted(1, q.trim());
      void loadClosed(1, q.trim());
    }, first ? 0 : 300);
    return () => clearTimeout(handle);
    // pageSize/cards: card mode grows pageSize on scroll, which must refetch
    // page 1 with the larger size (rows stay on screen meanwhile).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, pageSize, cards, outcome]);

  return (
    <>
      <div className="page-h" >
        <div><h1>Auction Management</h1><p>Defaulted loans progressing through the regulated auction workflow</p> </div>
        <div className="sp" />
        <TableSearch placeholder="Search loan no, customer, reference…" searches="loan number, customer name, customer code · auction reference on the History tab only" value={q} onChange={setQ} />
      </div>
      <hr className="gold-rule" style={{ margin: "4px 0 10px" }} />
      {/* .tabs's own overflow-x:auto (app.css) clips the last pill's right
          edge/shadow the instant its content is even 1-2px wider than the
          container — invisible on rows with room to spare, but this
          2-button row sits right at that edge. auctions-tabs turns
          overflow off for just this row, matching Loans.tsx's own
          loans-cat-tabs fix for the same symptom. */}
      {/* Tab switch on the left, this tab's filter on the right — one row. */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginTop: 4, marginBottom: 8 }}>
      <div className="tabs auctions-tabs" style={{ margin: 0 }}>
        <button className={tab === "active" ? "on" : ""} onClick={() => { setTab("active"); refresh(); setAuctionVersion((v) => v + 1); }}>Active Cases</button>
        <button className={tab === "history" ? "on" : ""} onClick={() => { setTab("history"); void loadConducted(conductedPage, q.trim()); void loadClosed(closedPage, q.trim()); }}>Auction History</button>
      </div>
  {tab === "history" && (
          <div>
            <FilterPanel
              categories={[{ key: "outcome", label: "Sale Outcome", kind: "static", options: [{ value: "surplus", label: "Settle Surplus" }, { value: "shortfall", label: "Shortfall" }] }]}
              value={{ outcome: outcomes }}
              onChange={(next) => { setOutcomes(Array.isArray(next.outcome) ? next.outcome : []); setConductedPage(1); }}
              hideChips
              hideClearAll
            />
          </div>
        )}
  {tab === "active" && (
          <div>
            <FilterPanel
              categories={stageFilterCategories}
              value={{ stage: stages }}
              onChange={(next) => { setStages(Array.isArray(next.stage) ? next.stage : []); setActivePage(1); }}
              hideChips
              hideClearAll
            />
          </div>
        )}
      </div>

      {error && <div className="notice" style={{ marginBottom: 14 }}>{error}</div>}

      {tab === "active" ? (
        loading ? (
          <div className="card"><div className="empty">Loading auction cases…</div></div>
        ) : allCases.length === 0 ? (
          /* Wrapped in a .card so an empty Active Cases tab still reads as a
           * panel like every other page, rather than a bare line of text
           * floating on the page background. */
          <div className="card"><div className="empty">
            {trimmedQ
              ? (conductedTotal + closedTotal) > 0
                ? <>No active cases match your search, but {conductedTotal + closedTotal} concluded case{conductedTotal + closedTotal === 1 ? "" : "s"} did — <a href="#" onClick={(e) => { e.preventDefault(); setTab("history"); }}>see Auction History</a>.</>
                : "No auction cases match your search."
              : "No loans currently in the auction workflow."}
          </div></div>
        ) : (
          <>
            {cases.map((l) => <AuctionCard key={l.id} l={l} onLoanChanged={refresh} version={auctionVersion} />)}
            <ScrollSentinel enabled={cards && allCases.length > cases.length} onVisible={more} watch={cases.length} />
            <div className="ft ft-scroll-hide" style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <button className="btn plain sm" disabled={activePage <= 1} onClick={() => setActivePage((p) => Math.max(1, p - 1))}>‹ Prev</button>
              <span style={{ fontSize: 12.5 }}>Page {activePage} of {activeTotalPages}</span>
              <button className="btn plain sm" disabled={activePage >= activeTotalPages} onClick={() => setActivePage((p) => Math.min(activeTotalPages, p + 1))}>Next ›</button>
            </div>
          </>
        )
      ) : (
        <>
          {/* Auctions actually conducted — gold that went under the hammer and
            * what it fetched. This is the "previous auctions" record, kept apart
            * from cases that ended without a sale (below) so the sale figures
            * read as a clean set. */}
          <div className="card tbl-card" style={{ marginBottom: 16 }}>
            <div className="hd"><h3>Auctions Conducted</h3></div>
            {conductedError && <div className="notice" style={{ margin: 14 }}>{conductedError}</div>}
            {/* Capped to exactly 4 rows' worth of height (header ~35px + 4
             * two-line rows at ~54px each, this table's rows carry a
             * customer-name subline) — beyond that it scrolls internally
             * via `.tbl-wrap`'s own overflow-y:auto rather than growing the
             * card to fit every row on the page. The `auction-history-tbl-wrap`
             * class carries the matching CSS backstop plus the flex rules that
             * stop the card spilling over the next one (see app.css). */}
            <div className="tbl-wrap auction-history-tbl-wrap" style={{ maxHeight: 251 }}>
              <table className="tbl tbl-center tbl-cards">
                <TableCols widths={[11, 11, 11, 12, 11, 12, 14, 12, 6]} />
                <thead>
                  <tr>
                    <th>Loan</th><th>Auction Date</th><th>Reference</th>
                    <th className="num">Sale Amount</th><th className="num">Expenses</th>
                    <th className="num">Net Proceeds</th>
                    <th className="num">Surplus / Shortfall</th><th>Outcome</th><th></th>
                  </tr>
                </thead>
                <tbody>
                  {conductedLoading && !(cards && conducted.length > 0) ? (
                    <tr><td colSpan={9} className="empty">Loading…</td></tr>
                  ) : conducted.length === 0 ? (
                    <tr><td colSpan={9} className="empty">No auctions have been conducted yet.</td></tr>
                  ) : conducted.map((r) => (
                    <tr key={r.id}>
                      <td data-label="Loan">{canOpenRoute("loan") ? <a href={routeHref(`loan/${r.loanNumber}`)}>{r.loanNumber}</a> : r.loanNumber}<small className="sub" style={{ display: "block" }}>{r.customerName}</small></td>
                      <td data-label="Auction Date">{fmtDate(r.auctionDate)}</td>
                      <td data-label="Reference"><TruncText text={r.auctionReferenceNumber} maxWidth={140} /></td>
                      <td className="num" data-label="Sale Amount">{fmt(r.saleAmount)}</td>
                      <td className="num" data-label="Expenses">{r.auctionExpenses ? fmt(r.auctionExpenses) : "—"}</td>
                      <td className="num" data-label="Net Proceeds">{fmt(r.saleAmount - (r.auctionExpenses || 0))}</td>
                      <td className="num" data-label="Surplus / Shortfall" style={{ color: r.surplusShortfall >= 0 ? "var(--green)" : "var(--red)", fontWeight: 600 }}>
                        {r.surplusShortfall >= 0 ? "+" : "−"}{fmt(Math.abs(r.surplusShortfall))}
                      </td>
                      <td data-label="Outcome"><span className="pill green">{AUCTION_OUTCOME_LABELS[r.finalSettlementStatus]}</span></td>
                      <td style={{ width: 40, minWidth: 40 }}>
                        <span className="ledger-info" style={{ right: "50%", transform: "translate(50%, -50%)" }}><button type="button" title="Details" aria-label="Entry details" style={{ border: 0, background: "none", cursor: "pointer", padding: 0, color: "var(--muted)", display: "inline-flex", alignItems: "center" }} onClick={() => viewConducted(r)}><Icon name="info" /></button></span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <ScrollSentinel enabled={cards && conductedHasMore && !conductedLoading} onVisible={more} watch={conducted.length} />
            </div>
            {!cards && <div className="ft ft-scroll-hide" style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <button className="btn plain sm" disabled={conductedPage <= 1} onClick={() => changeConductedPage(Math.max(1, conductedPage - 1))}>‹ Prev</button>
              <span style={{ fontSize: 12.5 }}>Page {conductedPage} of {conductedTotalPages}</span>
              <button className="btn plain sm" disabled={conductedPage >= conductedTotalPages} onClick={() => changeConductedPage(Math.min(conductedTotalPages, conductedPage + 1))}>Next ›</button>
            </div>}
          </div>

          {/* Cases that closed without a sale. Separated because they have no
            * sale figures at all — showing them in the table above would fill
            * every money column with dashes. */}
          <div className="card tbl-card">
            <div className="hd"><h3>Closed Without Auction</h3></div>
            {closedError && <div className="notice" style={{ margin: 14 }}>{closedError}</div>}
            {/* Same 4-row cap as "Auctions Conducted" above (rows here also
             * carry a customer-name subline), so both History sub-tables
             * settle at the same height instead of one dwarfing the other. */}
            <div className="tbl-wrap auction-history-tbl-wrap" style={{ maxHeight: 251 }}>
              <table className="tbl tbl-center tbl-cards">
                <TableCols widths={[30, 35, 35]} />
                <thead>
                  <tr><th>Loan</th><th>Marked Eligible</th><th>Outcome</th></tr>
                </thead>
                <tbody>
                  {closedLoading && !(cards && closedWithoutSale.length > 0) ? (
                    <tr><td colSpan={3} className="empty">Loading…</td></tr>
                  ) : closedWithoutSale.length === 0 ? (
                    <tr><td colSpan={3} className="empty">No cases have closed without going to auction.</td></tr>
                  ) : closedWithoutSale.map((r) => (
                    <tr key={r.id}>
                      <td data-label="Loan">{canOpenRoute("loan") ? <a href={routeHref(`loan/${r.loanNumber}`)}>{r.loanNumber}</a> : r.loanNumber}<small className="sub" style={{ display: "block" }}>{r.customerName}</small></td>
                      <td data-label="Marked Eligible">{fmtDate(r.auctionEligibleDate)}</td>
                      <td data-label="Outcome">
                        {/* A withdrawn case never reached settlement, so the
                          * settlement label would misdescribe it. */}
                        <span className="pill">
                          {r.stage === "Withdrawn" ? "Withdrawn — removed from auction" : AUCTION_OUTCOME_LABELS[r.finalSettlementStatus]}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <ScrollSentinel enabled={cards && closedHasMore && !closedLoading} onVisible={more} watch={closedWithoutSale.length} />
            </div>
            {!cards && <div className="ft ft-scroll-hide" style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <button className="btn plain sm" disabled={closedPage <= 1} onClick={() => changeClosedPage(Math.max(1, closedPage - 1))}>‹ Prev</button>
              <span style={{ fontSize: 12.5 }}>Page {closedPage} of {closedTotalPages}</span>
              <button className="btn plain sm" disabled={closedPage >= closedTotalPages} onClick={() => changeClosedPage(Math.min(closedTotalPages, closedPage + 1))}>Next ›</button>
            </div>}
          </div>
        </>
      )}
    </>
  );
}
