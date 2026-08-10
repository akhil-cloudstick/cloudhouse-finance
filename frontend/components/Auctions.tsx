"use client";

import { useModal } from "@/components/Modal";
import { useToast } from "@/components/Toast";
import { useLoans } from "@/lib/LoansProvider";
import { Icon } from "@/lib/icons";
import { fmt, fmtW } from "@/lib/format";
import { openPrintWindow } from "@/lib/print";
import { StatusChip } from "@/components/StatusChip";
import { AuctionModalContent } from "@/components/modals/AuctionModal";
import type { LoanView } from "@/lib/loansApi";

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

const STAGES = ["Overdue", "Defaulted", "Auction Eligible", "Auctioned"];

function AuctionCard({ l, onSaved }: { l: LoanView; onSaved: () => void }) {
  const { openModal } = useModal();
  const toast = useToast();
  const idx = STAGES.indexOf(l.status);

  return (
    <div className="card gtop" style={{ marginBottom: 16 }}>
      <div className="hd"><h3>{l.id} — {l.customerName}</h3><div className="sp" /><StatusChip status={l.status} /></div>
      <div className="bd">
        <div className="track" style={{ marginBottom: 14 }}>
          {STAGES.map((s, i) => <div key={s} className={`st ${i <= idx ? "done" : ""}`}>{s}</div>)}
        </div>
        <div className="kv">
          <div className="i"><div className="k">Gold Weight</div><div className="v">{fmtW(l.totalNetWeight)}</div></div>
          <div className="i"><div className="k">Outstanding</div><div className="v" style={{ color: "var(--red)", fontWeight: 600 }}>{fmt(l.outstanding)}</div></div>
          <div className="i"><div className="k">Due Date</div><div className="v">{l.due}</div></div>
          <div className="i"><div className="k">Auction Date</div><div className="v">{l.auctionDate || "—"}</div></div>
          <div className="i"><div className="k">Sale Amount</div><div className="v">{l.auctionAmount ? fmt(l.auctionAmount) : "—"}</div></div>
        </div>
      </div>
      <div className="ft" style={{ display: "flex", gap: 10, alignItems: "center" }}>
        Surplus/shortfall computed after sale
        <span style={{ flex: 1 }} />
        {l.status === "Auctioned" ? (
          <button className="btn sm" onClick={() => printAuctionLetter(l, toast)}><Icon name="doc" /> Print Auction Letter</button>
        ) : (
          <button className="btn sm" onClick={() => openModal(<AuctionModalContent loan={l} onSaved={onSaved} />)}><Icon name="gavel" /> Record Auction</button>
        )}
      </div>
    </div>
  );
}

/* Ported from legacy/app.js's `renderAuctions()`. Now shows real loans in
 * "Auction Eligible" or "Auctioned" status instead of the always-empty
 * mock `db.auctions` list. */
export function Auctions() {
  const { loans, loading, error, refresh } = useLoans();
  const cases = loans.filter((l) => l.status === "Auction Eligible" || l.status === "Auctioned" || l.status === "Defaulted");

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
      ) : cases.map((l) => <AuctionCard key={l.id} l={l} onSaved={refresh} />)}
      <div className="notice">
        <Icon name="shield" /> Workflow: Overdue → Defaulted → Auction Eligible → Auctioned, with customer notice history and settlement records at every step.
      </div>
    </>
  );
}
