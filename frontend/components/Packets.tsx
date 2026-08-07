"use client";

import { useData } from "@/lib/DataProvider";
import { useModal } from "@/components/Modal";
import { useToast } from "@/components/Toast";
import { Icon } from "@/lib/icons";
import { fmtW } from "@/lib/format";
import { StatusChip } from "@/components/StatusChip";
import { LockerModalContent } from "@/components/modals/LockerModal";
import type { Locker } from "@/lib/data";

function LockerCard({ l }: { l: Locker }) {
  const { db, refresh } = useData();
  const toast = useToast();

  function remove() {
    const inUse = l.packets > 0 || db.packets.some((p) => p.locker === l.id) || db.loans.some((x) => x.locker === l.id);
    if (inUse) { toast(`${l.id} has packets assigned — move them out before removing`); return; }
    if (!window.confirm(`Remove locker ${l.id} (${l.branch})?`)) return;
    const result = db.removeLocker(l.id);
    if (!result.ok) { toast(result.error); return; }
    refresh();
    toast(`Locker ${l.id} removed`);
  }

  return (
    <div className="card gtop">
      <div className="hd"><h3>{l.id}</h3><div className="sp" /><span className="chip green">{l.status}</span>
        <button className="btn danger sm" style={{ marginLeft: 8, padding: "4px 9px" }} title="Remove locker" onClick={remove}>✕</button>
      </div>
      <div className="bd">
        <div className="kv" style={{ gridTemplateColumns: "1fr 1fr" }}>
          <div className="i"><div className="k">Branch</div><div className="v">{l.branch}</div></div>
          <div className="i"><div className="k">Packets</div><div className="v">{l.packets} / {l.cap}</div></div>
        </div>
        <div style={{ height: 7, background: "#efe7cd", borderRadius: 4, marginTop: 12, overflow: "hidden" }}>
          <div style={{ height: "100%", width: `${Math.max(4, (l.packets / l.cap) * 100)}%`, background: "linear-gradient(90deg,var(--gold-light),var(--gold-deep))" }} />
        </div>
      </div>
      <div className="ft">Check-in / check-out history maintained</div>
    </div>
  );
}

/* Ported from legacy/app.js's `renderPackets()`. */
export function Packets() {
  const { db } = useData();
  const { openModal } = useModal();
  const toast = useToast();

  return (
    <>
      <div className="page-h">
        <div><h1>Gold Packets &amp; Lockers</h1><p>Barcode/QR tracked packets · locker allocation &amp; movement</p></div>
        <div className="sp" />
        <button className="btn ghost" onClick={() => toast("Barcode scanner — full build")}><Icon name="scan" /> Scan Packet</button>
        <button className="btn" onClick={() => openModal(<LockerModalContent />)}><Icon name="plus" /> Add Locker</button>
      </div>
      <hr className="gold-rule" />
      <div className="grid cols21">
        <div className="card">
          <div className="hd"><h3>Packets</h3></div>
          <div className="tbl-wrap">
            <table className="tbl">
              <thead>
                <tr><th>Packet / QR</th><th>Loan</th><th>Customer</th><th className="num">Items</th><th className="num">Weight</th><th>Location</th><th>Status</th></tr>
              </thead>
              <tbody>
                {db.packets.map((p) => (
                  <tr key={p.id}>
                    <td><span className="id">{p.id}</span><span className="sub">▦ {p.qr}</span></td>
                    <td><a href={`#loan/${p.loan}`}>{p.loan}</a></td>
                    <td>{p.cust}</td>
                    <td className="num">{p.items}</td>
                    <td className="num">{fmtW(p.weight)}</td>
                    <td>{p.locker}</td>
                    <td><StatusChip status={p.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <div className="grid">
          {db.lockers.map((l) => <LockerCard key={l.id} l={l} />)}
        </div>
      </div>
    </>
  );
}
