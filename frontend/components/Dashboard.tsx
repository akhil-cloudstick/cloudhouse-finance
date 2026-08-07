"use client";

import { useState } from "react";
import { useData } from "@/lib/DataProvider";
import { useModal } from "@/components/Modal";
import { fmt } from "@/lib/format";
import { Icon } from "@/lib/icons";
import { RateModalContent } from "@/components/modals/RateModal";
import { RegisterCustomerModalContent } from "@/components/modals/RegisterCustomerModal";

function Kpi({ l, v, s, cls }: { l: string; v: string | number; s?: string; cls?: string }) {
  return (
    <div className={`kpi ${cls || ""}`}>
      <div className="l">{l}</div>
      <div className="v">{v}</div>
      <div className="s">{s || ""}</div>
    </div>
  );
}

function RateTile({ k, r }: { k: string; r: number }) {
  return (
    <div className="rate-tile">
      <div className="k">{k}</div>
      <div className="r">{fmt(r)}</div>
      <div className="u">per gram</div>
    </div>
  );
}

function Donut({ parts }: { parts: [string, number, string][] }) {
  const total = parts.reduce((s, p) => s + p[1], 0);
  let acc = 0;
  const stops = parts.map((p) => {
    const a = (acc / total) * 360;
    acc += p[1];
    return `${p[2]} ${a}deg ${(acc / total) * 360}deg`;
  }).join(",");

  return (
    <div className="donut-wrap">
      <div className="donut" style={{ background: `conic-gradient(${stops})` }}>
        <div className="c"><b>{fmt(total)}</b><small>total</small></div>
      </div>
      <ul className="legend">
        {parts.map((p) => (
          <li key={p[0]}><i style={{ background: p[2] }} />{p[0]}<b>{fmt(p[1])}</b></li>
        ))}
      </ul>
    </div>
  );
}

const BAR_DATA: [string, number][] = [["Feb", 6.2], ["Mar", 7.4], ["Apr", 5.9], ["May", 8.1], ["Jun", 7.2], ["Jul", 9.3]];
const REMINDERS: [string, string, string][] = [
  ["GL-2044 interest due", "Lakshmi Menon · 02 Aug", "due"],
  ["Follow-up: Thomas George", "Auction notice discussion · 07 Aug", "fup"],
  ["GL-2035 interest due", "Ananya Pillai · 12 Aug", "due"],
  ["PTP: Suresh Kumar", "Promised ₹4,200 · 15 Aug", "fup"],
];
const EXPENSE_PARTS: [string, number, string][] = [
  ["Salaries", 96000, "#9a6f0f"],
  ["Rent & Utilities", 18500, "#d4af37"],
  ["Marketing", 7500, "#3b5f7a"],
  ["Others", 5470, "#b3a980"],
];

/* Ported from legacy/app.js's `renderDashboard()`. The header subtitle and
 * "today" comparisons keep the legacy prototype's hardcoded demo date
 * ('2026-07-30') rather than switching to the real current date. */
export function Dashboard() {
  const { db } = useData();
  const { openModal } = useModal();

  const active = db.loans.filter((l) => ["Active", "Due Soon", "Overdue"].includes(l.status));
  const overdue = db.loans.filter((l) => l.status === "Overdue");
  const dueSoon = db.loans.filter((l) => l.status === "Due Soon");
  const pledged = db.loans.filter((l) => l.pledge === "Bank Pledged");
  const outstanding = active.reduce((s, l) => s + l.outstanding, 0);
  const pendingReq = db.requests.filter((r) => r.status === "Pending");
  const expToday = db.expenses.filter((e) => e.d === "2026-07-30").reduce((s, e) => s + e.amt, 0);
  const openedToday = db.loans.filter((l) => l.opened === "2026-07-30").length;

  const [calcW, setCalcW] = useState("10");
  const [calcP, setCalcP] = useState<"k24" | "k22" | "k18">("k22");
  const activeSchemes = db.schemes.filter((s) => s.active);
  const [calcS, setCalcS] = useState(activeSchemes[0]?.id || "");

  const w = parseFloat(calcW) || 0;
  const rate = db.rates[calcP];
  const sch = db.schemes.find((s) => s.id === calcS);
  const gross = w * rate;
  const elig = sch ? gross * sch.ltv / 100 : 0;

  return (
    <>
      <div className="page-h">
        <div><h1>Business Overview</h1><p>Wednesday, 30 July 2026 · Koratty (Head Office)</p></div>
        <div className="sp" />
        <button className="btn" onClick={() => openModal(<RateModalContent />)}>
          <Icon name="coin" /> Set Today&apos;s Gold Rate
        </button>
        <a className="btn ghost" href="#newloan"><Icon name="plus" /> New Loan</a>
        <button className="btn ghost" onClick={() => openModal(<RegisterCustomerModalContent />)}>
          <Icon name="user" /> Register Customer
        </button>
      </div>
      <hr className="gold-rule" />

      <div className="grid cols21">
        <div className="grid">
          <div className="kpis">
            <Kpi l="Cash in Hand" v={fmt(482350)} s="Opening ₹5,10,000" cls="ok" />
            <Kpi l="Loans Opened Today" v={openedToday} s="2 more in draft" />
            <Kpi l="Active Loans" v={active.length} s={fmt(outstanding) + " outstanding"} />
            <Kpi l="Due Soon" v={dueSoon.length} s="within 14 days" cls={dueSoon.length ? "warn" : ""} />
            <Kpi l="Overdue Loans" v={overdue.length} s={fmt(overdue.reduce((s, l) => s + l.outstanding, 0)) + " at risk"} cls={overdue.length ? "warn" : ""} />
            <Kpi l="Pending Approvals" v={db.approvals.length} s="awaiting sanction" cls={db.approvals.length ? "warn" : ""} />
            <Kpi l="Extension Requests" v={pendingReq.filter((r) => r.type === "Extension").length} s="from mobile app" />
            <Kpi l="Gold Release Requests" v={pendingReq.filter((r) => r.type === "Release").length} s="settlement review" />
            <Kpi l="Bank-Pledged Loans" v={pledged.length} s={fmt(pledged.reduce((s, l) => s + l.principal, 0)) + " re-pledged"} />
            <Kpi l="Auction Cases" v={db.auctions.length} s="notice stage" cls={db.auctions.length ? "warn" : ""} />
            <Kpi l="Today's Expenses" v={fmt(expToday)} s={db.expenses.filter((e) => e.status === "Pending").length + " pending approval"} />
            <Kpi l="Interest Collected (Jul)" v={fmt(48210)} s="↑ 12% vs June" cls="ok" />
          </div>

          <div className="card gtop">
            <div className="hd"><h3>Loan Portfolio — Disbursement (last 6 months)</h3><div className="sp" /><a href="#reports" style={{ fontSize: 12.5 }}>All reports →</a></div>
            <div className="bd">
              <div className="bars">
                {BAR_DATA.map(([m, v]) => (
                  <div className="b" key={m}><em>₹{v}L</em><i style={{ height: `${(v / 9.3) * 100}%` }} /><span>{m}</span></div>
                ))}
              </div>
            </div>
          </div>

          <div className="card">
            <div className="hd"><h3>Needs Attention</h3><div className="sp" /><a href="#requests" style={{ fontSize: 12.5 }}>View all →</a></div>
            <div className="bd" style={{ paddingTop: 6 }}>
              <ul className="mini-list">
                {db.approvals.map((a) => (
                  <li key={"appr-" + a.loan}>
                    <span className="ic"><Icon name="stamp" /></span>
                    <span className="tx"><b>Loan approval — {a.loan}</b><small>{a.cust} · {fmt(a.amt)} · at {a.stage} stage</small></span>
                    <span className="rt"><a className="btn sm" href={`#loan/${a.loan}`}>Review</a></span>
                  </li>
                ))}
                {pendingReq.map((r) => (
                  <li key={"req-" + r.id}>
                    <span className="ic"><Icon name={r.type === "Extension" ? "clock" : "unlock"} /></span>
                    <span className="tx"><b>{r.type} request — {r.loan}</b><small>{r.cust} · {r.detail}</small></span>
                    <span className="rt"><a className="btn sm ghost" href="#requests">Open</a></span>
                  </li>
                ))}
                {db.auctions.map((a) => (
                  <li key={"auc-" + a.loan}>
                    <span className="ic" style={{ background: "var(--red-bg)", color: "var(--red)" }}><Icon name="gavel" /></span>
                    <span className="tx"><b>Auction case — {a.loan}</b><small>{a.cust} · {fmt(a.outstanding)} outstanding · {a.stage}</small></span>
                    <span className="rt"><a className="btn sm ghost" href="#auctions">Open</a></span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>

        <div className="grid">
          <div className="card gtop">
            <div className="hd"><h3>Today&apos;s Gold Rate</h3><div className="sp" /><span style={{ fontSize: 11.5, color: "var(--muted)" }}>{db.rates.date}</span></div>
            <div className="bd">
              <div className="rates3" style={{ gridTemplateColumns: "1fr" }}>
                <RateTile k="24K · 999" r={db.rates.k24} />
                <RateTile k="22K · 916" r={db.rates.k22} />
                <RateTile k="18K · 750" r={db.rates.k18} />
              </div>
            </div>
            <div className="ft">Set by {db.rates.setBy} · applies to all valuations today</div>
          </div>

          <div className="card">
            <div className="hd"><h3>Gold Loan Calculator</h3></div>
            <div className="bd">
              <div className="frow c2">
                <div><label className="f">Weight (grams)</label><input className="inp" type="number" min={0} value={calcW} onChange={(e) => setCalcW(e.target.value)} /></div>
                <div><label className="f">Purity</label>
                  <select className="inp" value={calcP} onChange={(e) => setCalcP(e.target.value as "k24" | "k22" | "k18")}>
                    <option value="k24">24K</option><option value="k22">22K</option><option value="k18">18K</option>
                  </select>
                </div>
              </div>
              <div className="frow"><div><label className="f">Scheme</label>
                <select className="inp" value={calcS} onChange={(e) => setCalcS(e.target.value)}>
                  {activeSchemes.map((s) => <option key={s.id} value={s.id}>{s.name} — {s.ltv}% LTV @ {s.rate}%</option>)}
                </select>
              </div></div>
              <div style={{ background: "#fdf6dd", border: "1px solid var(--gold-light)", borderRadius: 8, padding: "12px 14px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 4 }}><span>Gross Gold Value</span><b>{fmt(gross)}</b></div>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 15 }}><span style={{ fontWeight: 600 }}>Eligible Loan Amount</span><b style={{ color: "var(--gold-deep)", fontSize: 17 }}>{fmt(elig)}</b></div>
              </div>
            </div>
            <div className="ft">Weight × Rate = Gross Value · Gross × LTV = Eligible</div>
          </div>

          <div className="card">
            <div className="hd"><h3>Upcoming Reminders</h3><div className="sp" /><a href="#calendar" style={{ fontSize: 12.5 }}>Calendar →</a></div>
            <div className="bd" style={{ paddingTop: 6 }}>
              <ul className="mini-list">
                {REMINDERS.map(([t, s, c]) => (
                  <li key={t}>
                    <span className="ic" style={c === "fup" ? { background: "var(--blue-bg)", color: "var(--blue)" } : undefined}>
                      <Icon name={c === "fup" ? "phone" : "bell"} />
                    </span>
                    <span className="tx"><b>{t}</b><small>{s}</small></span>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <div className="card">
            <div className="hd"><h3>Expense Summary — July</h3></div>
            <div className="bd"><Donut parts={EXPENSE_PARTS} /></div>
          </div>
        </div>
      </div>
    </>
  );
}
