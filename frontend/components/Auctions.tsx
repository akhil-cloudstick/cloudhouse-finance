"use client";

import { useEffect, useState } from "react";
import { useModal } from "@/components/Modal";
import { useToast } from "@/components/Toast";
import { useLoans } from "@/lib/LoansProvider";
import { Icon } from "@/lib/icons";
import { fmt, fmtW } from "@/lib/format";
import { openPrintWindow } from "@/lib/print";
import { StatusChip } from "@/components/StatusChip";
import { StageTracker } from "@/components/StageTracker";
import {
  IssueNoticeModalContent,
  ScheduleAuctionModalContent,
  RecordSaleModalContent,
  SettleAuctionModalContent,
} from "@/components/modals/AuctionModal";
import { getAuctionRecord, markAuctionEligible, AUCTION_STAGES, AUCTION_STAGE_LABELS, type AuctionRecordView, type LoanView } from "@/lib/loansApi";
import { ApiError } from "@/lib/api";

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

  const stageIndex = rec ? AUCTION_STAGES.indexOf(rec.stage) : -1;

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
        {rec && rec.notices.length > 0 && (
          <div style={{ marginTop: 12 }}>
            <div className="k" style={{ fontSize: 11.5, color: "var(--muted)", marginBottom: 4 }}>Notice History</div>
            <ul className="mini-list">
              {rec.notices.map((n) => (
                <li key={n.id}><span className="tx"><b>{n.method}</b><small>{n.issuedAt}{n.remarks ? ` · ${n.remarks}` : ""}</small></span></li>
              ))}
            </ul>
          </div>
        )}
      </div>
      <div className="ft" style={{ display: "flex", gap: 10, alignItems: "center" }}>
        <span style={{ flex: 1 }} />
        {rec === undefined ? null : !rec ? (
          <button className="btn sm" disabled={starting} onClick={doMarkEligible}><Icon name="gavel" /> {starting ? "Starting…" : "Mark Auction Eligible"}</button>
        ) : rec.stage === "AuctionEligible" || rec.stage === "NoticeIssued" ? (
          <button className="btn sm" onClick={() => openModal(<IssueNoticeModalContent loan={l} onSaved={onSaved} />)}><Icon name="doc" /> Issue Notice</button>
        ) : null}
        {rec && rec.stage === "NoticeIssued" && (
          <button className="btn sm" onClick={() => openModal(<ScheduleAuctionModalContent loan={l} onSaved={onSaved} />)}><Icon name="clock" /> Schedule Auction</button>
        )}
        {rec && rec.stage === "AuctionScheduled" && (
          <button className="btn sm" onClick={() => openModal(<RecordSaleModalContent loan={l} onSaved={onSaved} />)}><Icon name="gavel" /> Record Sale</button>
        )}
        {rec && rec.stage === "Auctioned" && (
          <button className="btn sm" onClick={() => openModal(<SettleAuctionModalContent loan={l} rec={rec} onSaved={onSaved} />)}><Icon name="check" /> Settle</button>
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
  const cases = loans.filter((l) => l.isDefaulted || l.status === "Auction Eligible" || l.status === "Auctioned");

  return (
    <>
      <div className="page-h">
        <div><h1>Auction Management</h1><p>Defaulted loans progressing through the regulated auction workflow</p></div>
      </div>
      <hr className="gold-rule" />
      {error && <div className="notice" style={{ marginBottom: 14 }}>{error}</div>}
      {loading ? (
        <div className="empty">Loading auction cases…</div>
      ) : cases.length === 0 ? (
        <div className="empty">No loans currently in the auction workflow.</div>
      ) : cases.map((l) => <AuctionCard key={l.id} l={l} onLoanChanged={refresh} />)}
      {/* <div className="notice">
        <Icon name="shield" /> Workflow: Overdue → Defaulted → Auction Eligible → Notice Issued → Auction Scheduled → Auctioned → Settled, with customer notice history and settlement records at every step.
      </div> */}
    </>
  );
}
