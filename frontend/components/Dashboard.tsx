"use client";

import { useEffect, useState } from "react";
import { useData } from "@/lib/DataProvider";
import { useSchemes } from "@/lib/SchemesProvider";
import { useCustomers } from "@/lib/CustomersProvider";
import { useLoans } from "@/lib/LoansProvider";
import { useGoldRates } from "@/lib/GoldRatesProvider";
import { useModal } from "@/components/Modal";
import { fmt } from "@/lib/format";
import { Icon } from "@/lib/icons";
import { RateModalContent } from "@/components/modals/RateModal";
import { RegisterCustomerModalContent } from "@/components/modals/RegisterCustomerModal";
import { listCashMovements, listExpenses, type CashMovementView, type ExpenseView } from "@/lib/cashApi";

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

const EXPENSE_COLORS = ["#9a6f0f", "#d4af37", "#3b5f7a", "#b3a980", "#7a3b5f", "#5f7a3b"];

/* Ported from legacy/app.js's `renderDashboard()`. All figures are now
 * derived from live DB state instead of hardcoded demo values. */
export function Dashboard() {
  const { db } = useData();
  const { schemes } = useSchemes();
  const { refresh: refreshCustomers } = useCustomers();
  const { loans } = useLoans();
  const { latest } = useGoldRates();
  const { openModal } = useModal();

  const [cashMovements, setCashMovements] = useState<CashMovementView[]>([]);
  const [expenses, setExpenses] = useState<ExpenseView[]>([]);
  useEffect(() => {
    listCashMovements().then(setCashMovements).catch(() => setCashMovements([]));
    listExpenses().then(setExpenses).catch(() => setExpenses([]));
  }, []);

  const today = new Date().toISOString().slice(0, 10);
  const todayLabel = new Date().toLocaleDateString("en-IN", { weekday: "long", year: "numeric", month: "long", day: "numeric" });

  const active = loans.filter((l) => ["Active", "Due Soon", "Overdue"].includes(l.status));
  const overdue = loans.filter((l) => l.status === "Overdue");
  const dueSoon = loans.filter((l) => l.status === "Due Soon");
  const pledged = loans.filter((l) => l.bankPledgeStatus === "Bank Pledged");
  const outstanding = active.reduce((s, l) => s + l.outstanding, 0);
  const pendingReq = db.requests.filter((r) => r.status === "Pending");
  const expToday = expenses.filter((e) => e.d === today).reduce((s, e) => s + e.amt, 0);
  const openedToday = loans.filter((l) => l.opened === today).length;
  const cashInHand = cashMovements.filter((m) => m.type === "in").reduce((s, m) => s + m.amount, 0)
    - cashMovements.filter((m) => m.type === "out").reduce((s, m) => s + m.amount, 0);
  const interestCollected = Object.values(db.ledger).flat().filter((e) => e.credit).reduce((s, e) => s + e.credit, 0);
  const expenseByCat = Object.entries(
    expenses.reduce<Record<string, number>>((acc, e) => { acc[e.cat] = (acc[e.cat] || 0) + e.amt; return acc; }, {})
  );
  const expenseParts: [string, number, string][] = expenseByCat.map(([cat, amt], i) => [cat, amt, EXPENSE_COLORS[i % EXPENSE_COLORS.length]]);

  const now = new Date();
  const monthBuckets: [string, number][] = Array.from({ length: 6 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - (5 - i), 1);
    return [d.toLocaleDateString("en-IN", { month: "short" }), 0] as [string, number];
  });
  loans.forEach((l) => {
    const opened = new Date(l.opened);
    const idx = 5 - (
      (now.getFullYear() - opened.getFullYear()) * 12 + (now.getMonth() - opened.getMonth())
    );
    if (idx >= 0 && idx < 6) monthBuckets[idx][1] += l.principal / 100000;
  });
  const maxBar = Math.max(1, ...monthBuckets.map(([, v]) => v));
  const pendingApprovalLoans = loans.filter((l) => l.status === "Pending Approval");
  const auctionLoans = loans.filter((l) => l.status === "Auction Eligible" || l.status === "Defaulted");
  const pendingReminders = [
    ...pendingApprovalLoans.map((l) => [`Loan approval — ${l.id}`, `${l.customerName} · ${fmt(l.principal)}`, "due"] as [string, string, string]),
    ...pendingReq.map((r) => [`${r.type} request — ${r.loan}`, `${r.cust} · ${r.detail}`, "fup"] as [string, string, string]),
  ];

  const [calcW, setCalcW] = useState("10");
  const [calcP, setCalcP] = useState<"k24" | "k22" | "k18">("k22");
  const activeSchemes = schemes.filter((s) => s.active);
  const [calcS, setCalcS] = useState(activeSchemes[0]?.id || "");

  const w = parseFloat(calcW) || 0;
  const rate = latest[calcP];
  const sch = schemes.find((s) => s.id === calcS);
  const gross = w * rate;
  const elig = sch ? gross * sch.ltv / 100 : 0;

  return (
    <>
      <div className="page-h">
        <div><h1>Business Overview</h1><p>{todayLabel}</p></div>
        <div className="sp" />
        <button className="btn" onClick={() => openModal(<RateModalContent />)}>
          <Icon name="coin" /> Set Today&apos;s Gold Rate
        </button>
        <a className="btn ghost" href="#newloan"><Icon name="plus" /> New Loan</a>
        <button className="btn ghost" onClick={() => openModal(<RegisterCustomerModalContent onSaved={refreshCustomers} />)}>
          <Icon name="user" /> Register Customer
        </button>
      </div>
      <hr className="gold-rule" />

      <div className="grid cols21">
        <div className="grid">
          <div className="kpis">
            <Kpi l="Cash in Hand" v={fmt(cashInHand)} cls="ok" />
            <Kpi l="Loans Opened Today" v={openedToday} />
            <Kpi l="Active Loans" v={active.length} s={fmt(outstanding) + " outstanding"} />
            <Kpi l="Due Soon" v={dueSoon.length} s="within 14 days" cls={dueSoon.length ? "warn" : ""} />
            <Kpi l="Overdue Loans" v={overdue.length} s={fmt(overdue.reduce((s, l) => s + l.outstanding, 0)) + " at risk"} cls={overdue.length ? "warn" : ""} />
            <Kpi l="Pending Approvals" v={pendingApprovalLoans.length} s="awaiting sanction" cls={pendingApprovalLoans.length ? "warn" : ""} />
            <Kpi l="Extension Requests" v={pendingReq.filter((r) => r.type === "Extension").length} s="from mobile app" />
            <Kpi l="Gold Release Requests" v={pendingReq.filter((r) => r.type === "Release").length} s="settlement review" />
            <Kpi l="Bank-Pledged Loans" v={pledged.length} s={fmt(pledged.reduce((s, l) => s + l.principal, 0)) + " re-pledged"} />
            <Kpi l="Auction Cases" v={auctionLoans.length} s="notice stage" cls={auctionLoans.length ? "warn" : ""} />
            <Kpi l="Today's Expenses" v={fmt(expToday)} s={expenses.filter((e) => e.status === "Pending").length + " pending approval"} />
            <Kpi l="Interest Collected" v={fmt(interestCollected)} cls="ok" />
          </div>

          <div className="card gtop">
            <div className="hd"><h3>Loan Portfolio — Disbursement (last 6 months)</h3><div className="sp" /><a href="#reports" style={{ fontSize: 12.5 }}>All reports →</a></div>
            <div className="bd">
              <div className="bars">
                {monthBuckets.map(([m, v], i) => (
                  <div className="b" key={m + i}><em>₹{v.toFixed(1)}L</em><i style={{ height: `${(v / maxBar) * 100}%` }} /><span>{m}</span></div>
                ))}
              </div>
            </div>
          </div>

          <div className="card">
            <div className="hd"><h3>Needs Attention</h3><div className="sp" /><a href="#requests" style={{ fontSize: 12.5 }}>View all →</a></div>
            <div className="bd" style={{ paddingTop: 6 }}>
              <ul className="mini-list">
                {pendingApprovalLoans.map((l) => (
                  <li key={"appr-" + l.id}>
                    <span className="ic"><Icon name="stamp" /></span>
                    <span className="tx"><b>Loan approval — {l.id}</b><small>{l.customerName} · {fmt(l.principal)} · at {l.approvalStage} stage</small></span>
                    <span className="rt"><a className="btn sm" href={`#loan/${l.id}`}>Review</a></span>
                  </li>
                ))}
                {pendingReq.map((r) => (
                  <li key={"req-" + r.id}>
                    <span className="ic"><Icon name={r.type === "Extension" ? "clock" : "unlock"} /></span>
                    <span className="tx"><b>{r.type} request — {r.loan}</b><small>{r.cust} · {r.detail}</small></span>
                    <span className="rt"><a className="btn sm ghost" href="#requests">Open</a></span>
                  </li>
                ))}
                {auctionLoans.map((l) => (
                  <li key={"auc-" + l.id}>
                    <span className="ic" style={{ background: "var(--red-bg)", color: "var(--red)" }}><Icon name="gavel" /></span>
                    <span className="tx"><b>Auction case — {l.id}</b><small>{l.customerName} · {fmt(l.outstanding)} outstanding · {l.status}</small></span>
                    <span className="rt"><a className="btn sm ghost" href="#auctions">Open</a></span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>

        <div className="grid">
          <div className="card gtop">
            <div className="hd"><h3>Today&apos;s Gold Rate</h3><div className="sp" /><span style={{ fontSize: 11.5, color: "var(--muted)" }}>{latest.date}</span></div>
            <div className="bd">
              <div className="rates3" style={{ gridTemplateColumns: "1fr" }}>
                <RateTile k="24K · 999" r={latest.k24} />
                <RateTile k="22K · 916" r={latest.k22} />
                <RateTile k="18K · 750" r={latest.k18} />
              </div>
            </div>
            <div className="ft">Set by {latest.setBy} · applies to all valuations today</div>
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
                {pendingReminders.length ? pendingReminders.map(([t, s, c], i) => (
                  <li key={t + i}>
                    <span className="ic" style={c === "fup" ? { background: "var(--blue-bg)", color: "var(--blue)" } : undefined}>
                      <Icon name={c === "fup" ? "phone" : "bell"} />
                    </span>
                    <span className="tx"><b>{t}</b><small>{s}</small></span>
                  </li>
                )) : <li><span className="tx"><small>No pending reminders.</small></span></li>}
              </ul>
            </div>
          </div>

          <div className="card">
            <div className="hd"><h3>Expense Summary</h3></div>
            <div className="bd">{expenseParts.length ? <Donut parts={expenseParts} /> : <p style={{ color: "var(--muted)", fontSize: 13 }}>No expenses recorded yet.</p>}</div>
          </div>
        </div>
      </div>
    </>
  );
}
