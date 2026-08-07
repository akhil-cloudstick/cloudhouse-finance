"use client";

import { useState } from "react";
import { useData } from "@/lib/DataProvider";
import { useModal } from "@/components/Modal";
import { useToast } from "@/components/Toast";
import { Icon } from "@/lib/icons";
import { fmt, fmtW } from "@/lib/format";
import { printAuctionLetter } from "@/components/Auctions";

const DEFAULT_VENUE = "Ambika Gold Finance, Koratty Branch";

/* Ported from legacy/app.js's `openAuctionModal()` / `saveAuctionSchedule()`. */
export function AuctionModalContent({ loan }: { loan: string }) {
  const { db, refresh } = useData();
  const { openModal, closeModal } = useModal();
  const toast = useToast();
  const today = new Date().toISOString().slice(0, 10);

  const a = db.auctions.find((x) => x.loan === loan);

  const [date, setDate] = useState(a && a.auctionDate !== "—" ? a.auctionDate : "");
  const [venue, setVenue] = useState(a?.venue || DEFAULT_VENUE);
  const [err, setErr] = useState("");

  if (!a) { toast("Auction case not found"); return null; }

  function save() {
    if (!date) { setErr("Please select the auction date."); return; }
    const v = venue.trim() || DEFAULT_VENUE;
    if (!db.updateAuction(loan, { stage: "Auction Scheduled", auctionDate: date, venue: v })) {
      setErr("Could not save — storage is full.");
      return;
    }
    refresh();
    openModal(<AuctionConfirmModalContent loan={loan} date={date} venue={v} />);
  }

  return (
    <>
      <div className="hd"><h3>Schedule Auction — {a.loan}</h3><button className="x" onClick={closeModal}>×</button></div>
      <div className="bd">
        <div className="notice" style={{ marginBottom: 16 }}>
          <Icon name="gavel" /> {a.cust} · {fmtW(a.weight)} gold · outstanding <b>{fmt(a.outstanding)}</b> · notice issued {a.notice}
        </div>
        <div className="frow c2">
          <div><label className="f">Auction Date *</label><input className="inp" type="date" min={today} value={date} onChange={(e) => setDate(e.target.value)} /></div>
          <div><label className="f">Venue</label><input className="inp" value={venue} onChange={(e) => setVenue(e.target.value)} /></div>
        </div>
        <p style={{ color: "var(--red)", fontSize: 12.5, minHeight: 16, marginTop: 8 }}>{err}</p>
      </div>
      <div className="ft">
        <button className="btn ghost" onClick={closeModal}>Cancel</button>
        <button className="btn" onClick={save}><Icon name="check" /> Schedule Auction</button>
      </div>
    </>
  );
}

function AuctionConfirmModalContent({ loan, date, venue }: { loan: string; date: string; venue: string }) {
  const { db } = useData();
  const { closeModal } = useModal();
  const toast = useToast();

  return (
    <>
      <div className="hd"><h3>Auction Scheduled — {loan}</h3><button className="x" onClick={closeModal}>×</button></div>
      <div className="bd">
        <div className="notice"><Icon name="shield" /> Auction scheduled for <b>{date}</b> at <b>{venue}</b>. Print the auction letter to notify the customer.</div>
      </div>
      <div className="ft">
        <button className="btn ghost" onClick={closeModal}>Close</button>
        <button className="btn" onClick={() => { closeModal(); printAuctionLetter(db, loan, toast); }}><Icon name="doc" /> Print Auction Letter</button>
      </div>
    </>
  );
}
