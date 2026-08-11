"use client";

import { useEffect, useState } from "react";
import { useModal } from "@/components/Modal";
import { Icon } from "@/lib/icons";
import { fmtW } from "@/lib/format";
import { StatusChip } from "@/components/StatusChip";
import { LockerModalContent } from "@/components/modals/LockerModal";
import { listLockers, type LockerView } from "@/lib/lockerApi";
import { listPackets, getPacketByCode, type PacketView } from "@/lib/packetApi";
import { ApiError } from "@/lib/api";

function LockerCard({ l, packets, onChanged }: { l: LockerView; packets: PacketView[]; onChanged: () => void }) {
  const { openModal } = useModal();
  const inLocker = packets.filter((p) => p.currentLockerId === l.id);

  return (
    <div className="card gtop">
      <div className="hd"><h3>{l.code}</h3><div className="sp" />
        <span className={`chip ${l.isActive ? "green" : "gray"}`}>{l.isActive ? "Active" : "Inactive"}</span>
        <button className="btn ghost sm" style={{ marginLeft: 8 }} onClick={() => openModal(<LockerModalContent key={l.id} locker={l} onSaved={onChanged} />)}>Edit</button>
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

  const [packets, setPackets] = useState<PacketView[] | null>(null);
  const [lockers, setLockers] = useState<LockerView[]>([]);
  const [error, setError] = useState("");
  const [lookup, setLookup] = useState("");
  const [lookupErr, setLookupErr] = useState("");

  async function load() {
    try {
      const [p, l] = await Promise.all([listPackets(), listLockers()]);
      setPackets(p);
      setLockers(l);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load packets.");
    }
  }

  useEffect(() => { load(); }, []);

  async function onLookup(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key !== "Enter") return;
    const code = lookup.trim().toUpperCase();
    if (!code) return;
    setLookupErr("");
    try {
      const p = await getPacketByCode(code);
      location.hash = `packet/${p.code}`;
    } catch (e) {
      setLookupErr(e instanceof ApiError ? e.message : `Packet "${code}" not found.`);
    }
  }

  return (
    <>
      <div className="page-h">
        <div><h1>Gold Packets &amp; Lockers</h1><p>Barcode/QR tracked packets · locker allocation &amp; movement</p></div>
        <div className="sp" />
        <button className="btn" onClick={() => openModal(<LockerModalContent key="new" onSaved={load} />)}><Icon name="plus" /> Add Locker</button>
      </div>
      <hr className="gold-rule" />
      <div className="frow" style={{ marginBottom: 16 }}>
        <div style={{ maxWidth: 360 }}>
          <label className="f">Enter or scan packet code</label>
          <input
            className="inp"
            placeholder="PKT-000123 (press Enter)"
            value={lookup}
            onChange={(e) => { setLookup(e.target.value); setLookupErr(""); }}
            onKeyDown={onLookup}
          />
          {lookupErr && <p style={{ color: "var(--red)", fontSize: 12.5, marginTop: 6 }}>{lookupErr}</p>}
        </div>
      </div>
      {error && (
        <p style={{ color: "var(--red)", fontSize: 13.5 }}>
          Could not reach the server — {error}
          <button className="btn plain sm" style={{ marginLeft: 8 }} onClick={load}>Retry</button>
        </p>
      )}
      <div className="grid cols21">
        <div className="card">
          <div className="hd"><h3>Packets</h3></div>
          <div className="tbl-wrap">
            <table className="tbl">
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
                  return (
                    <tr key={p.id}>
                      <td><a href={`#packet/${p.code}`} className="id">{p.code}</a></td>
                      <td><a href={`#loan/${p.loanNumber}`}>{p.loanNumber}</a></td>
                      <td>{p.customerName}</td>
                      <td className="num">{p.itemCount}</td>
                      <td className="num">{fmtW(p.totalWeight)}</td>
                      <td>{locker ? locker.code : "—"}</td>
                      <td><StatusChip status={p.status} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
        <div className="grid">
          {lockers.map((l) => <LockerCard key={l.id} l={l} packets={packets || []} onChanged={load} />)}
        </div>
      </div>
    </>
  );
}
