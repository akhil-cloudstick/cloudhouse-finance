"use client";

import { useEffect, useState } from "react";
import { brandRampHex, readCachedBrandColor, DEFAULT_BRAND_COLOR } from "@/common/config/theme";
import { activeBusinessSlug } from "@/common/services/tenantSession";
import { useSchemes } from "@/modules/schemes/store/SchemesProvider";
import { useCustomers } from "@/modules/customers/store/CustomersProvider";
import { useLoans } from "@/modules/loans/store/LoansProvider";
import { useGoldRates } from "@/modules/gold-rates/store/GoldRatesProvider";
import { useModal } from "@/common/components/ModalProvider";
import { useAuth, useApprovalWorkflow } from "@/common/providers/AuthProvider";
import { stageLabel } from "@/common/services/approvalWorkflowService";
import { fmt, fmtDate, fmtToday } from "@/common/utils/format";
import { Icon } from "@/common/components/Icon";
import { RateModalContent } from "@/common/components/modals/RateModalContent";
import { RegisterCustomerModalContent } from "@/common/components/modals/RegisterCustomerModalContent";
import { PurityPicker } from "@/common/components/PurityPicker";
import { Select } from "@/common/components/ui/Select";
import { rateForPurityString } from "@/common/utils/purity";
import { listCashMovements, listExpenses, getCashSummary } from "@/modules/cash/services/cashService";
import { type CashMovementView, type ExpenseView, type CashSummary } from "@/modules/cash/types/cash-types";
import { getCalendarEventsPage } from "@/modules/reminders/services/reminderService";
import { type CalendarEvent } from "@/modules/reminders/types/reminder-types";
import { listLoanRequests, getInterestCollected } from "@/modules/loans/services/loanService";
import { type RequestView } from "@/modules/loans/types/loan-types";
import { getNeedsAttentionPage } from "@/modules/dashboard/services/dashboardService";
import { type NeedsAttentionItem } from "@/modules/dashboard/types/dashboard-types";
import { routeHref } from "@/common/services/appRoutes";
import { useCanOpenRoute } from "@/common/hooks/use-can-open-route";

type KpiProps = { l: string; v: string | number; s?: React.ReactNode; cls?: string; href?: string };

function Kpi({ l, v, s, cls, href }: KpiProps) {
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

type RateTileProps = { k: string; r: number };

function RateTile({ k, r }: RateTileProps) {
  return (
    <div className="rate-tile">
      <div className="k">{k}</div>
      <div className="r">{fmt(r)}</div>
      <div className="u">per gram</div>
    </div>
  );
}

type DonutProps = { parts: [string, number, string][] };

function Donut({ parts }: DonutProps) {
  const total = parts.reduce((s, p) => s + p[1], 0);
  const divisor = total || 1; // avoid 0/0 → NaN degrees when there is no data
  let acc = 0;
  const stops = parts.map((p) => {
    const a = (acc / divisor) * 360;
    acc += p[1];
    return `${p[2]} ${a}deg ${(acc / divisor) * 360}deg`;
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

// Fixed hue order (colorblind-checked); only the first follows the brand color, the rest stay fixed
// to keep six slices tellable apart. Avoids --green/--red/--amber, reserved for status.
function expenseColors(): string[] {
  const brand = brandRampHex(readCachedBrandColor(activeBusinessSlug()) || DEFAULT_BRAND_COLOR);
  return [brand["--brand"], "#8267e2", "#f99603", "#20a04e", "#62626f", "#0e8ba0"];
}

export function DashboardPage() {
  const { schemes } = useSchemes();
  const { refresh: refreshCustomers } = useCustomers();
  const { loans } = useLoans();
  const { can } = useAuth();
  const { config: workflow } = useApprovalWorkflow();
  const canCreateLoans = can("Loan_Management", "can_create_loan");
  const canCreateRates = can("Gold_Rate_Management", "can_create_gold_rate");
  const canCreateCustomers = can("Customer_Management", "can_create_customer");
  const canOpen = useCanOpenRoute();
  const link = (r: string) => (canOpen(r) ? routeHref(r) : undefined);
  const canViewLoans = can("Loan_Management", "can_view_loan_module");
  const canViewCash = can("Cash_Management", "can_view_cash_module");
  const canViewReminders = can("Reminder_Management", "can_view_reminder_module");
  const { latest } = useGoldRates();
  const { openModal } = useModal();

  const [cashMovements, setCashMovements] = useState<CashMovementView[]>([]);
  const [expenses, setExpenses] = useState<ExpenseView[]>([]);
  const [pendingReq, setPendingReq] = useState<RequestView[]>([]);
  const [interestCollected, setInterestCollected] = useState(0);
  const [cashSummary, setCashSummary] = useState<CashSummary | null>(null);
  useEffect(() => {
    if (canViewCash) {
      getCashSummary().then(setCashSummary).catch(() => setCashSummary(null));
      listCashMovements().then(setCashMovements).catch(() => setCashMovements([]));
      listExpenses().then(setExpenses).catch(() => setExpenses([]));
    }
    if (!canViewLoans) return;
    // Full unpaginated fetch: the KPI tiles below need true counts by type, not one page.
    listLoanRequests({ status: "Pending" }).then(setPendingReq).catch(() => setPendingReq([]));
    getInterestCollected().then(setInterestCollected).catch(() => setInterestCollected(0));
  }, [canViewCash, canViewLoans]);

  const today = new Date().toISOString().slice(0, 10);
  const todayLabel = `${new Date().toLocaleDateString("en-IN", { weekday: "long" })}, ${fmtToday()}`;

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
  // Long tail folded into one "Others" slice so the wheel stays readable.
  const EXPENSE_TOP = 5;
  const expenseSorted = [...expenseByCat].sort((a, b) => b[1] - a[1]);
  const expenseShown: [string, number][] = expenseSorted.slice(0, EXPENSE_TOP);
  const expenseRest = expenseSorted.slice(EXPENSE_TOP).reduce((sum, [, amt]) => sum + amt, 0);
  if (expenseRest > 0) expenseShown.push(["Others", expenseRest]);
  const expenseParts: [string, number, string][] = expenseShown.map(([cat, amt], i) => [cat, amt, palette[i % palette.length]]);

  const now = new Date();
  const monthBuckets: [string, number][] = Array.from({ length: 6 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - (5 - i), 1);
    return [d.toLocaleDateString("en-IN", { month: "short" }), 0] as [string, number];
  });
  // Only loans that cleared final sanction count: money leaves the till only at that point.
  loans.forEach((l) => {
    if (l.approvalStage !== "Approved") return;
    const opened = new Date(l.opened);
    const idx = 5 - (
      (now.getFullYear() - opened.getFullYear()) * 12 + (now.getMonth() - opened.getMonth())
    );
    if (idx >= 0 && idx < 6) monthBuckets[idx][1] += l.principal / 100000;
  });
  const maxBar = Math.max(1, ...monthBuckets.map(([, v]) => v));
  const pendingApprovalLoans = loans.filter((l) => l.status === "Pending Approval");
  const auctionLoans = loans.filter((l) => l.status === "Auction Eligible" || l.status === "Defaulted");

  const NEEDS_ATTENTION_PAGE_SIZE = 15;
  const [needsAttentionPage, setNeedsAttentionPage] = useState(1);
  const [needsAttentionItems, setNeedsAttentionItems] = useState<NeedsAttentionItem[]>([]);
  const [needsAttentionTotal, setNeedsAttentionTotal] = useState(0);
  useEffect(() => {
    if (!canViewLoans) return;
    getNeedsAttentionPage(needsAttentionPage)
      .then((res) => { setNeedsAttentionItems(res.items); setNeedsAttentionTotal(res.totalCount); })
      .catch(() => { setNeedsAttentionItems([]); setNeedsAttentionTotal(0); });
  }, [needsAttentionPage, canViewLoans]);
  const needsAttentionPages = Math.max(1, Math.ceil(needsAttentionTotal / NEEDS_ATTENTION_PAGE_SIZE));
  const needsAttentionPageItems = needsAttentionItems;

  const REMINDERS_PAGE_SIZE = 5;
  const [reminderPage, setReminderPage] = useState(1);
  const [reminderPageItems, setReminderPageItems] = useState<CalendarEvent[]>([]);
  const [reminderTotal, setReminderTotal] = useState(0);
  useEffect(() => {
    if (!canViewReminders) return;
    const from = new Date().toISOString().slice(0, 10);
    const to = new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10);
    getCalendarEventsPage(from, to, reminderPage, REMINDERS_PAGE_SIZE)
      .then((res) => { setReminderPageItems(res.events); setReminderTotal(res.totalCount); })
      .catch(() => { setReminderPageItems([]); setReminderTotal(0); });
  }, [reminderPage, canViewReminders]);
  const reminderPages = Math.max(1, Math.ceil(reminderTotal / REMINDERS_PAGE_SIZE));

  const [calcW, setCalcW] = useState("10");
  const [calcP, setCalcP] = useState("22K");
  const activeSchemes = schemes.filter((s) => s.active);
  const [calcS, setCalcS] = useState(activeSchemes[0]?.id || "");

  // Schemes load async; re-point calcS at the first active scheme once the real list arrives.
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

      <div className="grid cols21 dash-grid">
        <div className="grid">
          <div className="kpis dashboard-kpis">
            <Kpi
              l="Cash in Hand"
              v={fmt(cashSummary ? cashSummary.cashInHand + cashSummary.bankBalance : cashInHand)}
              s={cashSummary ? (
                <>
                  <span style={{ display: "block", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>Cash {fmt(cashSummary.cashInHand)}</span>
                  <span style={{ display: "block", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>Bank {fmt(cashSummary.bankBalance)}</span>
                </>
              ) : undefined}
              cls="ok"
              href={link("ledger")}
            />
            <Kpi l="Loans Opened Today" v={openedToday} href={link("loans")} />
            <Kpi l="Active Loans" v={active.length} s={fmt(outstanding) + " outstanding"} href={link("loans/Active")} />
            <Kpi l="Due Soon" v={dueSoon.length} s="within 14 days" cls={dueSoon.length ? "warn" : ""} href={link(`loans/${encodeURIComponent("Due Soon")}`)} />
            <Kpi l="Overdue Loans" v={overdue.length} s={fmt(overdue.reduce((s, l) => s + l.outstanding, 0)) + " at risk"} cls={overdue.length ? "warn" : ""} href={link("loans/Overdue")} />
            <Kpi l="Pending Approvals" v={pendingApprovalLoans.length} s="awaiting sanction" cls={pendingApprovalLoans.length ? "warn" : ""} href={link(`loans/${encodeURIComponent("Pending Approval")}`)} />
            <Kpi l="Extension Requests" v={pendingReq.filter((r) => r.type === "Extension").length} s="from mobile app" href={link("requests")} />
            <Kpi l="Gold Release Requests" v={pendingReq.filter((r) => r.type === "Release").length} s="settlement review" href={link("requests")} />
            <Kpi l="Bank-Pledged Loans" v={pledged.length} s={fmt(pledged.reduce((s, l) => s + l.principal, 0)) + " re-pledged"} href={link("bankpledge")} />
            <Kpi l="Auction Cases" v={auctionLoans.length} s="notice stage" cls={auctionLoans.length ? "warn" : ""} href={link("auctions")} />
            <Kpi l="Today's Expenses" v={fmt(expToday)} href={link("ledger")} />
            <Kpi l="Interest Collected" v={fmt(interestCollected)} cls="ok" href={link("reports")} />
          </div>

          <div className="card gtop">
            <div className="hd"><h3>Loan Portfolio — Disbursement (last 6 months)</h3><div className="sp" />{canOpen("reports") ? <a href={routeHref("reports")} style={{ fontSize: 12.5 }}>All reports →</a> : null}</div>
            <div className="bd">
              <div className="bars">
                {monthBuckets.map(([m, v], i) => (
                  <div className="b" key={m + i}><em>₹{v.toFixed(1)}L</em><i style={{ height: `${(v / maxBar) * 100}%` }} /><span>{m}</span></div>
                ))}
              </div>
            </div>
          </div>

          <div className="card">
            <div className="hd"><h3>Needs Attention</h3><div className="sp" />{canOpen("requests") ? <a href={routeHref("requests")} style={{ fontSize: 12.5 }}>View all →</a> : null}</div>
            <div className="bd" style={{ paddingTop: 6 }}>
              <ul className="mini-list">
                {needsAttentionPageItems.length === 0 && (
                  <li><span className="tx"><small>Nothing needs attention right now.</small></span></li>
                )}
                {needsAttentionPageItems.map((item) => {
                  if (item.kind === "approval") {
                    const stage = stageLabel(workflow, item.flow, item.approvalStage);
                    if (item.flow === "expense") {
                      return (
                        <li key={"appr-exp-" + item.entityId}>
                          <span className="ic"><Icon name="stamp" /></span>
                          <span className="tx"><b>Expense approval — {item.detail || "Expense"}</b><small>{item.customerName} · {fmt(item.principal)}</small></span>
                          {canOpen("ledger") ? <span className="rt"><a className="btn sm" href={routeHref("ledger")}>Review</a></span> : null}
                        </li>
                      );
                    }
                    if (item.flow === "personal_loan") {
                      return (
                        <li key={"appr-pl-" + item.entityId}>
                          <span className="ic"><Icon name="stamp" /></span>
                          <span className="tx"><b>Personal loan approval — {item.loanNumber}</b><small>{item.customerName} · {fmt(item.principal)} · at {stage} stage</small></span>
                          {canOpen(`personalloan/${item.entityId}`) ? <span className="rt"><a className="btn sm" href={routeHref(`personalloan/${item.entityId}`)}>Review</a></span> : null}
                        </li>
                      );
                    }
                    return (
                      <li key={`appr-${item.flow}-${item.entityId}`}>
                        <span className="ic"><Icon name="stamp" /></span>
                        <span className="tx"><b>{item.flow === "loan_topup" ? "Top-up approval" : "Loan approval"} — {item.loanNumber}</b><small>{item.customerName} · {fmt(item.principal)} · at {stage} stage</small></span>
                        {canOpen(`loan/${item.loanNumber}`) ? <span className="rt"><a className="btn sm" href={routeHref(`loan/${item.loanNumber}`)}>Review</a></span> : null}
                      </li>
                    );
                  }
                  if (item.kind === "request") {
                    return (
                      <li key={"req-" + item.requestId}>
                        <span className="ic"><Icon name={item.requestType === "Extension" ? "clock" : item.requestType === "Release" ? "unlock" : "edit"} /></span>
                        <span className="tx"><b>{item.requestType} request — {item.loanNumber}</b><small>{item.customerName} · {item.detail}</small></span>
                        {canOpen("requests") ? <span className="rt"><a className="btn sm ghost" href={routeHref("requests")}>Open</a></span> : null}
                      </li>
                    );
                  }
                  return (
                    <li key={"auc-" + item.loanId}>
                      <span className="ic" style={{ background: "var(--red-bg)", color: "var(--red)" }}><Icon name="gavel" /></span>
                      <span className="tx"><b>Auction case — {item.loanNumber}</b><small>{item.customerName} · {fmt(item.outstanding)} outstanding · {item.status}</small></span>
                      {canOpen("auctions") ? <span className="rt"><a className="btn sm ghost" href={routeHref("auctions")}>Open</a></span> : null}
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
            <div className="hd"><h3>Today&apos;s Gold Rate</h3><div className="sp" /><span style={{ fontSize: 11.5, color: "var(--muted)" }}>{fmtDate(latest.date)}</span></div>
            <div className="bd">
              <div className="rates3" style={{ gridTemplateColumns: "1fr" }}>
                <RateTile k="24K · published" r={latest.k24} />
                <RateTile k="22K · computed" r={latest.k22} />
                <RateTile k="18K · computed" r={latest.k18} />
              </div>
            </div>
            <div className="ft">Set by {latest.setBy} · applies to all valuations today</div>
          </div>

          <div className="card">
            <div className="hd"><h3>Upcoming Reminders</h3><div className="sp" />{canOpen("calendar") ? <a href={routeHref("calendar")} style={{ fontSize: 12.5 }}>Calendar →</a> : null}</div>
            <div className="bd" style={{ paddingTop: 6 }}>
              <ul className="mini-list">
                {reminderPageItems.length ? reminderPageItems.map((e, i) => (
                  <li key={i}>
                    <span className="ic" style={e.type === "Overdue" ? { background: "var(--red-bg)", color: "var(--red)" } : e.type === "FollowUp" || e.type === "PromiseToPay" ? { background: "var(--info-bg)", color: "var(--info)" } : undefined}>
                      <Icon name={e.type === "FollowUp" ? "phone" : e.type === "PromiseToPay" ? "clock" : "bell"} />
                    </span>
                    <span className="tx"><b>{e.title}</b><small>{e.detail}{e.loanNumber ? ` · ${e.loanNumber}` : ""} · {fmtDate(e.date)}</small></span>
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
