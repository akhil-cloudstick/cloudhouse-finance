"use client";

import { useEffect, useRef, useState } from "react";
import { useModal } from "@/common/components/Modal";
import { Icon } from "@/common/components/Icon";
import { fmtW } from "@/common/utils/format";
import { StatusChip } from "@/common/components/ui/StatusChip";
import { LockerModalContent } from "@/common/components/modals/LockerModal";
import { listLockers, type LockerView } from "@/modules/lockers/services/lockerService";
import { listPacketsPage, getPacketByCode, type PacketView } from "@/modules/packets/services/packetService";
import { Select } from "@/common/components/ui/Select";
import { useAuth } from "@/common/auth-context";
import { useResponsivePageSize } from "@/common/utils/responsive";

/* Mirrors packet.Status* in backend/internal/packet/model.go. */
const PACKET_STATUS_OPTIONS = [
  { value: "", label: "All" },
  { value: "Packet Generated", label: "Packet Generated" },
  { value: "Locker Stored", label: "Locker Stored" },
  { value: "Bank Pledged", label: "Bank Pledged" },
  { value: "Ready For Release", label: "Ready For Release" },
  { value: "Released", label: "Released" },
  { value: "Returned", label: "Returned" },
];

function LockerCard({ l, packets, canUpdate, onChanged }: { l: LockerView; packets: PacketView[]; canUpdate: boolean; onChanged: () => void }) {
  const { openModal } = useModal();
  const inLocker = packets.filter((p) => p.currentLockerId === l.id);

  return (
    <div className="card gtop">
      <div className="hd"><h3>{l.code}</h3><div className="sp" />
        <span className={`chip ${l.isActive ? "green" : "gray"}`}>{l.isActive ? "Active" : "Inactive"}</span>
        {canUpdate && <button className="btn ghost sm" style={{ marginLeft: 8 }} onClick={() => openModal(<LockerModalContent key={l.id} locker={l} onSaved={onChanged} />)}>Edit</button>}
      </div>
      <div className="bd">
        <div className="kv" style={{ gridTemplateColumns: "1fr 1fr" }}>
          <div className="i"><div className="k">Branch</div><div className="v">{l.branchName}</div></div>
          <div className="i"><div className="k">Packets</div><div className="v">{l.occupied} / {l.capacity}</div></div>
        </div>
        <div style={{ height: 7, background: "#efe7cd", borderRadius: 4, marginTop: 12, overflow: "hidden" }}>
          <div style={{ height: "100%", width: `${Math.max(4, (l.occupied / Math.max(1, l.capacity)) * 100)}%`, background: "linear-gradient(90deg,var(--gold-light),var(--gold-deep))" }} />
        </div>
        {inLocker.length > 0 && (
          <ul style={{ margin: "10px 0 0", padding: 0, listStyle: "none", fontSize: 12.5 }}>
            {inLocker.map((p) => (
              <li key={p.id} style={{ padding: "3px 0", borderTop: "1px dashed #e6dcb8" }}>
                <a href={`#packet/${p.code}`}>{p.code}</a> — {p.loanNumber} · {p.customerName}
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="ft">Check-in / check-out history maintained per packet</div>
    </div>
  );
}

/* Ported from legacy/app.js's `renderPackets()`. Now reads real data from
 * the Go backend (`GET /api/v1/packets`, `GET /api/v1/lockers`) instead of
 * synthesizing packet rows from the loan list — see backend/internal/packet
 * and backend/internal/locker. */
export function Packets() {
  const { openModal } = useModal();
  // Lockers are their own module in the permission catalogue, separate from
  // the packets stored in them — hidden, not disabled, when not granted
  // (see Customers.tsx).
  const { can } = useAuth();
  const canCreateLockers = can("Locker_Management", "can_create_locker");
  const canUpdateLockers = can("Locker_Management", "can_update_locker");

  const pageSize = useResponsivePageSize(11, 7);
  const [packets, setPackets] = useState<PacketView[] | null>(null);
  const [lockers, setLockers] = useState<LockerView[]>([]);
  const [error, setError] = useState("");
  const [lookup, setLookup] = useState("");
  const [lookupErr, setLookupErr] = useState("");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [status, setStatus] = useState("");
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  /* Guards against an out-of-order response winning: switching status
   * quickly can leave an earlier, slower request in flight, and without
   * this its rows would overwrite the newer filter's. Only the newest
   * request may write. Same pattern as Cash.tsx's summarySeq. */
  const loadSeq = useRef(0);

  // Debounced from the same search box `lookup` feeds — typing filters the
  // table (packet code, loan number, OR customer name, see backend's
  // packet.Filter.Q) the same way Loans.tsx's search box does, while Enter
  // still jumps straight to a packet if `lookup` is its exact code (the
  // barcode-scanner flow below).
  const [q, setQ] = useState("");
  useEffect(() => {
    const handle = setTimeout(() => setQ(lookup.trim()), 300);
    return () => clearTimeout(handle);
  }, [lookup]);

  async function load() {
    const seq = ++loadSeq.current;
    try {
      const [p, l] = await Promise.all([
        listPacketsPage(page, { status: status || undefined, q: q || undefined }, pageSize),
        listLockers(),
      ]);
      if (seq !== loadSeq.current) return;
      setPackets(p.items);
      setTotal(p.total);
      setLockers(l);
      setError("");
    } catch (e) {
      if (seq !== loadSeq.current) return;
      setError(e instanceof Error ? e.message : "Failed to load packets.");
    }
  }

  useEffect(() => { load(); }, [page, status, q, pageSize]);
  // A new search term always starts back at page 1 — otherwise a filter
  // typed while sitting on page 3 can land on an empty page.
  useEffect(() => { setPage(1); }, [q]);

  async function onLookup(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key !== "Enter") return;
    const code = lookup.trim().toUpperCase();
    if (!code) return;
    setLookupErr("");
    try {
      const p = await getPacketByCode(code);
      location.hash = `packet/${p.code}`;
    } catch {
      // Not an exact packet code — that's fine, the live `q` filter above
      // already narrowed the table to whatever matched; only complain when
      // it found nothing there either.
      if ((packets || []).length === 0) {
        setLookupErr(`No packets match "${lookup.trim()}".`);
      }
    }
  }

  return (
    <>
      <div className="page-h">
        <div><h1>Gold Packets &amp; Lockers</h1><p>Barcode/QR tracked packets · locker allocation &amp; movement</p></div>
        <div className="sp" />
        <div className="search"><Icon name="search" /><input
          className="inp"
          placeholder="Search packet code, loan number, or customer — or scan a code (Enter)"
          value={lookup}
          onChange={(e) => { setLookup(e.target.value); setLookupErr(""); }}
          onKeyDown={onLookup}
        /></div>
        {canCreateLockers && <button className="btn" onClick={() => openModal(<LockerModalContent key="new" onSaved={load} />)}><Icon name="plus" /> Add Locker</button>}
      </div>
      {lookupErr && <p style={{ color: "var(--red)", fontSize: 12.5, marginTop: -4, marginBottom: 8 }}>{lookupErr}</p>}
      <hr className="gold-rule" style={{ margin: "4px 0 18px" }} />
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "flex-end", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
        <div style={{ width: 200 }}>
          <label style={{ fontSize: 11.5, color: "var(--muted)", display: "block", marginBottom: 4 }}>Status</label>
          {/* setPage in the same handler (not a separate effect keyed on
              status) so React batches both into one render — a status change
              therefore issues exactly one request, not one for the old page
              followed by another for page 1. */}
          <Select
            options={PACKET_STATUS_OPTIONS}
            value={status}
            onChange={(v) => { setStatus(v); setPage(1); }}
          />
        </div>
      </div>
      {error && (
        <p style={{ color: "var(--red)", fontSize: 13.5 }}>
          Something went wrong. Please try again later.
        </p>
      )}
      <div className="grid cols21">
        <div className="card tbl-card">
          <div className="hd"><h3>Packets</h3></div>
          <div className="tbl-wrap tbl-wrap-3row">
            <table className="tbl tbl-center">
              <thead>
                <tr><th>Packet Code</th><th>Loan</th><th>Customer</th><th className="num">Items</th><th className="num">Weight</th><th>Locker</th><th>Status</th></tr>
              </thead>
              <tbody>
                {packets === null && !error && (
                  <tr><td colSpan={7} style={{ color: "var(--muted)" }}>Loading packets…</td></tr>
                )}
                {packets !== null && packets.length === 0 && (
                  <tr><td colSpan={7} style={{ color: "var(--muted)" }}>No packets yet — packets are created automatically when a loan is opened.</td></tr>
                )}
                {(packets || []).map((p) => {
                  const locker = lockers.find((l) => l.id === p.currentLockerId);
                  // The loan's own outcome overrides the packet's own
                  // (possibly stale) workflow stage once the gold has been
                  // sold — same override PacketDetail.tsx applies.
                  const displayStatus = p.loanStatus === "Auctioned" || p.loanStatus === "Auctioned - Balance Due" ? "Auctioned" : p.status;
                  return (
                    <tr key={p.id} className="click" onClick={() => { location.hash = `packet/${p.code}`; }}>
                      <td><a href={`#packet/${p.code}`} className="id" onClick={(e) => e.stopPropagation()}>{p.code}</a></td>
                      <td><a href={`#loan/${p.loanNumber}`} onClick={(e) => e.stopPropagation()}>{p.loanNumber}</a></td>
                      <td>{p.customerName}</td>
                      <td className="num">{p.itemCount}</td>
                      <td className="num">{fmtW(p.totalWeight)}</td>
                      <td>{locker ? locker.code : "—"}</td>
                      <td><StatusChip status={displayStatus} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="ft" style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <button className="btn plain sm" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>‹ Prev</button>
            <span style={{ fontSize: 12.5 }}>Page {page} of {totalPages}</span>
            <button className="btn plain sm" disabled={page >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))}>Next ›</button>
          </div>
        </div>
        {/* Packets (left) is now capped to its own natural 3-row height
            (.tbl-wrap-3row) rather than stretching to match this column, so
            the two no longer share one mirrored height — this is just a
            plain, independently-scrolling box capped to show about 1.5
            locker cards before it scrolls, the same way .tbl-wrap-3row caps
            the table beside it. scroll-hidden keeps its scrollbar invisible. */}
        <div className="grid scroll-hidden locker-col" style={{ alignContent: "start" }}>
          {lockers.length === 0 ? (
            <div className="empty" style={{ padding: "14px 4px" }}>
              {packets === null && !error ? "Loading lockers…" : "No lockers added yet."}
            </div>
          ) : (
            lockers.map((l) => <LockerCard key={l.id} l={l} packets={packets || []} canUpdate={canUpdateLockers} onChanged={load} />)
          )}
        </div>
      </div>
    </>
  );
}
