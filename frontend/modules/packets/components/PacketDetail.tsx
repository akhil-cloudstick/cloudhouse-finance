"use client";

import { useEffect, useState } from "react";
import { useToast } from "@/common/components/Toast";
import { useModal } from "@/common/components/Modal";
import { useAuth } from "@/common/auth-context";
import { SearchableSelect } from "@/common/components/ui/SearchableSelect";
import { StatusChip } from "@/common/components/ui/StatusChip";
import { Icon } from "@/common/components/Icon";
import { fmt, fmtW } from "@/common/utils/format";
import { ApiError } from "@/common/services/httpClient";
import { listLockers, searchLockersPage, type LockerView } from "@/modules/lockers/services/lockerService";
import { getLoanByNumber, canAcceptBankPledge } from "@/modules/loans/services/loanService";
import { RepledgeModalContent } from "@/common/components/modals/RepledgeModal";
import {
  getPacketByCode, listMovements, recordMovement, PACKET_STAGES, PACKET_STATUS,
  type PacketView, type MovementView,
} from "@/modules/packets/services/packetService";

/* Hardcoded actor id — this codebase has no auth/session yet, so every
 * staff-attributed action across the app (loan approvals, payments) uses
 * employeeId 1 as a placeholder until real auth exists (see NewLoan.tsx /
 * RepledgeModal.tsx). Packet movements follow the same convention. */
const ACTOR_EMPLOYEE_ID = 1;

function Stepper({ status }: { status: string }) {
  const idx = PACKET_STAGES.indexOf(status);
  return (
    <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 4, margin: "12px 0 20px" }}>
      {PACKET_STAGES.map((stage, i) => (
        <div key={stage} style={{ display: "flex", alignItems: "center" }}>
          <div
            style={{
              padding: "5px 11px", borderRadius: 999, fontSize: 12, whiteSpace: "nowrap",
              background: i <= idx ? "linear-gradient(90deg,var(--brand-mid),var(--brand-deep))" : "var(--brand-pale)",
              color: i <= idx ? "#fff" : "var(--muted)",
              fontWeight: i === idx ? 700 : 500,
              border: i === idx ? "2px solid var(--brand-deep)" : "none",
            }}
          >
            {stage}
          </div>
          {i < PACKET_STAGES.length - 1 && <div style={{ width: 18, height: 2, background: i < idx ? "var(--brand-deep)" : "var(--line)" }} />}
        </div>
      ))}
    </div>
  );
}

/* Packet detail view — mirrors CustomerDetail.tsx / LoanDetail.tsx's
 * id-driven load pattern, routed via #packet/<code> (see routes.ts /
 * app/app/page.tsx). Shows the 6-stage lifecycle stepper, full movement
 * history, and the staff action buttons that drive
 * POST /packets/:id/movements. */
export function PacketDetail({ code }: { code?: string }) {
  const toast = useToast();
  const { openModal } = useModal();
  const { can } = useAuth();

  const canCreateBankPledge = can("Bank_Pledge_Management", "can_create_bank_pledge");
  // Every packet movement (check-in, ready-for-release, released) writes to
  // the packet, so they all need "can update packet" — hidden, not disabled,
  // without it (see Customers.tsx).
  const canMovePackets = can("Packet_Management", "can_update_packet");

  const [p, setP] = useState<PacketView | null>(null);
  const [movements, setMovements] = useState<MovementView[]>([]);
  const [lockers, setLockers] = useState<LockerView[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [pickLocker, setPickLocker] = useState(false);
  const [lockerId, setLockerId] = useState<number | "">("");

  async function load() {
    if (!code) return;
    setError("");
    try {
      const pkt = await getPacketByCode(code);
      setP(pkt);
      const [mv, lk] = await Promise.all([listMovements(pkt.id), listLockers()]);
      setMovements(mv);
      setLockers(lk);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to load packet.");
    }
  }

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [code]);

  // Bank-pledging a packet's gold is a real transaction (bank, amount, cash
  // treatment) — not a bare stepper move. This opens the same RepledgeModal
  // used from the loan page / Bank Re-Pledge page; recordBankPledge() moves
  // the packet to "Bank Pledged" itself server-side (see
  // PacketMover.RecordBankPledgeMovement), so there is no separate doMove
  // call here.
  async function openBankPledge() {
    if (!p) return;
    setBusy(true);
    try {
      const loan = await getLoanByNumber(p.loanNumber);
      // The packet being in a locker isn't sufficient on its own — the loan
      // must also still be pledgeable (not closed/released/auctioned, and
      // its one bank pledge unused). Checked here rather than only on the
      // button because the loan is not loaded until this click.
      if (!canAcceptBankPledge(loan.status, loan.bankPledgeStatus)) {
        toast("This loan can no longer be re-pledged to a bank.");
        return;
      }
      openModal(<RepledgeModalContent loan={loan} onSaved={load} />, true);
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Could not load the loan — try again.");
    } finally {
      setBusy(false);
    }
  }

  async function doMove(toStatus: string, extraLockerId?: number) {
    if (!p) return;
    setBusy(true);
    try {
      await recordMovement(p.id, { toStatus, lockerId: extraLockerId, employeeId: ACTOR_EMPLOYEE_ID });
      toast(`Packet ${p.code} moved to "${toStatus}"`);
      setPickLocker(false);
      setLockerId("");
      await load();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Could not record the movement — try again.");
    } finally {
      setBusy(false);
    }
  }

  if (error) {
    return <p style={{ color: "var(--red)", fontSize: 13.5 }}>Could not load packet — {error}</p>;
  }
  if (!p) {
    return <p style={{ color: "var(--muted)", fontSize: 13.5 }}>Loading packet…</p>;
  }

  const currentLocker = lockers.find((l) => l.id === p.currentLockerId);
  // Once the loan is Auctioned/AuctionedBalanceDue/Closed, the gold has
  // already left custody (sold or released) — no further packet movement
  // is possible (the backend rejects it too, see packet.
  // loanNoLongerMovableStatuses), and the packet's own workflow stage
  // (e.g. still "Locker Stored" from before the sale) is no longer the
  // meaningful status to show: the loan's own outcome overrides it.
  const isAuctioned = p.loanStatus === "Auctioned" || p.loanStatus === "Auctioned - Balance Due";
  const movementLocked = isAuctioned || p.loanStatus === "Closed";
  const displayStatus = isAuctioned ? "Auctioned" : p.status;

  return (
    <>
      <div className="page-h">
        <div><h1>Packet {p.code}</h1><p>Loan {p.loanNumber} · {p.customerName}</p></div>
        <div className="sp" />
        <StatusChip status={displayStatus} />
      </div>
      <hr className="gold-rule" />
      {/* "Auctioned" isn't one of PACKET_STAGES — the packet's workflow is
        * moot once the gold has been sold, so the stepper (which would
        * otherwise render every stage as not-yet-reached) is skipped in
        * favor of a plain explanatory line. */}
      {isAuctioned ? (
        <p style={{ color: "var(--muted)", fontSize: 13.5, margin: "12px 0 20px" }}>
          This loan&apos;s gold was sold at auction — the packet&apos;s locker workflow no longer applies.
        </p>
      ) : (
        <Stepper status={displayStatus} />
      )}

      <div className="grid cols21">
        <div className="grid">
        {/* What is physically sealed inside this packet — the pledged
            ornaments of the loan it belongs to. Staff opening a locker need
            to check the packet against this list, so it belongs here and not
            only on the loan page. */}
        <div className="card gtop">
          <div className="hd"><h3>Contents of the Packet — {p.itemCount} item(s) · {fmtW(p.totalWeight)}</h3></div>
          <div className="tbl-wrap">
            <table className="tbl">
              <thead><tr><th>Ornament</th><th>Purity</th><th className="num">Gross (g)</th><th className="num">Net (g)</th><th className="num">Qty</th><th className="num">Gold Value</th><th>Remarks</th></tr></thead>
              <tbody>
                {p.items.length === 0 && <tr><td colSpan={7} style={{ color: "var(--muted)" }}>No ornaments recorded on this loan.</td></tr>}
                {p.items.map((it) => (
                  <tr key={it.id}>
                    <td>{it.name}</td>
                    <td><span className="chip brand">{it.purity}</span></td>
                    <td className="num">{it.grossWeight.toFixed(1)}</td>
                    <td className="num">{it.netWeight.toFixed(1)}</td>
                    <td className="num">{it.quantity}</td>
                    <td className="num">{fmt(it.goldValue)}</td>
                    <td>{it.remarks || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="ft">
            Sealed contents of packet {p.code}, taken from loan{" "}
            <a href={`#loan/${p.loanNumber}`}>{p.loanNumber}</a> — ornament photos are on the loan page.
          </div>
        </div>

        <div className="card">
          <div className="hd"><h3>Movement History</h3></div>
          <div className="tbl-wrap">
            <table className="tbl">
              <thead><tr><th>Date/Time</th><th>From</th><th>To</th><th>Locker</th><th>Employee</th><th>Remarks</th></tr></thead>
              <tbody>
                {movements.length === 0 && <tr><td colSpan={6} style={{ color: "var(--muted)" }}>No movements yet.</td></tr>}
                {movements.map((m) => {
                  const lk = lockers.find((l) => l.id === m.lockerId);
                  return (
                    <tr key={m.id}>
                      <td>{new Date(m.createdAt).toLocaleString("en-IN")}</td>
                      <td>{m.fromStatus || "—"}</td>
                      <td>{m.toStatus}</td>
                      <td>{lk ? lk.code : "—"}</td>
                      <td>{m.actorEmployeeId ? `EMP-${m.actorEmployeeId}` : "System"}</td>
                      <td>{m.remarks || "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
        </div>

        <div className="card">
          <div className="hd"><h3>Details</h3></div>
          <div className="bd">
            <div className="kv" style={{ gridTemplateColumns: "1fr" }}>
              <div className="i"><div className="k">Items / Weight</div><div className="v">{p.itemCount} item(s) · {fmtW(p.totalWeight)}</div></div>
              <div className="i"><div className="k">Branch</div><div className="v">{p.branchName}</div></div>
              <div className="i"><div className="k">Current Locker</div><div className="v">{currentLocker ? currentLocker.code : "—"}</div></div>
            </div>

            <hr className="gold-rule" style={{ margin: "16px 0" }} />

            {!movementLocked && canMovePackets && (p.status === PACKET_STATUS.GENERATED || p.status === PACKET_STATUS.RETURNED) && !pickLocker && (
              <button className="btn" disabled={busy} onClick={() => setPickLocker(true)}><Icon name="lock" /> Check In to Locker</button>
            )}
            {!movementLocked && pickLocker && (
              <div className="frow" style={{ marginBottom: 10 }}>
                <div style={{ flex: 1 }}>
                  <label className="f">Select locker</label>
                  {/* Server-side paginated + searched (5 per page, loads more
                    * as you scroll near the bottom) instead of a plain
                    * <select> over every locker at once — see
                    * lockerService.ts's searchLockersPage. Full lockers are
                    * filtered out of each page rather than shown disabled.
                    * Deliberately NOT scoped to the packet's own branch (the
                    * old plain <select> was) — a branch with no locker of
                    * its own would otherwise leave staff with nothing to
                    * pick; showing every active locker lets them check gold
                    * into whichever one is actually available. The branch
                    * mismatch is visible in the label below. */}
                  <SearchableSelect<LockerView>
                    value=""
                    placeholder="Search locker code…"
                    fetchFn={(q, page) =>
                      searchLockersPage(q, page, { activeOnly: true }).then((res) => ({
                        items: res.items.filter((l) => l.occupied < l.capacity),
                        hasMore: res.hasMore,
                      }))
                    }
                    getId={(l) => String(l.id)}
                    getLabel={(l) => `${l.code} (${l.occupied}/${l.capacity})${l.branchId !== p.branchId ? ` · ${l.branchName}` : ""}`}
                    onChange={(id) => setLockerId(id ? Number(id) : "")}
                  />
                </div>
                <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
                  <button className="btn ghost sm" onClick={() => setPickLocker(false)}>Cancel</button>
                  <button className="btn sm" disabled={busy || lockerId === ""} onClick={() => doMove(PACKET_STATUS.LOCKER_STORED, Number(lockerId))}>Confirm Check-In</button>
                </div>
              </div>
            )}

            {!movementLocked && canMovePackets && p.status === PACKET_STATUS.LOCKER_STORED && (
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {canCreateBankPledge && (
                  <button className="btn ghost" disabled={busy} onClick={openBankPledge}><Icon name="bank" /> Repledge to Bank</button>
                )}
                <button className="btn" disabled={busy} onClick={() => doMove(PACKET_STATUS.RELEASED)}><Icon name="check" /> Mark Released</button>
              </div>
            )}

            {!movementLocked && canMovePackets && p.status === PACKET_STATUS.READY_FOR_RELEASE && (
              <button className="btn" disabled={busy} onClick={() => doMove(PACKET_STATUS.RELEASED)}><Icon name="check" /> Mark Released</button>
            )}

            {!isAuctioned && p.status === PACKET_STATUS.BANK_PLEDGED && (
              <p style={{ color: "var(--muted)", fontSize: 12.5 }}>
                Gold is currently pledged with a bank — use the loan&apos;s Bank Pledge release action to bring it back (that automatically moves this packet to &quot;Returned&quot;).
              </p>
            )}

            {!isAuctioned && p.status === PACKET_STATUS.RELEASED && (
              <p style={{ color: "var(--muted)", fontSize: 12.5 }}>This packet has been released to the customer — no further actions.</p>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
