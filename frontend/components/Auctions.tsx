"use client";

import { useData } from "@/lib/DataProvider";
import { useModal } from "@/components/Modal";
import { useToast } from "@/components/Toast";
import { Icon } from "@/lib/icons";
import { fmt, fmtW, custOf } from "@/lib/format";
import { openPrintWindow } from "@/lib/print";
import { StatusChip } from "@/components/StatusChip";
import { AuctionModalContent } from "@/components/modals/AuctionModal";
import type { DB, Auction } from "@/lib/data";

const STAGES = ["Overdue", "Default", "Auction Eligible", "Notice Issued", "Auction Scheduled", "Auctioned", "Settled"];

/* Ported from legacy/app.js's `printAuctionLetter()`. Exported so the
 * AuctionModal's confirmation step can trigger it too. */
export function printAuctionLetter(db: DB, loan: string, toast: (m: string) => void) {
  const a = db.auctions.find((x) => x.loan === loan);
  if (!a || a.auctionDate === "—") { toast("Schedule the auction first"); return; }
  const l = db.loans.find((x) => x.id === loan);
  const c = custOf(db, l?.cust || "") as { name?: string; addr?: string; phone?: string };
  const orns = db.ornaments[loan] || [];
  const today = new Date().toISOString().slice(0, 10);
  const venue = a.venue || "Ambika Gold Finance, Koratty Branch";

  openPrintWindow("Auction Letter — " + loan, `
    <h1>AMBIKA GOLD FINANCE</h1>
    <h2>Koratty, Thrissur, Kerala · Ph: 0480-2730000</h2>
    <p class="muted">Ref: AGF/AUC/${loan.replace("GL-", "")} · Date: ${today}</p>
    <p><b>To,</b><br>${c.name || a.cust}<br>${c.addr || ""}<br>Ph: ${c.phone || ""}</p>
    <p><b>Subject: Final notice — public auction of gold ornaments pledged against loan ${loan}</b></p>
    <p>Dear Sir/Madam,</p>
    <ol>
      <li>Despite our repeated reminders and the registered notice dated <b>${a.notice}</b>, the dues against
        your gold loan <b>${loan}</b> (outstanding <b>${fmt(a.outstanding)}</b> as on date, eligible for auction
        since ${a.eligible}) remain unpaid.</li>
      <li>You are hereby given final notice that the gold ornaments pledged against the said loan will be sold in
        <b>PUBLIC AUCTION</b> on <b>${a.auctionDate}</b> at <b>${venue}</b>,
        if the entire dues are not settled before the auction date.</li>
      <li>Details of the pledged ornaments to be auctioned:</li>
    </ol>
    <table>
      <tr><th>Ornament</th><th>Purity</th><th class="num">Gross (g)</th><th class="num">Net (g)</th><th class="num">Qty</th></tr>
      ${orns.length
        ? orns.map((o) => `<tr><td>${o.n}</td><td>${o.purity}</td><td class="num">${o.gross.toFixed(1)}</td><td class="num">${o.net.toFixed(1)}</td><td class="num">${o.qty}</td></tr>`).join("")
        : `<tr><td colspan="5">Pledged gold — ${a.weight.toFixed(1)} g total</td></tr>`}
    </table>
    <ol start="4">
      <li>Any surplus from the auction sale after adjusting the principal, interest, penal charges and auction
        expenses will be refunded to you; any shortfall shall remain recoverable from you.</li>
      <li>You may redeem the ornaments by settling the full outstanding with charges at our branch on any working
        day <b>before ${a.auctionDate}</b>.</li>
    </ol>
    <p>This notice is issued as per the terms of the loan agreement and applicable regulations.</p>
    <div class="sig"><div><span>Authorized Signatory</span></div><div><span>Branch Manager</span></div></div>`,
    toast);
}

function AuctionCard({ a }: { a: Auction }) {
  const { db } = useData();
  const { openModal } = useModal();
  const toast = useToast();
  const idx = STAGES.indexOf(a.stage);
  const scheduledIdx = STAGES.indexOf("Auction Scheduled");

  return (
    <div className="card gtop" style={{ marginBottom: 16 }}>
      <div className="hd"><h3>{a.loan} — {a.cust}</h3><div className="sp" /><StatusChip status={a.stage} /></div>
      <div className="bd">
        <div className="track" style={{ marginBottom: 14 }}>
          {STAGES.map((s, i) => <div key={s} className={`st ${i <= idx ? "done" : ""}`}>{s}</div>)}
        </div>
        <div className="kv">
          <div className="i"><div className="k">Gold Weight</div><div className="v">{fmtW(a.weight)}</div></div>
          <div className="i"><div className="k">Outstanding</div><div className="v" style={{ color: "var(--red)", fontWeight: 600 }}>{fmt(a.outstanding)}</div></div>
          <div className="i"><div className="k">Eligible Since</div><div className="v">{a.eligible}</div></div>
          <div className="i"><div className="k">Notice Issued</div><div className="v">{a.notice}</div></div>
          <div className="i"><div className="k">Auction Date</div><div className="v">{a.auctionDate}</div></div>
          <div className="i"><div className="k">Sale Amount</div><div className="v">{a.sale ? fmt(a.sale) : "—"}</div></div>
        </div>
      </div>
      <div className="ft" style={{ display: "flex", gap: 10, alignItems: "center" }}>
        Notices &amp; auction SMS history maintained · surplus/shortfall computed after sale
        <span style={{ flex: 1 }} />
        {idx >= scheduledIdx ? (
          <>
            <button className="btn ghost sm" onClick={() => openModal(<AuctionModalContent loan={a.loan} />)}>Reschedule</button>
            <button className="btn sm" onClick={() => printAuctionLetter(db, a.loan, toast)}><Icon name="doc" /> Print Auction Letter</button>
          </>
        ) : (
          <button className="btn sm" onClick={() => openModal(<AuctionModalContent loan={a.loan} />)}><Icon name="gavel" /> Schedule Auction</button>
        )}
      </div>
    </div>
  );
}

/* Ported from legacy/app.js's `renderAuctions()`. */
export function Auctions() {
  const { db } = useData();

  return (
    <>
      <div className="page-h">
        <div><h1>Auction Management</h1><p>Defaulted loans progressing through the regulated auction workflow</p></div>
      </div>
      <hr className="gold-rule" />
      {db.auctions.map((a) => <AuctionCard key={a.loan} a={a} />)}
      <div className="notice">
        <Icon name="shield" /> Workflow: Overdue → Default → Auction Eligible → Notice Issued → Auction Scheduled → Auctioned → Settled, with customer notice history and settlement records at every step.
      </div>
    </>
  );
}
