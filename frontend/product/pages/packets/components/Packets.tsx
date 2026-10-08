"use client";

import { useEffect, useRef, useState } from "react";
import { useModal } from "@/product/components/Modal";
import { Icon } from "@/product/components/Icon";
import { fmtW } from "@/product/utils/format";
import { StatusChip } from "@/product/components/ui/StatusChip";
import { LockerModalContent } from "@/product/components/modals/LockerModal";
import { listLockers, type LockerView } from "@/product/pages/lockers/services/lockerService";
import { listPackets, listPacketsPage, getPacketByCode, type PacketView } from "@/product/pages/packets/services/packetService";
import { Select } from "@/product/components/ui/Select";
import { useAuth } from "@/product/providers/auth-context";
import { useResponsivePageSize } from "@/product/utils/responsive";
import { navigate, routeHref } from "@/product/services/appRoutes";
import { useCanOpenRoute } from "@/product/hooks/useCanOpenRoute";

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

function LockerCard({ l, canUpdate, onChanged }: { l: LockerView; canUpdate: boolean; onChanged: () => void }) {
  const { openModal } = useModal();
  // Loaded per locker (GET /packets?lockerId=) rather than filtered out of the
  // table's current page — the table is paginated, so that only ever showed
  // the packets that happened to be on the page being viewed. `l.occupied`
  // changes on check-in/out, which re-runs this.
  const [inLocker, setInLocker] = useState<PacketView[]>([]);
  useEffect(() => {
    let cancelled = false;
    listPackets({ lockerId: l.id })
      .then((ps) => { if (!cancelled) setInLocker(ps); })
      .catch(() => { if (!cancelled) setInLocker([]); });
    return () => { cancelled = true; };
  }, [l.id, l.occupied]);

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
        <div style={{ height: 7, background: "var(--brand-pale)", borderRadius: 4, marginTop: 12, overflow: "hidden" }}>
          <div style={{ height: "100%", width: `${Math.max(4, (l.occupied / Math.max(1, l.capacity)) * 100)}%`, background: "linear-gradient(90deg,var(--brand-mid),var(--brand-deep))" }} />
        </div>
        {inLocker.length > 0 && (
          <ul style={{ margin: "10px 0 0", padding: 0, listStyle: "none", fontSize: 12.5 }}>
            {inLocker.map((p) => (
              <li key={p.id} style={{ padding: "3px 0", borderTop: "1px dashed var(--line)" }}>
                <a href={routeHref(`packet/${p.code}`)}>{p.code}</a> — {p.loanNumber} · {p.customerName}
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
  const canOpen = useCanOpenRoute();
  // A link inside a clickable row: stopping propagation keeps the row's own
  // onClick from firing, but also keeps the click from AppShell's link
  // interceptor — so navigate here (through the permission guard) instead of
  // letting the browser do a full page load. Same rules as LedgerRefLink.
  const cellLink = (to: string) => (e: React.MouseEvent) => {
    e.stopPropagation();
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    navigate(to);
  };
  const canCreateLockers = can("Locker_Management", "can_create_locker");
  const canUpdateLockers = can("Locker_Management", "can_update_locker");

  const pageSize = useResponsivePageSize(15, 15);
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

  // The locker column is independent of the table: it loads once (and after a
  // locker is added/edited), never on a page/status/search change.
  async function loadLockers() {
    try {
      setLockers(await listLockers());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load lockers.");
    }
  }

  async function loadPackets() {
    const seq = ++loadSeq.current;
    try {
      const p = await listPacketsPage(page, { status: status || undefined, q: q || undefined }, pageSize);
      if (seq !== loadSeq.current) return;
      setPackets(p.items);
      setTotal(p.total);
      setError("");
    } catch (e) {
      if (seq !== loadSeq.current) return;
      setError(e instanceof Error ? e.message : "Failed to load packets.");
    }
  }

  function load() {
    loadLockers();
    loadPackets();
  }

  useEffect(() => { loadLockers(); }, []);
  useEffect(() => { loadPackets(); }, [page, status, q, pageSize]);
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
      navigate(`packet/${p.code}`);
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
          title="Searches: packet code, loan number, customer name, customer code, locker code · scan or type an exact packet code and press Enter to open it"
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
      <div className="grid cols21 packets-grid">
        <div className="card tbl-card tbl-card-fill">
          <div className="hd"><h3>Packets</h3></div>
          <div className="tbl-wrap">
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
                    <tr key={p.id} className="click" onClick={() => { navigate(`packet/${p.code}`); }}>
                      <td><a href={routeHref(`packet/${p.code}`)} className="id" onClick={cellLink(`packet/${p.code}`)}>{p.code}</a></td>
                      <td>{canOpen("loan") ? <a href={routeHref(`loan/${p.loanNumber}`)} onClick={cellLink(`loan/${p.loanNumber}`)}>{p.loanNumber}</a> : p.loanNumber}</td>
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
        {/* Packets (left) now fills down to the page's consistent bottom
            gap like every other table card (.tbl-card-fill), and this
            locker column stretches to match it height-for-height
            (.packets-grid's align-items:stretch) instead of capping itself
            to its own calc(100vh-350px) guess. scroll-hidden keeps its
            scrollbar invisible while it scrolls internally past that
            shared height. */}
        <div className="grid scroll-hidden locker-col" style={{ alignContent: "start" }}>
          {lockers.length === 0 ? (
            <div className="empty" style={{ padding: "14px 4px" }}>
              {packets === null && !error ? "Loading lockers…" : "No lockers added yet."}
            </div>
          ) : (
            lockers.map((l) => <LockerCard key={l.id} l={l} canUpdate={canUpdateLockers} onChanged={load} />)
          )}
        </div>
      </div>
    </>
  );
}
