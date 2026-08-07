"use client";

import { useData } from "@/lib/DataProvider";
import { useModal } from "@/components/Modal";
import { useToast } from "@/components/Toast";
import { StatusChip } from "@/components/StatusChip";
import { Icon } from "@/lib/icons";
import { fmt, fmtW, custOf, schemeOf } from "@/lib/format";
import { PaymentModalContent } from "@/components/modals/PaymentModal";
import { RepledgeModalContent } from "@/components/modals/RepledgeModal";

const TRACK_STAGES = ["Loan Created", "Packet Generated", "Locker Stored", "Bank Pledged", "Returned", "Ready for Release", "Released"];

function readLegacyPhotos(loanId: string): Record<number, string> {
  if (typeof window === "undefined") return {};
  try {
    const all = JSON.parse(window.localStorage.getItem("agf_orn_photos") || "{}");
    return all[loanId] || {};
  } catch {
    return {};
  }
}

/* Ported from legacy/app.js's `renderLoanDetail(id)`. */
export function LoanDetail({ id }: { id?: string }) {
  const { db } = useData();
  const { openModal, closeModal } = useModal();
  const toast = useToast();

  const l = db.loans.find((x) => x.id === id);
  if (!l) return <div className="empty">Loan not found.</div>;

  const c = custOf(db, l.cust);
  const s = schemeOf(db, l.scheme);
  const orns = db.ornaments[l.id] || [];
  const led = db.ledger[l.id] || [];
  const legacyPhotos = readLegacyPhotos(l.id);
  const photoOf = (i: number) => orns[i]?.img || legacyPhotos[i] || null;

  function viewOrnImg(i: number) {
    openModal(
      <>
        <div className="hd"><h3>{orns[i].n} — {l!.id}</h3><button className="x" onClick={closeModal}>×</button></div>
        <div className="bd" style={{ textAlign: "center" }}>
          <img src={photoOf(i) || undefined} style={{ maxWidth: "100%", maxHeight: "70vh", borderRadius: 8 }} alt={orns[i].n} />
        </div>
      </>,
      true
    );
  }

  const doneUpto = l.status === "Closed" ? 7 : l.pledge === "Bank Pledged" ? 4 : l.packet === "—" ? 1 : l.status === "Auction Eligible" ? 3 : 3;

  return (
    <>
      <div className="page-h">
        <div><h1>{l.id} <StatusChip status={l.status} /></h1>
          <p><a href={`#customer/${c.id}`}>{c.name}</a> · {s.name} · opened {l.opened} · due {l.due}</p></div>
        <div className="sp" />
        {l.status === "Pending Approval" ? (
          <>
            <button className="btn" onClick={() => toast("Approved (demo) — moves to next sanction level in full build")}><Icon name="check" /> Approve</button>
            <button className="btn danger" onClick={() => toast("Rejected (demo)")}>Reject</button>
          </>
        ) : (
          <>
            <button className="btn ghost sm" onClick={() => toast("Receipt/statement PDF — full build")}><Icon name="doc" /> Statement</button>
            {l.status !== "Closed" && l.pledge !== "Bank Pledged" && (
              <button className="btn ghost sm" onClick={() => openModal(<RepledgeModalContent loanId={l.id} />)}><Icon name="bank" /> Repledge to Bank</button>
            )}
            {l.status !== "Closed" && (
              <button className="btn sm" onClick={() => openModal(<PaymentModalContent loanId={l.id} />)}><Icon name="coin" /> Record Payment</button>
            )}
          </>
        )}
      </div>
      <hr className="gold-rule" />

      <div className="grid cols21">
        <div className="grid">
          <div className="card gtop"><div className="hd"><h3>Pledged Ornaments — {fmtW(l.weight)} total</h3></div>
            <div className="tbl-wrap"><table className="tbl">
              <thead><tr><th>Ornament</th><th>Purity</th><th className="num">Gross (g)</th><th className="num">Net (g)</th><th className="num">Qty</th><th className="num">Gold Value</th><th style={{ textAlign: "center" }}>Photo</th></tr></thead>
              <tbody>
                {orns.map((o, i) => (
                  <tr key={o.n + i}>
                    <td>{o.n}</td><td><span className="chip gold">{o.purity}</span></td>
                    <td className="num">{o.gross.toFixed(1)}</td><td className="num">{o.net.toFixed(1)}</td>
                    <td className="num">{o.qty}</td><td className="num">{fmt(o.val)}</td>
                    <td style={{ textAlign: "center", whiteSpace: "nowrap" }}>
                      {photoOf(i) ? (
                        <>
                          <img src={photoOf(i)!} style={{ width: 34, height: 34, objectFit: "cover", borderRadius: 6, border: "1px solid var(--line)", cursor: "pointer", verticalAlign: "middle" }} title="View photo" onClick={() => viewOrnImg(i)} />
                          <button className="btn plain sm" style={{ padding: "4px 8px", verticalAlign: "middle" }} onClick={() => viewOrnImg(i)}>View</button>
                        </>
                      ) : (
                        <span style={{ color: "var(--muted)" }}>—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table></div>
            <div className="ft">Purity testing recorded by Anitha K · jewellery images linked to loan record</div></div>

          <div className="card"><div className="hd"><h3>Payment Ledger</h3></div>
            <div className="tbl-wrap"><table className="tbl">
              <thead><tr><th>Date</th><th>Description</th><th className="num">Debit</th><th className="num">Credit</th><th>Mode</th><th>Ref</th></tr></thead>
              <tbody>
                {led.length === 0 ? (
                  <tr><td colSpan={6} className="empty">No ledger entries recorded in this demo.</td></tr>
                ) : led.map((e, i) => (
                  <tr key={e.ref + i}>
                    <td>{e.d}</td><td>{e.desc}</td>
                    <td className="num">{e.debit ? fmt(e.debit) : "—"}</td>
                    <td className="num" style={{ color: "var(--green)" }}>{e.credit ? fmt(e.credit) : "—"}</td>
                    <td>{e.mode}</td><td style={{ color: "var(--muted)", fontSize: 12 }}>{e.ref}</td>
                  </tr>
                ))}
              </tbody>
            </table></div></div>

          <div className="card"><div className="hd"><h3>Gold Packet Tracking — {l.packet}</h3></div>
            <div className="bd"><div className="track">
              {TRACK_STAGES.map((st, i) => <div className={`st ${i < doneUpto ? "done" : ""}`} key={st}>{st}</div>)}
            </div></div>
            <div className="ft">Current location: <b>{l.locker}</b> · complete movement history maintained with employee &amp; timestamp</div></div>
        </div>

        <div className="grid">
          <div className="card gtop"><div className="hd"><h3>Financial Summary</h3></div>
            <div className="bd"><div className="kv" style={{ gridTemplateColumns: "1fr 1fr" }}>
              <div className="i"><div className="k">Principal</div><div className="v">{fmt(l.principal)}</div></div>
              <div className="i"><div className="k">Outstanding</div><div className="v" style={{ color: "var(--gold-deep)", fontWeight: 600 }}>{l.outstanding ? fmt(l.outstanding) : "—"}</div></div>
              <div className="i"><div className="k">Scheme Rate</div><div className="v">{s.rate}% p.a.</div></div>
              <div className="i"><div className="k">LTV</div><div className="v">{s.ltv}%</div></div>
              <div className="i"><div className="k">Interest Method</div><div className="v">{s.method}</div></div>
              <div className="i"><div className="k">Penal Interest</div><div className="v">{s.penal != null ? s.penal + "% / month" : "—"}</div></div>
            </div></div></div>
          <div className="card"><div className="hd"><h3>Bank Pledge</h3></div>
            <div className="bd">
              {l.pledge === "Bank Pledged" ? (
                <>
                  <div className="kv" style={{ gridTemplateColumns: "1fr 1fr" }}>
                    <div className="i"><div className="k">Bank</div><div className="v">{l.bank}</div></div>
                    <div className="i"><div className="k">Reference</div><div className="v">{l.bankRef}</div></div>
                    {l.pledgeDate && <div className="i"><div className="k">Pledged On</div><div className="v">{l.pledgeDate}</div></div>}
                    {l.pledgeAmt && <div className="i"><div className="k">Pledged Amount</div><div className="v">{fmt(l.pledgeAmt)}</div></div>}
                    <div className="i"><div className="k">Gold Covered</div><div className="v">{fmtW(l.weight)}</div></div>
                    <div className="i"><div className="k">Status</div><div className="v"><StatusChip status="Bank Pledged" /></div></div>
                  </div>
                  <div className="notice" style={{ marginTop: 12 }}><Icon name="shield" /> Closure requires bank release process first.</div>
                </>
              ) : (
                <p style={{ fontSize: 13.5, color: "var(--muted)" }}>
                  Gold is {l.pledge === "Released" ? "released to customer" : "held in-house"} — <StatusChip status={l.pledge} />
                </p>
              )}
            </div></div>
          <div className="card"><div className="hd"><h3>Settlement Preview</h3></div>
            <div className="bd" style={{ fontSize: 13.5 }}>
              <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0" }}><span>Principal</span><b>{fmt(l.principal)}</b></div>
              <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0" }}><span>Interest accrued</span><b>{fmt(Math.max(0, l.outstanding - l.principal))}</b></div>
              <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0" }}><span>Penal / charges</span><b>₹0</b></div>
              <div style={{ display: "flex", justifyContent: "space-between", padding: "8px 0 2px", borderTop: "1px dashed var(--line)", marginTop: 6 }}>
                <span style={{ fontWeight: 600 }}>Final settlement</span><b style={{ color: "var(--gold-deep)" }}>{l.outstanding ? fmt(l.outstanding) : "—"}</b></div>
            </div></div>
        </div>
      </div>
    </>
  );
}
