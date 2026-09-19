"use client";

import { useEffect, useState } from "react";
import { brandRampHex, readCachedBrandColor, DEFAULT_BRAND_COLOR } from "@/product/config/theme";
import { activeBusinessSlug } from "@/product/services/tenantSession";
import { useSchemes } from "@/product/pages/schemes/store/SchemesProvider";
import { useCustomers } from "@/product/pages/customers/store/CustomersProvider";
import { useLoans } from "@/product/pages/loans/store/LoansProvider";
import { useGoldRates } from "@/product/pages/gold-rates/store/GoldRatesProvider";
import { useModal } from "@/product/components/Modal";
import { useAuth } from "@/product/providers/auth-context";
import { fmt } from "@/product/utils/format";
import { Icon } from "@/product/components/Icon";
import { RateModalContent } from "@/product/components/modals/RateModal";
import { RegisterCustomerModalContent } from "@/product/components/modals/RegisterCustomerModal";
import { PurityPicker } from "@/product/components/ui/PurityPicker";
import { Select } from "@/product/components/ui/Select";
import { rateForPurityString } from "@/product/utils/purity";
import { listCashMovements, listExpenses, type CashMovementView, type ExpenseView } from "@/product/pages/cash/services/cashService";
import { getCalendarEventsPage, type CalendarEvent } from "@/product/pages/reminders/services/reminderService";
import { listLoanRequests, getInterestCollected, type RequestView } from "@/product/pages/loans/services/loanService";
import { getNeedsAttentionPage, type NeedsAttentionItem } from "@/product/pages/dashboard/services/dashboardService";
import { routeHref } from "@/product/services/appRoutes";

function Kpi({ l, v, s, cls, href }: { l: string; v: string | number; s?: string; cls?: string; href?: string }) {
  const body = (
    <>
      <div className="l">{l}</div>
      <div className="v">{v}</div>
      <div className="s">{s || ""}</div>
    </>
  );
  if (href) {
    return (
      <a className={`kpi kpi-link ${cls || ""}`} href={href}>
        {body}
      </a>
    );
  }
  return <div className={`kpi ${cls || ""}`}>{body}</div>;
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

/* Categorical palette for the expense breakdown — identity, not magnitude,
 * so the hues are assigned in this fixed order and never re-sorted by value.
 * Checked against a light surface for the lightness band, chroma floor,
 * adjacent-pair separation under deuteranopia/tritanopia, and 3:1 contrast.
 * The ORDER is part of that result, since those checks run on adjacent pairs
 * — re-run the check before reordering or adding a hue. Deliberately avoids
 * --green/--red/--amber, which are reserved for status and must not double
 * as "series 4". */
/* Only the FIRST series follows the business's brand colour. The other five
 * stay fixed: a categorical palette's job is to keep six slices tellable
 * apart, and re-deriving all of them from one hue would collapse the
 * spacing the contrast check above was done against. One branded lead
 * colour ties the chart to the rest of the app without costing legibility. */
function expenseColors(): string[] {
  const brand = brandRampHex(readCachedBrandColor(activeBusinessSlug()) || DEFAULT_BRAND_COLOR);
  return [brand["--brand"], "#8267e2", "#f99603", "#20a04e", "#62626f", "#0e8ba0"];
}

/* Ported from legacy/app.js's `renderDashboard()`. All figures are now
 * derived from live DB state instead of hardcoded demo values. */
export function Dashboard() {
  const { schemes } = useSchemes();
  const { refresh: refreshCustomers } = useCustomers();
  const { loans } = useLoans();
  const { can } = useAuth();
  // Gated on the real permission (not a hardcoded role check) — the backend
  // already 403s a POST /loans without "can create loan", hide the button
  // rather than let a user click into a form that can only ever fail.
  const canCreateLoans = can("Loan_Management", "can_create_loan");
  const canCreateRates = can("Gold_Rate_Management", "can_create_gold_rate");
  const canCreateCustomers = can("Customer_Management", "can_create_customer");
  const { latest } = useGoldRates();
  const { openModal } = useModal();

  const [cashMovements, setCashMovements] = useState<CashMovementView[]>([]);
  const [expenses, setExpenses] = useState<ExpenseView[]>([]);
  const [pendingReq, setPendingReq] = useState<RequestView[]>([]);
  const [interestCollected, setInterestCollected] = useState(0);
  useEffect(() => {
    listCashMovements().then(setCashMovements).catch(() => setCashMovements([]));
    listExpenses().then(setExpenses).catch(() => setExpenses([]));
    // Real replacements for the old always-empty db.requests/db.ledger
    // mock data — see documents/change_log.md. Kept as a full (unpaginated)
    // fetch: the "Extension Requests"/"Gold Release Requests" KPI tiles
    // below need the true counts by type, not one page of them.
    listLoanRequests({ status: "Pending" }).then(setPendingReq).catch(() => setPendingReq([]));
    getInterestCollected().then(setInterestCollected).catch(() => setInterestCollected(0));
  }, []);

  const today = new Date().toISOString().slice(0, 10);
  const todayLabel = new Date().toLocaleDateString("en-IN", { weekday: "long", year: "numeric", month: "long", day: "numeric" });

  const active = loans.filter((l) => ["Active", "Due Soon", "Overdue"].includes(l.status));
  const overdue = loans.filter((l) => l.status === "Overdue");
  const dueSoon = loans.filter((l) => l.status === "Due Soon");
  const pledged = loans.filter((l) => l.bankPledgeStatus === "Bank Pledged");
  const outstanding = active.reduce((s, l) => s + l.outstanding, 0);
  const expToday = expenses.filter((e) => e.d === today).reduce((s, e) => s + e.amt, 0);
  const openedToday = loans.filter((l) => l.opened === today).length;
  const cashInHand = cashMovements.filter((m) => m.type === "in").reduce((s, m) => s + m.amount, 0)
    - cashMovements.filter((m) => m.type === "out").reduce((s, m) => s + m.amount, 0);
  const expenseByCat = Object.entries(
    expenses.reduce<Record<string, number>>((acc, e) => { acc[e.cat] = (acc[e.cat] || 0) + e.amt; return acc; }, {})
  );
  const palette = expenseColors();
  const expenseParts: [string, number, string][] = expenseByCat.map(([cat, amt], i) => [cat, amt, palette[i % palette.length]]);

  const now = new Date();
  const monthBuckets: [string, number][] = Array.from({ length: 6 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - (5 - i), 1);
    return [d.toLocaleDateString("en-IN", { month: "short" }), 0] as [string, number];
  });
  // Only loans that cleared final sanction — money leaves the till at that
  // point and not before (see loan.Service.Decide's `disbursing` flag), so
  // counting loans still in the approval chain would chart cash that has not
  // actually gone out.
  loans.forEach((l) => {
    if (l.approvalStage !== "Approved") return;
    const opened = new Date(l.opened);
    const idx = 5 - (
      (now.getFullYear() - opened.getFullYear()) * 12 + (now.getMonth() - opened.getMonth())
    );
    if (idx >= 0 && idx < 6) monthBuckets[idx][1] += l.principal / 100000;
  });
  const maxBar = Math.max(1, ...monthBuckets.map(([, v]) => v));
  // KPI tiles below ("Pending Approvals"/"Auction Cases") deliberately keep
  // deriving from LoansProvider's already-loaded full `loans` list rather
  // than the new paginated /dashboard/needs-attention endpoint — the
  // endpoint's own approvalsCount/auctionsCount would report the identical
  // numbers, but switching these two tiles over gains nothing and would
  // just make the KPI row depend on one more network round trip. Only the
  // "Needs Attention" *list* below was ever actually slicing in memory, so
  // only that widget's data source changes.
  const pendingApprovalLoans = loans.filter((l) => l.status === "Pending Approval");
  const auctionLoans = loans.filter((l) => l.status === "Auction Eligible" || l.status === "Defaulted");

  // "Needs Attention" — real server-side pagination (see
  // modules/dashboard/services/dashboardService.ts): the backend merges
  // pending-approval loans, pending Extension/Release requests and
  // auction-eligible/defaulted loans, orders them, and returns only the
  // requested page plus the true total count.
  const NEEDS_ATTENTION_PAGE_SIZE = 15;
  const [needsAttentionPage, setNeedsAttentionPage] = useState(1);
  const [needsAttentionItems, setNeedsAttentionItems] = useState<NeedsAttentionItem[]>([]);
  const [needsAttentionTotal, setNeedsAttentionTotal] = useState(0);
  useEffect(() => {
    getNeedsAttentionPage(needsAttentionPage)
      .then((res) => { setNeedsAttentionItems(res.items); setNeedsAttentionTotal(res.totalCount); })
      .catch(() => { setNeedsAttentionItems([]); setNeedsAttentionTotal(0); });
  }, [needsAttentionPage]);
  const needsAttentionPages = Math.max(1, Math.ceil(needsAttentionTotal / NEEDS_ATTENTION_PAGE_SIZE));
  const needsAttentionPageItems = needsAttentionItems;

  // "Upcoming Reminders" — real server-side pagination over the merged,
  // already-sorted (Overdue first, then by date — moved into
  // backend/internal/reminder's GetCalendarEvents) event list for the fixed
  // 14-day window.
  const REMINDERS_PAGE_SIZE = 5;
  const [reminderPage, setReminderPage] = useState(1);
  const [reminderPageItems, setReminderPageItems] = useState<CalendarEvent[]>([]);
  const [reminderTotal, setReminderTotal] = useState(0);
  useEffect(() => {
    const from = new Date().toISOString().slice(0, 10);
    const to = new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10);
    getCalendarEventsPage(from, to, reminderPage, REMINDERS_PAGE_SIZE)
      .then((res) => { setReminderPageItems(res.events); setReminderTotal(res.totalCount); })
      .catch(() => { setReminderPageItems([]); setReminderTotal(0); });
  }, [reminderPage]);
  const reminderPages = Math.max(1, Math.ceil(reminderTotal / REMINDERS_PAGE_SIZE));

  const [calcW, setCalcW] = useState("10");
  const [calcP, setCalcP] = useState("22K");
  const activeSchemes = schemes.filter((s) => s.active);
  const [calcS, setCalcS] = useState(activeSchemes[0]?.id || "");

  // schemes load asynchronously (SchemesProvider fetches after mount), so
  // the initial useState above almost always resolves to "" — nothing then
  // re-synced it once the real list arrived, leaving calcS pointing at a
  // scheme id absent from `activeSchemes.map(...)`'s <option> list. A
  // <select> whose value doesn't match any option shows the browser's own
  // first-item highlight without actually selecting it, which is what
  // looked like a "selected but empty" row. Re-point calcS at the first
  // active scheme whenever the current pick no longer exists among them.
  useEffect(() => {
    if (activeSchemes.length && !activeSchemes.some((s) => s.id === calcS)) {
      setCalcS(activeSchemes[0].id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSchemes]);

  const w = parseFloat(calcW) || 0;
  const rate = rateForPurityString(latest.k24, calcP) ?? 0;
  const sch = schemes.find((s) => s.id === calcS);
  const gross = w * rate;
  const elig = sch ? gross * sch.ltv / 100 : 0;

  return (
    <>
      <div className="page-h">
        <div><h1>Business Overview</h1><p>{todayLabel}</p></div>
        <div className="sp" />
        {canCreateRates && (
          <button className="btn" onClick={() => openModal(<RateModalContent />)}>
            <Icon name="coin" /> Set Today&apos;s Gold Rate
          </button>
        )}
        {canCreateLoans && <a className="btn ghost" href={routeHref("newloan")}><Icon name="plus" /> New Loan</a>}
        {canCreateCustomers && (
          <button className="btn ghost" onClick={() => openModal(<RegisterCustomerModalContent onSaved={refreshCustomers} />, true)}>
            <Icon name="user" /> Register Customer
          </button>
        )}
      </div>
      <hr className="gold-rule" />

      <div className="grid cols21">
        <div className="grid">
          {/* dashboard-kpis scopes the 1280px-ish 3-column override
           * (app.css) to just this Business Overview row — plain `.kpis`
           * would otherwise hit every KPI row app-wide at that width,
           * including Reports' totals, whose two cards would then lose
           * their fixed 213px size and auto-size to their own text
           * instead ("Total Amount"'s longer value rendering visibly
           * wider than "Loans"' short one). */}
          <div className="kpis dashboard-kpis">
            <Kpi l="Cash in Hand" v={fmt(cashInHand)} cls="ok" href={routeHref("cash")} />
            <Kpi l="Loans Opened Today" v={openedToday} href={routeHref("loans")} />
            <Kpi l="Active Loans" v={active.length} s={fmt(outstanding) + " outstanding"} href={routeHref("loans/Active")} />
            <Kpi l="Due Soon" v={dueSoon.length} s="within 14 days" cls={dueSoon.length ? "warn" : ""} href={routeHref(`loans/${encodeURIComponent("Due Soon")}`)} />
            <Kpi l="Overdue Loans" v={overdue.length} s={fmt(overdue.reduce((s, l) => s + l.outstanding, 0)) + " at risk"} cls={overdue.length ? "warn" : ""} href={routeHref("loans/Overdue")} />
            <Kpi l="Pending Approvals" v={pendingApprovalLoans.length} s="awaiting sanction" cls={pendingApprovalLoans.length ? "warn" : ""} href={routeHref(`loans/${encodeURIComponent("Pending Approval")}`)} />
            <Kpi l="Extension Requests" v={pendingReq.filter((r) => r.type === "Extension").length} s="from mobile app" href={routeHref("requests")} />
            <Kpi l="Gold Release Requests" v={pendingReq.filter((r) => r.type === "Release").length} s="settlement review" href={routeHref("requests")} />
            <Kpi l="Bank-Pledged Loans" v={pledged.length} s={fmt(pledged.reduce((s, l) => s + l.principal, 0)) + " re-pledged"} href={routeHref("bankpledge")} />
            <Kpi l="Auction Cases" v={auctionLoans.length} s="notice stage" cls={auctionLoans.length ? "warn" : ""} href={routeHref("auctions")} />
            <Kpi l="Today's Expenses" v={fmt(expToday)} s={expenses.filter((e) => e.status === "Pending").length + " pending approval"} href={routeHref("cash")} />
            <Kpi l="Interest Collected" v={fmt(interestCollected)} cls="ok" href={routeHref("reports")} />
          </div>

          <div className="card gtop">
            <div className="hd"><h3>Loan Portfolio — Disbursement (last 6 months)</h3><div className="sp" /><a href={routeHref("reports")} style={{ fontSize: 12.5 }}>All reports →</a></div>
            <div className="bd">
              <div className="bars">
                {monthBuckets.map(([m, v], i) => (
                  <div className="b" key={m + i}><em>₹{v.toFixed(1)}L</em><i style={{ height: `${(v / maxBar) * 100}%` }} /><span>{m}</span></div>
                ))}
              </div>
            </div>
          </div>

          <div className="card">
            <div className="hd"><h3>Needs Attention</h3><div className="sp" /><a href={routeHref("requests")} style={{ fontSize: 12.5 }}>View all →</a></div>
            <div className="bd" style={{ paddingTop: 6 }}>
              <ul className="mini-list">
                {needsAttentionPageItems.length === 0 && (
                  <li><span className="tx"><small>Nothing needs attention right now.</small></span></li>
                )}
                {needsAttentionPageItems.map((item) => {
                  if (item.kind === "approval") {
                    return (
                      <li key={"appr-" + item.loanId}>
                        <span className="ic"><Icon name="stamp" /></span>
                        <span className="tx"><b>Loan approval — {item.loanNumber}</b><small>{item.customerName} · {fmt(item.principal)} · at {item.approvalStage} stage</small></span>
                        <span className="rt"><a className="btn sm" href={routeHref(`loan/${item.loanNumber}`)}>Review</a></span>
                      </li>
                    );
                  }
                  if (item.kind === "request") {
                    return (
                      <li key={"req-" + item.requestId}>
                        <span className="ic"><Icon name={item.requestType === "Extension" ? "clock" : "unlock"} /></span>
                        <span className="tx"><b>{item.requestType} request — {item.loanNumber}</b><small>{item.customerName} · {item.detail}</small></span>
                        <span className="rt"><a className="btn sm ghost" href={routeHref("requests")}>Open</a></span>
                      </li>
                    );
                  }
                  return (
                    <li key={"auc-" + item.loanId}>
                      <span className="ic" style={{ background: "var(--red-bg)", color: "var(--red)" }}><Icon name="gavel" /></span>
                      <span className="tx"><b>Auction case — {item.loanNumber}</b><small>{item.customerName} · {fmt(item.outstanding)} outstanding · {item.status}</small></span>
                      <span className="rt"><a className="btn sm ghost" href={routeHref("auctions")}>Open</a></span>
                    </li>
                  );
                })}
              </ul>
            </div>
            <div className="ft" style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px" }}>
              <button className="btn plain sm" style={{ padding: "4px 10px" }} disabled={needsAttentionPage <= 1} onClick={() => setNeedsAttentionPage((p) => Math.max(1, p - 1))}>‹ Prev</button>
              <span style={{ fontSize: 12.5 }}>Page {needsAttentionPage} of {needsAttentionPages}</span>
              <button className="btn plain sm" style={{ padding: "4px 10px" }} disabled={needsAttentionPage >= needsAttentionPages} onClick={() => setNeedsAttentionPage((p) => Math.min(needsAttentionPages, p + 1))}>Next ›</button>
            </div>
          </div>
        </div>

        <div className="grid">
           <div className="card calc-card">
            <div className="hd"><h3>Gold Loan Calculator</h3></div>
            <div className="bd">
              <div className="frow c2">
                {/* No inline height/padding override — matches Select's
                 * own default 40px height (app.css's .calc-card rules)
                 * rather than the other way around. */}
                <div><label className="f">Weight (grams)</label><input className="inp" type="number" min={0} value={calcW} onChange={(e) => setCalcW(e.target.value)} /></div>
                <div><label className="f">Purity</label>
                  <PurityPicker value={calcP} onChange={setCalcP} dropdownMinWidth={70} />
                </div>
              </div>
              <div className="frow"><div><label className="f">Scheme</label>
                <Select
                  options={activeSchemes.map((s) => ({ value: s.id, label: `${s.name} — ${s.ltv}% LTV @ ${s.rate}%` }))}
                  value={calcS}
                  onChange={setCalcS}
                />
              </div></div>
              <div style={{ background: "var(--brand-faint)", border: "1px solid var(--brand-pale)", borderRadius: 8, padding: "12px 14px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 4 }}><span>Gross Gold Value</span><b>{fmt(gross)}</b></div>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 15 }}><span style={{ fontWeight: 600 }}>Eligible Loan Amount</span><b style={{ color: "var(--brand-deep)", fontSize: 17 }}>{fmt(elig)}</b></div>
              </div>
            </div>
            <div className="ft">Weight × Rate = Gross Value · Gross × LTV = Eligible</div>
          </div>
          <div className="card gtop">
            <div className="hd"><h3>Today&apos;s Gold Rate</h3><div className="sp" /><span style={{ fontSize: 11.5, color: "var(--muted)" }}>{latest.date}</span></div>
            <div className="bd">
              <div className="rates3" style={{ gridTemplateColumns: "1fr" }}>
                <RateTile k="24K · published" r={latest.k24} />
                <RateTile k="22K · computed" r={latest.k22} />
                <RateTile k="18K · computed" r={latest.k18} />
              </div>
            </div>
            <div className="ft">Set by {latest.setBy} · applies to all valuations today</div>
          </div>

          {/* .calc-card opts this card into a container query (app.css) that
           * collapses Weight/Purity to one column, and stacks the Purity
           * field's own Karat/Fineness toggle above its value box, once the
           * card's own rendered width gets narrow — which happens here even
           * at a normal window size, since this card sits in the
           * dashboard's sidebar column rather than the main content well.
           * At a normal resolution, once that column is wide enough (or the
           * dashboard grid drops to a single column and this card gets the
           * full page width), both stay their usual side by side selves. */}
         

          <div className="card">
            <div className="hd"><h3>Upcoming Reminders</h3><div className="sp" /><a href={routeHref("calendar")} style={{ fontSize: 12.5 }}>Calendar →</a></div>
            <div className="bd" style={{ paddingTop: 6 }}>
              <ul className="mini-list">
                {reminderPageItems.length ? reminderPageItems.map((e, i) => (
                  <li key={i}>
                    <span className="ic" style={e.type === "Overdue" ? { background: "var(--red-bg)", color: "var(--red)" } : e.type === "FollowUp" || e.type === "PromiseToPay" ? { background: "var(--info-bg)", color: "var(--info)" } : undefined}>
                      <Icon name={e.type === "FollowUp" ? "phone" : e.type === "PromiseToPay" ? "clock" : "bell"} />
                    </span>
                    <span className="tx"><b>{e.title}</b><small>{e.detail}{e.loanNumber ? ` · ${e.loanNumber}` : ""} · {e.date}</small></span>
                  </li>
                )) : <li><span className="tx"><small>No pending reminders.</small></span></li>}
              </ul>
            </div>
            {reminderPages > 1 && (
              <div className="ft" style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <button className="btn plain sm" disabled={reminderPage <= 1} onClick={() => setReminderPage((p) => Math.max(1, p - 1))}>‹ Prev</button>
                <span style={{ fontSize: 12.5 }}>Page {reminderPage} of {reminderPages}</span>
                <button className="btn plain sm" disabled={reminderPage >= reminderPages} onClick={() => setReminderPage((p) => Math.min(reminderPages, p + 1))}>Next ›</button>
              </div>
            )}
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
