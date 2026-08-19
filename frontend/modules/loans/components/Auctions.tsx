"use client";

import { useCallback, useEffect, useState } from "react";
import { useModal } from "@/common/components/Modal";
import { useToast } from "@/common/components/Toast";
import { useLoans } from "@/modules/loans/store/LoansProvider";
import { Icon } from "@/common/components/Icon";
import { fmt, fmtW } from "@/common/utils/format";
import { openPrintWindow } from "@/common/utils/print";
import { StatusChip } from "@/common/components/ui/StatusChip";
import { StageTracker } from "@/common/components/ui/StageTracker";
import { useAuth } from "@/common/auth-context";
import {
  IssueNoticeModalContent,
  ScheduleAuctionModalContent,
  RecordSaleModalContent,
  SettleAuctionModalContent,
  AuctionDecisionModalContent,
} from "@/common/components/modals/AuctionModal";
import {
  getAuctionRecord,
  markAuctionEligible,
  listConcludedAuctionsPage,
  pendingDecision,
  hasUndisposedSurplus,
  AUCTION_STAGES,
  AUCTION_STAGE_LABELS,
  AUCTION_OUTCOME_LABELS,
  type AuctionRecordView,
  type LoanView,
} from "@/modules/loans/services/loanService";
import { ApiError } from "@/common/services/httpClient";

/* Roles allowed to decide each kind of escalation — mirrors the service-layer
 * checks in loan.Service.ResolveAuctionDecision. Hiding the button is a
 * convenience; the backend is the actual control and rejects the call either
 * way. The Auction Administrator is deliberately absent from the shortfall
 * list: it raises that escalation but must not decide whether to write off or
 * pursue real money owed. */
const PARTIAL_DECISION_ROLES = ["Administrator", "Management", "Branch Manager", "Auction Administrator"];
const SHORTFALL_DECISION_ROLES = ["Administrator", "Management", "Branch Manager"];

/* Ported from legacy/app.js's `printAuctionLetter()`. The mock version read
 * a separate `db.auctions` list (always empty in this codebase — no
 * seed data and no way to add rows to it, only `updateAuction()` for
 * already-existing ones) plus notice/venue fields that have no backend
 * equivalent. Now works directly off a real loan. */
export function printAuctionLetter(loan: LoanView, toast: (m: string) => void) {
  const today = new Date().toISOString().slice(0, 10);
  const venue = "Ambika Gold Finance, Koratty Branch";

  openPrintWindow("Auction Letter — " + loan.id, `
    <h1>AMBIKA GOLD FINANCE</h1>
    <h2>Koratty, Thrissur, Kerala · Ph: 0480-2730000</h2>
    <p class="muted">Ref: AGF/AUC/${loan.id.replace("LN-", "")} · Date: ${today}</p>
    <p><b>To,</b><br>${loan.customerName}</p>
    <p><b>Subject: Final notice — public auction of gold ornaments pledged against loan ${loan.id}</b></p>
    <p>Dear Sir/Madam,</p>
    <ol>
      <li>Despite our repeated reminders, the dues against your gold loan <b>${loan.id}</b>
        (outstanding <b>${fmt(loan.outstanding)}</b> as on date) remain unpaid.</li>
      <li>You are hereby given final notice that the gold ornaments pledged against the said loan will be sold in
        <b>PUBLIC AUCTION</b>${loan.auctionDate ? ` on <b>${loan.auctionDate}</b>` : ""} at <b>${venue}</b>,
        if the entire dues are not settled before the auction date.</li>
      <li>Details of the pledged ornaments to be auctioned:</li>
    </ol>
    <table>
      <tr><th>Ornament</th><th>Purity</th><th class="num">Gross (g)</th><th class="num">Net (g)</th><th class="num">Qty</th></tr>
      ${loan.ornaments.length
        ? loan.ornaments.map((o) => `<tr><td>${o.name}</td><td>${o.purity}</td><td class="num">${o.grossWeight.toFixed(1)}</td><td class="num">${o.netWeight.toFixed(1)}</td><td class="num">${o.quantity}</td></tr>`).join("")
        : `<tr><td colspan="5">Pledged gold — ${loan.totalNetWeight.toFixed(1)} g total</td></tr>`}
    </table>
    <ol start="4">
      <li>Any surplus from the auction sale after adjusting the principal, interest, penal charges and auction
        expenses will be refunded to you; any shortfall shall remain recoverable from you.</li>
      <li>You may redeem the ornaments by settling the full outstanding with charges at our branch on any working
        day before the auction date.</li>
    </ol>
    <p>This notice is issued as per the terms of the loan agreement and applicable regulations.</p>
    <div class="sig"><div><span>Authorized Signatory</span></div><div><span>Branch Manager</span></div></div>`,
    toast);
}

/* One card per loan currently in (or eligible for) the auction pipeline —
 * drives the real 7-stage AuctionRecord (Overdue/Defaulted are the loan's
 * own isOverdue/isDefaulted flags; AuctionEligible onward come from
 * GET /loans/:id/auction) instead of the old cosmetic 4-box track that
 * just read `l.status`. */
function AuctionCard({ l, onLoanChanged }: { l: LoanView; onLoanChanged: () => void }) {
  const { openModal } = useModal();
  const { role } = useAuth();
  const toast = useToast();
  const [rec, setRec] = useState<AuctionRecordView | null | undefined>(undefined); // undefined = loading
  const [starting, setStarting] = useState(false);

  function load() {
    getAuctionRecord(l.numericId).then(setRec);
  }
  useEffect(load, [l.numericId]);

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

  // AUCTION_STAGES is a readonly tuple of the forward path only, so a Withdrawn
  // case has no position on the stepper — hence the cast plus the -1 fallback.
  const stageIndex = rec ? (AUCTION_STAGES as readonly string[]).indexOf(rec.stage) : -1;

  const decision = pendingDecision(rec);
  const canDecide = !!role && (decision?.kind === "Shortfall"
    ? SHORTFALL_DECISION_ROLES.includes(role)
    : PARTIAL_DECISION_ROLES.includes(role));
  // While an escalation is open the pipeline is frozen server-side; hiding the
  // advance buttons keeps the UI honest instead of offering actions that 409.
  const frozen = !!decision;
  const balanceDue = l.status === "Auctioned - Balance Due";

  return (
    <div className="card gtop" style={{ marginBottom: 16 }}>
      <div className="hd"><h3>{l.id} — {l.customerName}</h3><div className="sp" /><StatusChip status={l.isDefaulted ? "Defaulted" : l.status} /></div>
      <div className="bd">
        <div style={{ marginBottom: 14 }}>
          <StageTracker
            stages={["Overdue", "Defaulted", ...AUCTION_STAGES.map((s) => AUCTION_STAGE_LABELS[s])]}
            currentIndex={rec ? 2 + stageIndex : l.isDefaulted ? 2 : l.isOverdue ? 1 : 0}
          />
        </div>
        <div className="kv">
          <div className="i"><div className="k">Gold Weight</div><div className="v">{fmtW(l.totalNetWeight)}</div></div>
          <div className="i"><div className="k">Outstanding</div><div className="v" style={{ color: "var(--red)", fontWeight: 600 }}>{fmt(l.totalOutstandingBalance)}</div></div>
          <div className="i"><div className="k">Days Overdue</div><div className="v">{l.daysOverdue || "—"}</div></div>
          <div className="i"><div className="k">Auction Date</div><div className="v">{rec?.auctionDate || "—"}</div></div>
          <div className="i"><div className="k">Reference</div><div className="v">{rec?.auctionReferenceNumber || "—"}</div></div>
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
              <b>{fmt(rec.surplusPayableAmount)}</b> surplus is payable back to {l.customerName} and has not been disposed of
              yet. Settle the case to refund it or record it as income.
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
                  <b>Shortfall — awaiting authority.</b> The sale realised {fmt(decision.amountPaid)} and left{" "}
                  <b>{fmt(decision.outstandingAtRequest)}</b> owing. A Branch Manager or Management must decide whether to
                  write the balance off or pursue it. The balance is frozen until then.
                </>
              ) : (
                <>
                  <b>Decision pending.</b> {fmt(decision.amountPaid)} was paid, leaving {fmt(decision.outstandingAtRequest)}{" "}
                  owing. The auction is frozen — no notice, schedule, or sale can proceed until this is resolved.
                </>
              )}
              {!canDecide && <> Your role can view this but not decide it.</>}
            </span>
          </div>
        )}

        {balanceDue && !decision && (
          <div className="notice" style={{ marginTop: 12 }}>
            <Icon name="shield" />
            <span>
              Balance due after auction — this loan has returned to normal collection. Record payments against it as usual;
              the auction will close itself once the balance is cleared.
            </span>
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
            onClick={() => openModal(<AuctionDecisionModalContent loan={l} request={decision} onSaved={onSaved} />)}
          >
            <Icon name="shield" /> {decision.kind === "Shortfall" ? "Decide Shortfall" : "Decide (Keep / Remove)"}
          </button>
        )}

        {!frozen && (rec === undefined ? null : !rec ? (
          <button className="btn sm" disabled={starting} onClick={doMarkEligible}><Icon name="gavel" /> {starting ? "Starting…" : "Mark Auction Eligible"}</button>
        ) : rec.stage === "AuctionEligible" || rec.stage === "NoticeIssued" ? (
          <button className="btn sm" onClick={() => openModal(<IssueNoticeModalContent loan={l} onSaved={onSaved} />)}><Icon name="doc" /> Issue Notice</button>
        ) : null)}
        {!frozen && rec && rec.stage === "NoticeIssued" && (
          <button className="btn sm" onClick={() => openModal(<ScheduleAuctionModalContent loan={l} onSaved={onSaved} />)}><Icon name="clock" /> Schedule Auction</button>
        )}
        {!frozen && rec && rec.stage === "AuctionScheduled" && (
          <button className="btn sm" onClick={() => openModal(<RecordSaleModalContent loan={l} onSaved={onSaved} />)}><Icon name="gavel" /> Record Sale</button>
        )}
        {/* Settle is the surplus-disposition step, so it only applies when the
          * sale actually left a surplus and the loan is not balance-due. */}
        {!frozen && rec && rec.stage === "Auctioned" && !balanceDue && hasUndisposedSurplus(rec) && (
          <button className="btn sm" onClick={() => openModal(<SettleAuctionModalContent loan={l} rec={rec} onSaved={onSaved} />)}><Icon name="check" /> Settle Surplus</button>
        )}
        {rec && (rec.stage === "Auctioned" || rec.stage === "Settled") && (
          <button className="btn sm ghost" onClick={() => printAuctionLetter(l, toast)}><Icon name="doc" /> Print Auction Letter</button>
        )}
      </div>
    </div>
  );
}


/* Ported from legacy/app.js's `renderAuctions()`. Shows Defaulted loans
 * (isDefaulted, computed read-time — see loan/accrual.go) plus any loan
 * already in the real auction pipeline, instead of the old always-empty
 * mock `db.auctions` list. */
export function Auctions() {
  const { loans, loading, error, refresh } = useLoans();
  const [tab, setTab] = useState<"active" | "history">("active");

  /* The two History sub-tables ("Auctions Conducted" / "Closed Without
   * Auction") are now independently paginated, real server queries — each
   * filtered by hasSale so a sub-table's own page/offset never counts
   * against the other's rows (see loansApi.listConcludedAuctionsPage). */
  const [conducted, setConducted] = useState<AuctionRecordView[]>([]);
  const [conductedPage, setConductedPage] = useState(1);
  const [conductedHasMore, setConductedHasMore] = useState(false);
  const [conductedLoading, setConductedLoading] = useState(false);
  const [conductedError, setConductedError] = useState("");

  const [closedWithoutSale, setClosedWithoutSale] = useState<AuctionRecordView[]>([]);
  const [closedPage, setClosedPage] = useState(1);
  const [closedHasMore, setClosedHasMore] = useState(false);
  const [closedLoading, setClosedLoading] = useState(false);
  const [closedError, setClosedError] = useState("");

  const conductedTotalPages = conductedHasMore ? conductedPage + 1 : conductedPage;
  const closedTotalPages = closedHasMore ? closedPage + 1 : closedPage;

  // Active Cases — isDefaulted is a computed read-time flag, not a
  // persisted column (see loan/accrual.go), so this can't be a server-side
  // filtered query the way the History tab's sub-tables are. It paginates
  // client-side over LoansProvider's already-loaded list instead, the same
  // approach Loans.tsx uses for its own computed-flag tabs (Due Soon/
  // Overdue/Defaulted).
  const [activePage, setActivePage] = useState(1);
  const ACTIVE_PAGE_SIZE = 10;

  /* "Auctioned - Balance Due" is included so a loan whose sale fell short stays
   * visible here while its shortfall decision is outstanding — otherwise the
   * case needing the most attention would drop off the page. */
  const allCases = loans.filter((l) =>
    l.isDefaulted ||
    l.status === "Auction Eligible" ||
    l.status === "Auctioned" ||
    l.status === "Auctioned - Balance Due"
  );
  const activeTotalPages = Math.max(1, Math.ceil(allCases.length / ACTIVE_PAGE_SIZE));
  const cases = allCases.slice((activePage - 1) * ACTIVE_PAGE_SIZE, activePage * ACTIVE_PAGE_SIZE);

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
  const loadConducted = useCallback(async (page: number) => {
    setConductedLoading(true);
    setConductedError("");
    try {
      const { items, hasMore } = await listConcludedAuctionsPage(page, true);
      setConducted(items);
      setConductedHasMore(hasMore);
    } catch (e) {
      setConductedError(e instanceof ApiError ? e.message : "Could not load auction history.");
    } finally {
      setConductedLoading(false);
    }
  }, []);

  const loadClosed = useCallback(async (page: number) => {
    setClosedLoading(true);
    setClosedError("");
    try {
      const { items, hasMore } = await listConcludedAuctionsPage(page, false);
      setClosedWithoutSale(items);
      setClosedHasMore(hasMore);
    } catch (e) {
      setClosedError(e instanceof ApiError ? e.message : "Could not load auction history.");
    } finally {
      setClosedLoading(false);
    }
  }, []);

  function showHistory() {
    setTab("history");
    setConductedPage(1);
    setClosedPage(1);
    void loadConducted(1);
    void loadClosed(1);
  }

  function changeConductedPage(page: number) {
    setConductedPage(page);
    void loadConducted(page);
  }

  function changeClosedPage(page: number) {
    setClosedPage(page);
    void loadClosed(page);
  }

  return (
    <>
      <div className="page-h">
        <div><h1>Auction Management</h1><p>Defaulted loans progressing through the regulated auction workflow</p></div>
      </div>
      <hr className="gold-rule" />

      <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
        <button className={`btn ${tab === "active" ? "" : "ghost"} sm`} onClick={() => setTab("active")}>Active Cases</button>
        <button className={`btn ${tab === "history" ? "" : "ghost"} sm`} onClick={showHistory}>Auction History</button>
      </div>

      {error && <div className="notice" style={{ marginBottom: 14 }}>{error}</div>}

      {tab === "active" ? (
        loading ? (
          <div className="empty">Loading auction cases…</div>
        ) : allCases.length === 0 ? (
          <div className="empty">No loans currently in the auction workflow.</div>
        ) : (
          <>
            {cases.map((l) => <AuctionCard key={l.id} l={l} onLoanChanged={refresh} />)}
            <div className="ft" style={{ display: "flex", alignItems: "center", gap: 10 }}>
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
          <div className="card" style={{ marginBottom: 16 }}>
            <div className="hd"><h3>Auctions Conducted</h3></div>
            {conductedError && <div className="notice" style={{ margin: 14 }}>{conductedError}</div>}
            <div className="tbl-wrap">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Loan</th><th>Auction Date</th><th>Reference</th>
                    <th className="num">Sale Amount</th><th className="num">Expenses</th>
                    <th className="num">Surplus / Shortfall</th><th>Outcome</th>
                  </tr>
                </thead>
                <tbody>
                  {conductedLoading ? (
                    <tr><td colSpan={7} className="empty">Loading…</td></tr>
                  ) : conducted.length === 0 ? (
                    <tr><td colSpan={7} className="empty">No auctions have been conducted yet.</td></tr>
                  ) : conducted.map((r) => (
                    <tr key={r.id}>
                      <td>#{r.loanId}</td>
                      <td>{r.auctionDate || "—"}</td>
                      <td>{r.auctionReferenceNumber || "—"}</td>
                      <td className="num">{fmt(r.saleAmount)}</td>
                      <td className="num">{r.auctionExpenses ? fmt(r.auctionExpenses) : "—"}</td>
                      <td className="num" style={{ color: r.surplusShortfall >= 0 ? "var(--green)" : "var(--red)", fontWeight: 600 }}>
                        {r.surplusShortfall >= 0 ? "+" : "−"}{fmt(Math.abs(r.surplusShortfall))}
                      </td>
                      <td><span className="pill green">{AUCTION_OUTCOME_LABELS[r.finalSettlementStatus]}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="ft" style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <button className="btn plain sm" disabled={conductedPage <= 1} onClick={() => changeConductedPage(Math.max(1, conductedPage - 1))}>‹ Prev</button>
              <span style={{ fontSize: 12.5 }}>Page {conductedPage} of {conductedTotalPages}</span>
              <button className="btn plain sm" disabled={!conductedHasMore} onClick={() => changeConductedPage(conductedPage + 1)}>Next ›</button>
              <div className="sp" />
              <span>Gold that was actually sold at auction, with what it realised and how the surplus or shortfall was resolved.</span>
            </div>
          </div>

          {/* Cases that closed without a sale. Separated because they have no
            * sale figures at all — showing them in the table above would fill
            * every money column with dashes. */}
          <div className="card">
            <div className="hd"><h3>Closed Without Auction</h3></div>
            {closedError && <div className="notice" style={{ margin: 14 }}>{closedError}</div>}
            <div className="tbl-wrap">
              <table className="tbl">
                <thead>
                  <tr><th>Loan</th><th>Marked Eligible</th><th>Outcome</th></tr>
                </thead>
                <tbody>
                  {closedLoading ? (
                    <tr><td colSpan={3} className="empty">Loading…</td></tr>
                  ) : closedWithoutSale.length === 0 ? (
                    <tr><td colSpan={3} className="empty">No cases have closed without going to auction.</td></tr>
                  ) : closedWithoutSale.map((r) => (
                    <tr key={r.id}>
                      <td>#{r.loanId}</td>
                      <td>{r.auctionEligibleDate || "—"}</td>
                      <td>
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
            </div>
            <div className="ft" style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <button className="btn plain sm" disabled={closedPage <= 1} onClick={() => changeClosedPage(Math.max(1, closedPage - 1))}>‹ Prev</button>
              <span style={{ fontSize: 12.5 }}>Page {closedPage} of {closedTotalPages}</span>
              <button className="btn plain sm" disabled={!closedHasMore} onClick={() => changeClosedPage(closedPage + 1)}>Next ›</button>
              <div className="sp" />
              <span>
                Cases the customer resolved before the gold was sold, or that management withdrew. A loan whose case was withdrawn
                can enter a fresh auction if it defaults again.
              </span>
            </div>
          </div>
        </>
      )}
    </>
  );
}
