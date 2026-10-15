"use client";

import { useEffect, useState } from "react";
import { useModal } from "@/common/components/ModalProvider";
import { StatusChip } from "@/common/components/ui/StatusChip";
import { useShowBranch } from "@/common/hooks/use-branch-switch";
import { fmtW } from "@/common/utils/format";
import { navigate } from "@/common/services/appRoutes";
import { listPackets } from "@/modules/packets/services/packetService";
import { type PacketView } from "@/modules/packets/types/packet-types";
import { type LockerView } from "@/modules/lockers/types/locker-types";
import { LockerModalContent } from "@/modules/packets/components/LockerModalContent";

type LockerDetailModalContentProps = { locker: LockerView; canUpdate: boolean; onChanged: () => void };

/* Opened from a row of the Lockers table on the Packets & Lockers page:
 * the locker's own details plus the packets currently stored in it. Packets
 * are loaded per locker (GET /packets?lockerId=) rather than filtered out of
 * the packets table's current page, which is paginated. */
export function LockerDetailModalContent({ locker, canUpdate, onChanged }: LockerDetailModalContentProps) {
  const { openModal, closeModal } = useModal();
  const showBranch = useShowBranch();
  const [packets, setPackets] = useState<PacketView[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    listPackets({ lockerId: locker.id })
      .then((ps) => { if (!cancelled) setPackets(ps); })
      .catch(() => { if (!cancelled) setPackets([]); });
    return () => { cancelled = true; };
  }, [locker.id, locker.occupied]);

  const pct = Math.min(100, Math.max(4, (locker.occupied / Math.max(1, locker.capacity)) * 100));

  return (
    <>
      <div className="hd"><h3>Locker — {locker.code}</h3><button className="x" onClick={closeModal}>×</button></div>
      <div className="bd bd-scroll">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 14, marginBottom: 10 }}>
          <div><label className="f">Status</label><span className={`chip ${locker.isActive ? "green" : "gray"}`}>{locker.isActive ? "Active" : "Inactive"}</span></div>
          <div><label className="f">Packets</label><div>{locker.occupied} / {locker.capacity}</div></div>
          {showBranch && <div><label className="f">Branch</label><div>{locker.branchName}</div></div>}
        </div>
        <div style={{ height: 7, background: "var(--brand-pale)", borderRadius: 4, margin: "4px 0 16px", overflow: "hidden" }}>
          <div style={{ height: "100%", width: `${pct}%`, background: "linear-gradient(90deg,var(--brand-mid),var(--brand-deep))" }} />
        </div>
        <label className="f">Packets in this locker</label>
        <div className="tbl-wrap">
          <table className="tbl tbl-center" style={{ minWidth: 0 }}>
            <thead><tr><th>Packet</th><th>Loan</th><th>Customer</th><th className="num">Weight</th><th>Status</th></tr></thead>
            <tbody>
              {packets === null && <tr><td colSpan={5} style={{ color: "var(--muted)" }}>Loading packets…</td></tr>}
              {packets !== null && packets.length === 0 && <tr><td colSpan={5} style={{ color: "var(--muted)" }}>No packets in this locker.</td></tr>}
              {(packets || []).map((p) => (
                <tr key={p.id} className="click" onClick={() => { closeModal(); navigate(`packet/${p.code}`); }}>
                  <td><span className="id">{p.code}</span></td>
                  <td>{p.loanNumber}</td>
                  <td>{p.customerName}</td>
                  <td className="num">{fmtW(p.totalWeight)}</td>
                  <td><StatusChip status={p.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div className="ft">
        <button className="btn ghost" onClick={closeModal}>Close</button>
        {canUpdate && <button className="btn" onClick={() => openModal(<LockerModalContent key={locker.id} locker={locker} onSaved={onChanged} />)}>Edit</button>}
      </div>
    </>
  );
}
