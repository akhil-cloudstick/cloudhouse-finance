import React, { useEffect, useState } from "react";
import { View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import * as Sharing from "expo-sharing";
import { C, EmptyText, FlatHeader, PScroll, type GFSection, ReportRow, ReportSectionLabel, Screen, SearchInput, type AccDetail, openPage, toast } from "@/common/components/ui";
import { listCustomersPage } from "@/modules/customers/services/customerService";
import { listLoansPage } from "@/modules/loans/services/loanService";
import { listSchemesPage } from "@/modules/schemes/services/schemeService";
import { listPurityStandards } from "@/modules/purity-standards/services/purityStandardService";
import { listOrnamentTypes } from "@/modules/ornament-types/services/ornamentTypeService";
import { listLockersPage } from "@/modules/lockers/services/lockerService";
import { fetchRoles } from "@/modules/roles/services/roleService";
import { AUCTION_OUTCOME_LABELS } from "@/modules/auctions/types/auction-types";
import { listBanksPage } from "@/modules/banks/services/bankService";
import { listEmployeesPage } from "@/modules/employees/services/employeeService";
import { listInvestmentPlansPage } from "@/modules/investments/services/investmentService";
import { listExpenseCategoriesPage } from "@/modules/cash/services/cashService";
import { useTheme } from "@/common/theme/ThemeProvider";
import { TENANT_MODULES, type TenantModule } from "@/common/config/tenantModules";
import { getAuctions, getBalanceSheet, getBankPledge, getCommunicationHistory, getDepositRegister, getDisbursement, getEmployeePerformance, getExpenseCashflow, getGoldRateHistory, getGoldRateSetByPage, getGoldRelease, getGoldWeight, getInterestCollection, getInterestPayoutRegister, getKYC, getLoanExtensions, getLoansStatus, getMaturityRegister, getPackets, getPaymentCollection, getPersonalLoans, getProfitAndLoss } from "@/modules/reports/services/reportsService";
import { DayBookSheet } from "@/modules/reports/components/DayBookSheet";
import { type ReportFilters, type ReportResult } from "@/modules/reports/types/reports-types";
import { dmy, inr, todayISO } from "@/common/utils/format";
import { useCanOpen } from "@/common/config/routePermissions";
import * as Print from "expo-print";
import { downloadExport } from "@/modules/reports/services/reportDownload";
import { isUserCancel, userMessage } from "@/common/services/apiErrors";

// Reports — prototype #header-reports + #page-reports (grouped report rows)
// and #report-table-modal. Tapping a report opens its table in a sheet:
// server-paged (page / page_size = 10) with a server-side search (`q`) and
// optional from/to, rows as accordion rows, Export .xlsx + Print through the
// server export (GET /reports/export/:key). Balance Sheet / P&L / Form G are
// statements, rendered as statement lines inside the same sheet.

/* eslint-disable @typescript-eslint/no-explicit-any */
type RowView = { id?: string; name: string; sub?: string; amount?: string; status?: string; details?: AccDetail[] };
// "link" opens another screen instead of a report sheet (see `href`).
type Kind = "table" | "statement" | "formg" | "link" | "daybook";
export type ReportDef = {
  key: string;
  title: string;
  group: string;
  kind: Kind;
  fetch?: (f: ReportFilters) => Promise<ReportResult<any, any>>;
  row?: (r: any) => RowView;
  headline?: (t: any) => string;
  sub?: (t: any) => string;
  defaultRange?: () => { from?: string; to?: string };
  tenantModule?: TenantModule;
  href?: string;
  // Extra filter sections (beyond Branch / Date). Each selection is sent as its `param` (comma-joined) on the fetch and the export.
  filterGroups?: FilterGroup[];
};
type FilterGroup = { key: string; param: string; section: GFSection };

type Page = { q?: string; limit: number; offset: number };
const staticGroup = (param: string, label: string, options: (string | { value: string; label: string })[]): FilterGroup => ({
  key: param,
  param,
  section: { kind: "static", key: param, label, options: options.map((o) => (typeof o === "string" ? { value: o, label: o } : o)) },
});
const asyncGroup = (param: string, label: string, fetchPage: (p: Page) => Promise<{ items: { value: string; label: string }[]; hasMore: boolean }>): FilterGroup => ({
  key: param,
  param,
  section: { kind: "async", key: param, label, fetchPage },
});
// Backend-paged (limit/offset + search) option lists — never a full list.
const customerGroup = (param = "customer_id", label = "Customer") =>
  asyncGroup(param, label, (p) => listCustomersPage(p).then((r) => ({ items: r.items.map((c) => ({ value: String(c.id), label: c.name })), hasMore: r.hasMore })));
const loanGroup = () => asyncGroup("loan_id", "Loan", (p) => listLoansPage(p).then((r) => ({ items: r.items.map((l) => ({ value: String(l.id), label: l.loanNumber })), hasMore: r.hasMore })));
const schemeGroup = () => asyncGroup("scheme_id", "Scheme", (p) => listSchemesPage(p).then((r) => ({ items: r.items.map((x) => ({ value: String(x.id), label: x.name })), hasMore: r.hasMore })));
const bankGroup = () => asyncGroup("bank_id", "Bank", (p) => listBanksPage(p).then((r) => ({ items: r.items.map((b) => ({ value: String(b.id), label: b.name })), hasMore: r.hasMore })));
const employeeGroup = (label = "Employee") =>
  asyncGroup("employee_id", label, (p) => listEmployeesPage(p).then((r) => ({ items: r.items.map((e) => ({ value: String(e.id), label: e.name })), hasMore: r.hasMore })));
// "Set By" is the free-text name a gold rate was signed with, so the options are those names (paged, searchable).
const setByGroup = () =>
  asyncGroup("set_by", "Set By", (p) => getGoldRateSetByPage(p).then((r) => ({ items: r.items.map((n) => ({ value: n, label: n })), hasMore: r.hasMore })));
const planGroup = () => asyncGroup("plan_id", "Plan", (p) => listInvestmentPlansPage(p).then((r) => ({ items: (r.items ?? []).map((x) => ({ value: String(x.id), label: x.name })), hasMore: r.hasMore })));
const expenseCategoryGroup = () =>
  asyncGroup("expense_category_id", "Expense Category", (p) =>
    listExpenseCategoriesPage(p.q ?? "", Math.floor(p.offset / p.limit), p.limit, true).then((r) => ({ items: r.items.map((c) => ({ value: String(c.id), label: c.name })), hasMore: r.hasMore })),
  );
// Purity as an ornament stores it ("22K") so the report's exact match works; same options as web.
// Falls back to 24K–10K when the purity-standard list is empty or unavailable.
const purityGroup = (): FilterGroup =>
  asyncGroup("purity", "Purity (karat)", async (p) => {
    let karats: number[] = [];
    try {
      const r = await listPurityStandards();
      karats = (Array.isArray(r) ? r : []).map((x: { karat?: number }) => x.karat).filter((k): k is number => k != null);
    } catch {
      /* fall back below */
    }
    if (karats.length === 0) karats = Array.from({ length: 15 }, (_, i) => 24 - i);
    const term = (p.q ?? "").trim().toLowerCase();
    const items = [...new Set(karats)]
      .sort((a, b) => b - a)
      .map((k) => ({ value: `${k}K`, label: `${k}K` }))
      .filter((o) => !term || o.label.toLowerCase().includes(term));
    return { items, hasMore: false };
  });
const INVESTMENT_STATUSES =["Active", "Matured", "Renewed", "Closed"];
// Same extra filters as web's ReportsPage: ornament type, locker, role (live role list, seeded roles as a fallback).
const ornamentTypeGroup = () =>
  asyncGroup("ornament_type", "Ornament Type", (p) => listOrnamentTypes(p.q).then((r) => ({ items: (r ?? []).slice(p.offset, p.offset + p.limit).map((t) => ({ value: t.name, label: t.name })), hasMore: (r ?? []).length > p.offset + p.limit })));
const lockerGroup = () =>
  asyncGroup("locker_id", "Locker", (p) => listLockersPage({ q: p.q, limit: p.limit, offset: p.offset }).then((r) => ({ items: (r.items ?? []).map((l) => ({ value: String(l.id), label: l.code })), hasMore: r.hasMore })));
const DEFAULT_ROLES = ["Administrator", "Management", "Branch Manager", "Loan Operator", "Cashier", "Accountant", "Collection Staff", "Auction Administrator", "Auditor"];
const roleGroup = () =>
  asyncGroup("role", "Role", async (p) => {
    if (p.offset > 0) return { items: [], hasMore: false };
    let names = DEFAULT_ROLES;
    try {
      const rs = await fetchRoles();
      if (rs.length) names = rs.map((r) => r.name);
    } catch {
      /* seeded roles */
    }
    const term = (p.q ?? "").trim().toLowerCase();
    return { items: names.filter((n) => !term || n.toLowerCase().includes(term)).map((n) => ({ value: n, label: n })), hasMore: false };
  });
const VERIFY_STATUSES = ["Verified", "Pending", "Failed", "Name Mismatch"];

const w = (n?: number | null) => `${(n ?? 0).toFixed(2)} g`;
export const firstOfMonth = () => `${todayISO().slice(0, 8)}01`;
const monthsAgo = (months: number) => {
  const d = new Date();
  d.setMonth(d.getMonth() - months);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

export const REPORTS: ReportDef[] = [
  // Loans & Collections
  {
    key: "disbursement",
    title: "Daily Loan Disbursement",
    group: "Loans & Collections",
    kind: "table",
    filterGroups: [customerGroup(), schemeGroup()],
    fetch: getDisbursement,
    headline: (t) => inr(t?.totalAmount),
    sub: (t) => `${t?.count ?? 0} loans`,
    row: (r) => ({ id: r.loanNumber, name: r.customerName, sub: dmy(r.openedDate), amount: inr(r.amount), details: [{ k: "Opened", v: dmy(r.openedDate) }, { k: "Amount", v: inr(r.amount) }, { k: "Branch", v: r.branchName || "—" }, { k: "Scheme", v: r.schemeName || "—" }] }),
  },
  {
    key: "loans-status",
    title: "Active / Closed / Overdue Loans",
    group: "Loans & Collections",
    kind: "table",
    filterGroups: [customerGroup(), staticGroup("status", "Status", ["Active", "Due Soon", "Overdue", "Defaulted", "Closed"])],
    fetch: getLoansStatus,
    headline: (t) => `${t?.count ?? 0} loans`,
    sub: (t) => `${t?.active ?? 0} active · ${t?.overdue ?? 0} overdue · ${t?.defaulted ?? 0} defaulted · ${t?.dueSoon ?? 0} due soon · ${t?.closed ?? 0} closed`,
    row: (r) => ({ id: r.loanNumber, name: r.customerName, sub: `Due ${dmy(r.dueDate)}`, amount: inr(r.outstanding), status: r.status, details: [{ k: "Status", v: r.status || "—" }, { k: "Due date", v: dmy(r.dueDate) }, { k: "Branch", v: r.branchName || "—" }, { k: "Outstanding", v: inr(r.outstanding) }] }),
  },
  {
    key: "interest-collection",
    title: "Interest & Penal Collection",
    group: "Loans & Collections",
    kind: "table",
    filterGroups: [customerGroup()],
    fetch: getInterestCollection,
    headline: (t) => inr(t?.total),
    sub: (t) => `${inr(t?.totalInterest)} interest · ${inr(t?.totalPenal)} penal`,
    row: (r) => ({
      id: r.loanNumber,
      name: dmy(r.paidOn),
      sub: r.branchName,
      amount: inr((r.interestApplied ?? 0) + (r.penalApplied ?? 0)),
      details: [{ k: "Loan #", v: r.loanNumber || "—" }, { k: "Paid on", v: dmy(r.paidOn) }, { k: "Interest", v: inr(r.interestApplied) }, { k: "Penal", v: inr(r.penalApplied) }, { k: "Branch", v: r.branchName || "—" }],
    }),
  },
  {
    key: "payment-collection",
    title: "Payment Collection",
    group: "Loans & Collections",
    kind: "table",
    filterGroups: [customerGroup(), staticGroup("payment_type", "Payment Type", ["Interest", "Penal Interest", "Principal", "Partial", "Full Settlement", "Waiver", "Discount", "Auction Sale", "Auction Write-Off"])],
    fetch: getPaymentCollection,
    headline: (t) => inr(t?.totalAmount),
    sub: (t) => `${t?.count ?? 0} payments`,
    row: (r) => ({ id: r.loanNumber, name: r.type, sub: dmy(r.paidOn), amount: inr(r.amount), details: [{ k: "Paid on", v: dmy(r.paidOn) }, { k: "Type", v: r.type || "—" }, { k: "Branch", v: r.branchName || "—" }, { k: "Collected by", v: r.employeeName || "—" }] }),
  },
  // Gold & Custody
  {
    key: "gold-weight",
    title: "Gold / Ornament & Weight",
    group: "Gold & Custody",
    kind: "table",
    filterGroups: [customerGroup(), ornamentTypeGroup(), purityGroup()],
    fetch: getGoldWeight,
    headline: (t) => w(t?.totalNetWeight),
    sub: (t) => `${w(t?.totalGrossWeight)} gross · ${inr(t?.totalGoldValue)} total value`,
    row: (r) => ({
      id: r.loanNumber,
      name: r.name,
      sub: r.customerName,
      amount: inr(r.goldValue),
      details: [{ k: "Customer", v: r.customerName || "—" }, { k: "Purity", v: r.purity || "—" }, { k: "Gross wt", v: w(r.grossWeight) }, { k: "Net wt", v: w(r.netWeight) }, { k: "Value", v: inr(r.goldValue) }],
    }),
  },
  {
    key: "packets",
    title: "Packet Tracking & Locker",
    group: "Gold & Custody",
    kind: "table",
    filterGroups: [customerGroup(), loanGroup(), staticGroup("status", "Status", ["Locker Stored", "Bank Pledged", "Returned", "Released"]), lockerGroup()],
    fetch: getPackets,
    headline: (t) => `${t?.count ?? 0} packets`,
    sub: (t) => `${t?.inLocker ?? 0} in locker · ${t?.bankPledged ?? 0} pledged · ${t?.released ?? 0} released`,
    row: (r) => ({ id: r.code, name: r.loanNumber, sub: r.lockerCode ? `Locker ${r.lockerCode}` : undefined, status: r.status, details: [{ k: "Packet code", v: r.code || "—" }, { k: "Loan #", v: r.loanNumber || "—" }, { k: "Status", v: r.status || "—" }, { k: "Locker", v: r.lockerCode || "—" }, { k: "Movements", v: String(r.movementCount ?? 0) }] }),
  },
  {
    key: "bank-pledge",
    title: "Bank Pledge & Liability",
    group: "Gold & Custody",
    kind: "table",
    filterGroups: [bankGroup(), staticGroup("status", "Status", ["Active", "Released"])],
    fetch: getBankPledge,
    headline: (t) => inr(t?.outstandingLiability),
    sub: (t) => `${t?.count ?? 0} pledge records`,
    row: (r) => ({
      id: r.loanNumber,
      name: r.bankName,
      sub: dmy(r.pledgeDate),
      amount: inr(r.pledgedAmount),
      status: r.status,
      details: [{ k: "Loan #", v: r.loanNumber || "—" }, { k: "Pledged amount", v: inr(r.pledgedAmount) }, { k: "Pledged on", v: dmy(r.pledgeDate) }, { k: "Released on", v: dmy(r.releaseDate) }, { k: "Status", v: r.status || "—" }],
    }),
  },
  {
    key: "loan-extensions",
    title: "Loan Extensions",
    group: "Gold & Custody",
    kind: "table",
    filterGroups: [customerGroup(), staticGroup("status", "Status", ["Pending", "Approved", "Rejected"])],
    fetch: getLoanExtensions,
    headline: (t) => `${t?.count ?? 0} requests`,
    sub: () => "Requested tenure extensions",
    row: (r) => ({
      id: r.loanNumber,
      name: `${r.months ?? "—"} months`,
      sub: `Requested ${dmy(r.requestedAt)}`,
      status: r.status,
      details: [{ k: "Loan #", v: r.loanNumber || "—" }, { k: "Months", v: String(r.months ?? "—") }, { k: "New due date", v: dmy(r.newDueDate) }, { k: "Requested on", v: dmy(r.requestedAt) }, { k: "Status", v: r.status || "—" }],
    }),
  },
  {
    key: "gold-release",
    title: "Gold Release / Closure",
    group: "Gold & Custody",
    kind: "table",
    filterGroups: [customerGroup(), loanGroup(), staticGroup("status", "Status", ["Pending", "Approved", "Rejected"])],
    fetch: getGoldRelease,
    headline: (t) => `${t?.count ?? 0} releases`,
    sub: (t) => `${inr(t?.totalSettlement)} total settlement`,
    row: (r) => ({ id: r.loanNumber, name: r.customerName, sub: dmy(r.requestedAt), amount: inr(r.settlementAmount), status: r.status, details: [{ k: "Loan #", v: r.loanNumber || "—" }, { k: "Customer", v: r.customerName || "—" }, { k: "Requested on", v: dmy(r.requestedAt) }, { k: "Status", v: r.status || "—" }, { k: "Settlement", v: inr(r.settlementAmount) }] }),
  },
  {
    key: "auctions",
    title: "Auction Reports",
    group: "Gold & Custody",
    kind: "table",
    filterGroups: [customerGroup(), loanGroup(), staticGroup("settlement", "Settlement", Object.entries(AUCTION_OUTCOME_LABELS).map(([value, label]) => ({ value, label })))],
    fetch: getAuctions,
    headline: (t) => `${t?.count ?? 0} auctions`,
    sub: (t) => `${inr(t?.totalSaleAmount)} total sale amount`,
    row: (r) => ({ id: r.loanNumber, name: r.stage, sub: dmy(r.auctionDate), amount: inr(r.saleAmount), status: AUCTION_OUTCOME_LABELS[r.settlementStatus as keyof typeof AUCTION_OUTCOME_LABELS] ?? r.settlementStatus, details: [{ k: "Loan #", v: r.loanNumber || "—" }, { k: "Stage", v: r.stage || "—" }, { k: "Auction date", v: dmy(r.auctionDate) }, { k: "Sale amount", v: inr(r.saleAmount) }] }),
  },
  // Branch & Compliance
  {
    key: "expense-cashflow",
    title: "Expense & Cash Flow",
    group: "Branch & Compliance",
    kind: "table",
    filterGroups: [staticGroup("collection_mode", "Collection Mode", [{ value: "cash", label: "Cash" }, { value: "upi", label: "UPI" }, { value: "bank_transfer", label: "Bank Transfer" }, { value: "cheque", label: "Cheque" }]), expenseCategoryGroup()],
    fetch: getExpenseCashflow,
    headline: (t) => inr(t?.netCashflow),
    sub: (t) => `${inr(t?.totalCollections)} in · ${inr(t?.totalDisbursements)} out · ${inr(t?.totalExpenses)} expenses`,
    row: (r) => ({
      name: r.branchName,
      sub: dmy(r.date),
      amount: inr((r.collections ?? 0) - (r.disbursements ?? 0) - (r.cashExpenses ?? 0)),
      details: [
        { k: "Collections", v: inr(r.collections), color: C.green },
        { k: "Disbursements", v: inr(r.disbursements) },
        { k: "Cash expenses", v: inr(r.cashExpenses) },
      ],
    }),
  },
  {
    key: "kyc",
    title: "KYC Verification",
    group: "Branch & Compliance",
    kind: "table",
    filterGroups: [customerGroup(), staticGroup("kyc_status", "KYC", VERIFY_STATUSES), staticGroup("pan_status", "PAN", VERIFY_STATUSES), staticGroup("aadhaar_status", "Aadhaar", VERIFY_STATUSES)],
    fetch: getKYC,
    headline: (t) => `${t?.count ?? 0} customers`,
    sub: (t) => `${t?.verified ?? 0} verified · ${t?.pending ?? 0} pending`,
    row: (r) => ({ id: r.code, name: r.name, sub: r.phone, status: r.kycStatus, details: [{ k: "Customer code", v: r.code || "—" }, { k: "Phone", v: r.phone || "—" }, { k: "KYC", v: r.kycStatus || "—" }, { k: "PAN", v: r.panStatus || "—" }, { k: "Aadhaar", v: r.aadhaarStatus || "—" }] }),
  },
  {
    key: "gold-rate-history",
    title: "Gold Rate History",
    group: "Branch & Compliance",
    kind: "table",
    filterGroups: [setByGroup()],
    fetch: getGoldRateHistory,
    headline: (t) => `${t?.count ?? 0} rates`,
    sub: () => "Published daily rates",
    row: (r) => ({ name: `${inr(r.k24)} / g (24K)`, sub: dmy(r.date), details: [{ k: "Date", v: dmy(r.date) }, { k: "Set by", v: r.setBy || "—" }] }),
  },
  {
    key: "employee-performance",
    title: "Employee Performance",
    group: "Branch & Compliance",
    kind: "table",
    filterGroups: [employeeGroup(), roleGroup()],
    fetch: getEmployeePerformance,
    headline: (t) => `${t?.totalLoansProcessed ?? 0} loans processed`,
    sub: (t) => `${inr(t?.totalCollections)} collected`,
    row: (r) => ({
      name: r.name,
      sub: [r.role, r.branchName].filter(Boolean).join(" · "),
      amount: inr(r.collectionsAmount),
      details: [
        ...(r.employeeCode ? [{ k: "Employee ID", v: r.employeeCode }] : []),
        { k: "Loans processed", v: String(r.loansProcessed ?? 0) },
        { k: "Reminders sent", v: String(r.remindersSent ?? 0) },
        { k: "Approvals", v: String(r.approvals ?? 0) },
        { k: "Branch", v: r.branchName || "—" },
      ],
    }),
  },
  {
    key: "communication-history",
    title: "Communication History",
    group: "Branch & Compliance",
    kind: "table",
    filterGroups: [employeeGroup(), staticGroup("channel", "Channel", ["WhatsApp"]), staticGroup("status", "Status", ["sent", "failed"]), staticGroup("trigger_type", "Trigger Type", ["loan_sanction", "payment", "closure", "auction_notice", "reminder", "otp"])],
    fetch: getCommunicationHistory,
    headline: (t) => `${t?.count ?? 0} messages`,
    sub: (t) => `${t?.sent ?? 0} sent · ${t?.failed ?? 0} failed`,
    row: (r) => ({ name: r.recipientName, sub: `${r.channel} · ${dmy(r.sentAt)}`, status: r.status, details: [{ k: "Phone", v: r.recipientPhone || "—" }, { k: "Channel", v: r.channel || "—" }, { k: "Trigger", v: r.triggerType || "—" }, { k: "Sent at", v: dmy(r.sentAt) }] }),
  },
  {
    key: "personal-loans",
    title: "Personal Loans",
    group: "Branch & Compliance",
    tenantModule: TENANT_MODULES.personalLoans,
    kind: "table",
    filterGroups: [customerGroup(), staticGroup("frequency", "Frequency", ["Daily", "Weekly", "Monthly"])],
    fetch: getPersonalLoans,
    headline: (t) => inr(t?.totalOutstanding),
    sub: (t) => `${t?.count ?? 0} loans · ${inr(t?.totalDisbursed)} disbursed`,
    row: (r) => ({
      id: r.loanNumber,
      name: r.customerName,
      sub: `${r.frequency} · ${dmy(r.openedDate)}`,
      amount: inr(r.outstandingAmount),
      status: r.status,
      details: [{ k: "Principal", v: inr(r.principalAmount) }, { k: "Disbursed", v: inr(r.disbursedAmount) }, { k: "Branch", v: r.branchName || "—" }],
    }),
  },
  // Financial Statements
  {
    key: "balance-sheet",
    title: "Balance Sheet",
    group: "Financial Statements",
    kind: "statement",
    fetch: getBalanceSheet,
    defaultRange: () => ({ to: todayISO() }),
    headline: (t) => `${inr(t?.totalAssets)} assets`,
    sub: (t) => `${inr(t?.totalLiabilities)} liabilities · ${inr(t?.totalEquity)} equity`,
  },
  {
    key: "profit-loss",
    title: "Statement of Profit and Loss",
    group: "Financial Statements",
    kind: "statement",
    fetch: getProfitAndLoss,
    defaultRange: () => ({ from: firstOfMonth(), to: todayISO() }),
    headline: (t) => `${inr(t?.profitForPeriod)} profit for the period`,
    sub: (t) => `${inr(t?.totalIncome)} income · ${inr(t?.totalExpenses)} expenses`,
  },
  {
    key: "form-g",
    title: "Form G — Statement of Accounts",
    group: "Financial Statements",
    kind: "formg",
    defaultRange: () => ({ from: monthsAgo(3), to: todayISO() }),
  },
  // Web's "Ledger / Statement Export" tile — its own page inside Reports
  // (app/(tabs)/ledger-statement.tsx): Branch/Customer/Type/Date filters,
  // running balance, clickable loan/customer/bank/category/mode links and a
  // PDF / Excel export of whatever the filters show.
  {
    key: "ledger-export",
    title: "Ledger Report",
    group: "Financial Statements",
    kind: "link",
    href: "/ledger-statement?from=reports",
  },
  // Hand-entered Day Book — its own sheet (DayBookSheet).
  {
    key: "day-book",
    title: "Day Book",
    group: "Financial Statements",
    kind: "daybook",
  },
  // Investments
  {
    key: "investments-deposit-register",
    title: "Investment Deposit Register",
    group: "Investments",
    tenantModule: TENANT_MODULES.investments,
    kind: "table",
    filterGroups: [customerGroup("investor_id", "Investor"), planGroup(), staticGroup("status", "Status", INVESTMENT_STATUSES)],
    fetch: getDepositRegister,
    headline: (t) => inr(t?.totalPrincipal),
    sub: (t) => `${t?.count ?? 0} deposits`,
    row: (r) => ({
      id: r.investmentNumber,
      name: r.customerName,
      sub: r.planName,
      amount: inr(r.principalAmount),
      status: r.status,
      details: [{ k: "Rate", v: `${r.interestRate}%` }, { k: "Start date", v: dmy(r.startDate) }, { k: "Maturity date", v: dmy(r.maturityDate) }, { k: "Branch", v: r.branchName || "—" }],
    }),
  },
  {
    key: "investments-interest-payout-register",
    title: "Interest Payout Register",
    group: "Investments",
    tenantModule: TENANT_MODULES.investments,
    kind: "table",
    filterGroups: [customerGroup("investor_id", "Investor"), planGroup(), staticGroup("status", "Status", ["Pending", "Paid"])],
    fetch: getInterestPayoutRegister,
    headline: (t) => `${inr(t?.totalPending)} pending`,
    sub: (t) => `${inr(t?.totalPaid)} paid of ${inr(t?.totalDue)}`,
    row: (r) => ({ id: `${r.investmentNumber} #${r.sequenceNo}`, name: r.customerName, sub: `Due ${dmy(r.dueDate)}`, amount: inr(r.amount), status: r.status, details: [{ k: "Due date", v: dmy(r.dueDate) }, { k: "Paid on", v: dmy(r.paidAt) }] }),
  },
  {
    key: "investments-maturity-register",
    title: "Investment Maturity Register",
    group: "Investments",
    tenantModule: TENANT_MODULES.investments,
    kind: "table",
    filterGroups: [customerGroup("investor_id", "Investor"), planGroup(), staticGroup("status", "Status", INVESTMENT_STATUSES)],
    fetch: getMaturityRegister,
    headline: (t) => `${t?.count ?? 0} investments`,
    sub: (t) => `${t?.active ?? 0} active · ${t?.matured ?? 0} matured · ${t?.renewed ?? 0} renewed · ${t?.closed ?? 0} closed`,
    row: (r) => ({ id: r.investmentNumber, name: r.customerName, sub: `Matures ${dmy(r.maturityDate)}`, amount: inr(r.principalAmount), status: r.status, details: [{ k: "Maturity date", v: dmy(r.maturityDate) }, { k: "Branch", v: r.branchName || "—" }] }),
  },
];
const GROUPS = ["Loans & Collections", "Gold & Custody", "Branch & Compliance", "Financial Statements", "Investments"];

export default function ReportsScreen() {
  const { hasModule } = useTheme();
  const [search, setSearch] = useState("");
  const router = useRouter();
  const [dayBookOpen, setDayBookOpen] = useState(false);

  const canOpen = useCanOpen();
  // A "link" row (e.g. Ledger / Statement) only when its page may be opened.
  const available = REPORTS.filter((r) => (!r.tenantModule || hasModule(r.tenantModule)) && (r.kind !== "link" || !r.href || canOpen(r.href)));
  // Static list of report titles (not data) — filtered locally.
  const needle = search.trim().toLowerCase();
  const shown = needle ? available.filter((r) => r.title.toLowerCase().includes(needle)) : available;

  // Dashboard tiles deep-link here with ?section=<key>; `t` re-applies it per tap.
  const params = useLocalSearchParams<{ section?: string; t?: string }>();
  const openReport = (r: ReportDef) => {
    if (r.kind === "link" && r.href) openPage(`${r.href}&t=${Date.now()}`);
    else if (r.kind === "daybook") setDayBookOpen(true);
    else router.push(`/reports/${r.key}` as never);
  };
  useEffect(() => {
    const target = available.find((r) => r.key === params.section);
    if (target) openReport(target);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.section, params.t]);

  return (
    <Screen header={<FlatHeader title="Reports" subtitle="Branch reports & summaries" />}>
      <PScroll>
        <SearchInput value={search} onChangeText={setSearch} placeholder="Search reports" style={{ paddingTop: 12, paddingBottom: 0 }} />
        {GROUPS.map((g) => {
          const rows = shown.filter((r) => r.group === g);
          if (!rows.length) return null;
          return (
            <View key={g}>
              <ReportSectionLabel>{g}</ReportSectionLabel>
              {rows.map((r) => (
                <ReportRow key={r.key} title={r.title} onPress={() => openReport(r)}  />
              ))}
            </View>
          );
        })}
        {shown.length === 0 ? <EmptyText>No reports match your search.</EmptyText> : null}
      </PScroll>
      <DayBookSheet visible={dayBookOpen} onClose={() => setDayBookOpen(false)} />
    </Screen>
  );
}
