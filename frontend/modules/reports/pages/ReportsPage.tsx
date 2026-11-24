"use client";

import { useState } from "react";
import { useBranding } from "@/common/providers/BrandingProvider";
import { Icon } from "@/common/components/Icon";
import { useToast } from "@/common/components/ToastProvider";
import { useModal } from "@/common/components/ModalProvider";
import { ExportFormatModal, type ExportKind } from "@/modules/reports/components/ExportMenu";
import { ApiError } from "@/common/services/httpClient";
import { fmt, fmtW, fmtDate } from "@/common/utils/format";
import { FormGReportView } from "@/modules/reports/components/FormGReportView";
import { ReportView, type ReportConfig } from "@/modules/reports/components/ReportView";
import { LedgerExportView } from "@/modules/reports/components/LedgerExportView";
import { DayBookReportView } from "@/modules/reports/components/DayBookReportView";
import { getDisbursement, getPersonalLoans, getLoansStatus, getInterestCollection, getPaymentCollection, getGoldWeight, getPackets, getBankPledge, getLoanExtensions, getGoldRelease, getAuctions, getExpenseCashflow, getKYC, getGoldRateHistory, searchGoldRateSetByPage, getEmployeePerformance, getCommunicationHistory, getBalanceSheet, getProfitAndLoss, exportReport, getDepositRegister, getInterestPayoutRegister, getMaturityRegister } from "@/modules/reports/services/reportsService";
import { searchCustomersPage } from "@/modules/customers/services/customerService";
import { searchInvestorsPage } from "@/modules/investments/services/investorService";
import { searchLockersPage } from "@/modules/lockers/services/lockerService";
import { searchOrnamentTypesPage } from "@/modules/ornament-types/services/ornamentTypeService";
import { fetchRoles } from "@/common/services/permissionService";
import { DEFAULT_ROLES } from "@/modules/employees/components/EmployeeModalContent";
import { AUCTION_OUTCOME_LABELS } from "@/modules/loans/services/loanService";
import { searchLoansPage } from "@/modules/loans/services/loanService";
import { searchActiveSchemesPage } from "@/modules/schemes/services/schemeService";
import { searchBanksPage } from "@/modules/banks/services/bankService";
import { listEmployeesPage } from "@/modules/employees/services/employeeService";
import { searchInvestmentPlansPage } from "@/modules/investments/services/investmentService";
import { searchSelectableExpenseCategoriesPage } from "@/modules/cash/services/expenseCategoryService";
import { searchPurityStandardsPage } from "@/modules/purity-standards/services/purityStandardService";
import { type ReportFilters, type StatementStyle } from "@/modules/reports/types/reports-types";
import { useIsSmallScreen } from "@/common/utils/responsive";
import { singleFlight } from "@/common/utils/singleFlight";
import { navigate } from "@/common/services/appRoutes";

/* Shared row renderer for the two "printed statement" reports (Balance
 * Sheet, Statement of P&L) — one row per line exactly as a real Ind AS
 * Division III statement lays it out (see reportsService's doc comment),
 * so both tiles need the same bold/indent treatment off style+indent
 * rather than a per-report render function. */
function statementLabelCell(label: string, style: StatementStyle, indent: number) {
  return <span style={{ fontWeight: style ? 700 : 400, paddingLeft: indent * 16 }}>{label}</span>;
}
function statementAmountCell(amount: number, style: StatementStyle) {
  if (style === "header") return null;
  return <span style={{ fontWeight: style === "total" ? 700 : 400 }}>{fmt(amount)}</span>;
}

function firstOfMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}
function today(): string {
  return new Date().toISOString().slice(0, 10);
}
function subMonths(dateStr: string, months: number): string {
  const d = new Date(dateStr + "T00:00:00");
  d.setMonth(d.getMonth() - months);
  return d.toISOString().slice(0, 10);
}

const dt = fmtDate;

/* Filter-group builders. Async groups page through the backend (never a full list); labels read "Name (CODE)". */
type Group = NonNullable<ReportConfig["filterGroups"]>[number];
const withCode = (name: string, code?: string) => (code ? `${name} (${code})` : name);
const customerGroup = (): Group => ({
  key: "customer", label: "Customer", param: "customerId",
  fetchOptions: async (q, p) => { const r = await searchCustomersPage(q, p - 1); return { items: r.items.map((c) => ({ value: c.id, label: withCode(c.name, c.code) })), hasMore: r.hasMore }; },
});
const investorGroup = (): Group => ({
  key: "investor", label: "Investor", param: "investorId",
  fetchOptions: async (q, p) => { const r = await searchInvestorsPage(q, p - 1); return { items: r.items.map((c) => ({ value: c.id, label: withCode(c.name, c.code) })), hasMore: r.hasMore }; },
});
const loanGroup = (): Group => ({
  key: "loan", label: "Loan", param: "loanId",
  fetchOptions: async (q, p) => { const r = await searchLoansPage(q, p - 1); return { items: r.items.map((l) => ({ value: String(l.numericId), label: withCode(l.loanNumber, l.customerName) })), hasMore: r.hasMore }; },
});
const schemeGroup = (): Group => ({
  key: "scheme", label: "Scheme", param: "schemeId",
  fetchOptions: async (q, p) => { const r = await searchActiveSchemesPage(q, p - 1); return { items: r.items.map((x) => ({ value: x.id, label: withCode(x.name, x.code) })), hasMore: r.hasMore }; },
});
const bankGroup = (): Group => ({
  key: "bank", label: "Bank", param: "bankId",
  fetchOptions: async (q, p) => { const r = await searchBanksPage(q, p - 1); return { items: r.items.map((b) => ({ value: String(b.id), label: b.name })), hasMore: r.hasMore }; },
});
const employeeGroup = (label = "Employee"): Group => ({
  key: "employee", label, param: "employeeId",
  // FilterPanel asks for 1-based pages: listEmployeesPage is 1-based, the other pickers are 0-based (p - 1).
  fetchOptions: async (q, p) => { const r = await listEmployeesPage(p, 20, q); return { items: r.items.map((e) => ({ value: String(e.id), label: withCode(e.name, e.code) })), hasMore: r.hasMore }; },
});
// "Set By" is a free-text name on each gold rate, so the options are those names (backend-paged), not employees.
const setByGroup = (): Group => ({
  key: "setBy", label: "Set By", param: "setBy",
  fetchOptions: async (q, p) => { const r = await searchGoldRateSetByPage(q, p - 1); return { items: r.items.map((n) => ({ value: n, label: n })), hasMore: r.hasMore }; },
});
const planGroup = (): Group => ({
  key: "plan", label: "Plan", param: "planId",
  fetchOptions: async (q, p) => { const r = await searchInvestmentPlansPage(q, p - 1); return { items: r.items.map((x) => ({ value: String(x.id), label: x.name })), hasMore: r.hasMore }; },
});
const expenseCategoryGroup = (): Group => ({
  key: "expenseCategory", label: "Expense Category", param: "expenseCategoryId",
  fetchOptions: async (q, p) => { const r = await searchSelectableExpenseCategoriesPage(q, p - 1); return { items: r.items.map((x) => ({ value: String(x.id), label: x.name })), hasMore: r.hasMore }; },
});
const purityGroup = (): Group => ({
  key: "purity", label: "Purity (karat)", param: "purity",
  // Options are plain karats ("22K"): that is how an ornament's purity is stored, so the value matches it exactly.
  // When the purity-standard list is empty or unavailable, the usual karats 24K–10K are offered instead.
  fetchOptions: async (q, p) => {
    let karats: number[] = [];
    try {
      const r = await searchPurityStandardsPage("", p - 1);
      karats = r.items.map((x) => x.karat).filter((k): k is number => k != null);
    } catch { /* fall back below */ }
    if (karats.length === 0 && p <= 1) karats = Array.from({ length: 15 }, (_, i) => 24 - i);
    const term = q.trim().toLowerCase();
    const items = [...new Set(karats)].sort((a, b) => b - a).map((k) => ({ value: `${k}K`, label: `${k}K` }))
      .filter((o) => !term || o.label.toLowerCase().includes(term));
    return { items, hasMore: false };
  },
});
const ornamentTypeGroup = (): Group => ({
  key: "ornamentType", label: "Ornament Type", param: "ornamentType",
  fetchOptions: async (q, p) => { const r = await searchOrnamentTypesPage(q, p - 1); return { items: r.items.map((t) => ({ value: t.name, label: t.name })), hasMore: r.hasMore }; },
});
const lockerGroup = (): Group => ({
  key: "locker", label: "Locker", param: "lockerId",
  fetchOptions: async (q, p) => { const r = await searchLockersPage(q, p - 1); return { items: r.items.map((l) => ({ value: String(l.id), label: l.code })), hasMore: r.hasMore }; },
});
// Roles come from the live role list (custom roles too); without the role-view permission the seeded roles are offered.
const roleGroup = (): Group => ({
  key: "role", label: "Role", param: "role",
  fetchOptions: async (q, p) => {
    if (p > 1) return { items: [], hasMore: false };
    let names = DEFAULT_ROLES;
    try { const rs = await fetchRoles(); if (rs.length) names = rs.map((r) => r.name); } catch { /* seeded roles */ }
    const term = q.trim().toLowerCase();
    return { items: names.filter((n) => !term || n.toLowerCase().includes(term)).map((n) => ({ value: n, label: n })), hasMore: false };
  },
});
const verifyStatusGroup = (key: string, label: string, param: keyof ReportFilters): Group => ({
  key, label, param, options: ["Verified", "Pending", "Failed", "Name Mismatch"],
});
const statusGroup = (options: string[]): Group => ({ key: "status", label: "Status", param: "status", options });

/* One config per report — icon/title/description mirror the old static
 * REPORTS grid (legacy/app.js's `renderReports()`) so the tile grid's look
 * doesn't change; only the click behavior does (see ReportView). */
const REPORT_CONFIGS: ReportConfig[] = [
  {
    id: "disbursement",
    title: "Daily Loan Disbursement",
    description: "Loans opened per day with amounts",
    icon: "chart",
    exportKey: "disbursement",
    fetchFn: getDisbursement,
    rowKey: (r) => r.loanId,
    filterGroups: [customerGroup(), schemeGroup()],
    columns: [
      { key: "loanNumber", label: "Loan #", render: (r) => r.loanNumber },
      { key: "customerName", label: "Customer", render: (r) => r.customerName },
      { key: "schemeName", label: "Scheme", render: (r) => r.schemeName },
      { key: "branchName", label: "Branch", render: (r) => r.branchName },
      { key: "openedDate", label: "Opened", render: (r) => dt(r.openedDate) },
      { key: "amount", label: "Amount", numeric: true, render: (r) => fmt(r.amount) },
    ],
    totals: (t) => [{ label: "Loans", value: String(t.count) }, { label: "Total Amount", value: fmt(t.totalAmount) }],
  },
  {
    id: "personal-loans",
    title: "Personal Loans",
    description: "Personal loans opened per day with amounts",
    icon: "note",
    exportKey: "personal-loans",
    tenantModule: "personal_loans",
    fetchFn: getPersonalLoans,
    rowKey: (r) => r.loanId,
    filterGroups: [customerGroup(), { key: "frequency", label: "Frequency", param: "frequency", options: ["Daily", "Weekly", "Monthly"] }],
    columns: [
      { key: "loanNumber", label: "Loan #", render: (r) => r.loanNumber },
      { key: "customerName", label: "Customer", render: (r) => r.customerName },
      { key: "branchName", label: "Branch", render: (r) => r.branchName },
      { key: "frequency", label: "Frequency", render: (r) => r.frequency },
      { key: "openedDate", label: "Opened", render: (r) => dt(r.openedDate) },
      { key: "principalAmount", label: "Principal", numeric: true, render: (r) => fmt(r.principalAmount) },
      { key: "disbursedAmount", label: "Disbursed", numeric: true, render: (r) => fmt(r.disbursedAmount) },
      { key: "outstandingAmount", label: "Outstanding", numeric: true, render: (r) => fmt(r.outstandingAmount) },
      { key: "status", label: "Status", render: (r) => r.status },
    ],
    totals: (t) => [
      { label: "Loans", value: String(t.count) },
      { label: "Total Principal", value: fmt(t.totalPrincipal) },
      { label: "Total Disbursed", value: fmt(t.totalDisbursed) },
      { label: "Total Outstanding", value: fmt(t.totalOutstanding) },
    ],
  },
  {
    id: "loans-status",
    title: "Active / Closed / Overdue Loans",
    description: "Portfolio status breakdown",
    icon: "list",
    exportKey: "loans-status",
    fetchFn: getLoansStatus,
    rowKey: (r) => r.loanId,
    filterGroups: [customerGroup(), statusGroup(["Active", "Due Soon", "Overdue", "Defaulted", "Closed"])],
    columns: [
      { key: "loanNumber", label: "Loan #", render: (r) => r.loanNumber },
      { key: "customerName", label: "Customer", render: (r) => r.customerName },
      { key: "branchName", label: "Branch", render: (r) => r.branchName },
      { key: "status", label: "Status", render: (r) => r.status },
      { key: "outstanding", label: "Outstanding", numeric: true, render: (r) => fmt(r.outstanding) },
      { key: "dueDate", label: "Due Date", render: (r) => dt(r.dueDate) },
    ],
    totals: (t) => [
      { label: "Active", value: String(t.active) }, { label: "Closed", value: String(t.closed) },
      { label: "Defaulted", value: String(t.defaulted) }, { label: "Total", value: String(t.count) },
    ],
  },
  {
    id: "interest-collection",
    title: "Interest & Penal Collection",
    description: "Collections by month and branch",
    singleBranchDescription: "Collections by month",
    icon: "coin",
    exportKey: "interest-collection",
    fetchFn: getInterestCollection,
    rowKey: (r) => `${r.loanId}-${r.paidOn}`,
    filterGroups: [customerGroup()],
    columns: [
      { key: "loanNumber", label: "Loan #", render: (r) => r.loanNumber },
      { key: "branchName", label: "Branch", render: (r) => r.branchName },
      { key: "paidOn", label: "Paid On", render: (r) => dt(r.paidOn) },
      { key: "interestApplied", label: "Interest", numeric: true, render: (r) => fmt(r.interestApplied) },
      { key: "penalApplied", label: "Penal", numeric: true, render: (r) => fmt(r.penalApplied) },
    ],
    totals: (t) => [
      { label: "Total Interest", value: fmt(t.totalInterest) },
      { label: "Total Penal", value: fmt(t.totalPenal) },
      { label: "Total", value: fmt(t.total) },
    ],
  },
  {
    id: "payment-collection",
    title: "Payment Collection",
    description: "Collections by date, branch & employee",
    singleBranchDescription: "Collections by date & employee",
    icon: "coin",
    exportKey: "payment-collection",
    fetchFn: getPaymentCollection,
    rowKey: (r) => r.paymentId,
    filterGroups: [customerGroup(), { key: "type", label: "Type", param: "paymentType", options: ["Interest", "Penal Interest", "Principal", "Partial", "Full Settlement", "Waiver", "Discount", "Auction Sale", "Auction Write-Off"] }],
    columns: [
      { key: "loanNumber", label: "Loan #", render: (r) => r.loanNumber },
      { key: "paidOn", label: "Paid On", render: (r) => dt(r.paidOn) },
      { key: "type", label: "Type", render: (r) => r.type },
      { key: "branchName", label: "Branch", render: (r) => r.branchName },
      { key: "employeeName", label: "Collected By", render: (r) => r.employeeName },
      { key: "amount", label: "Amount", numeric: true, render: (r) => fmt(r.amount) },
    ],
    totals: (t) => [{ label: "Payments", value: String(t.count) }, { label: "Total Amount", value: fmt(t.totalAmount) }],
  },
  {
    id: "gold-weight",
    title: "Gold / Ornament & Weight",
    description: "Total pledged weight by purity",
    icon: "scale",
    exportKey: "gold-weight",
    fetchFn: getGoldWeight,
    rowKey: (r) => r.ornamentId,
    filterGroups: [customerGroup(), ornamentTypeGroup(), purityGroup()],
    columns: [
      { key: "loanNumber", label: "Loan #", render: (r) => r.loanNumber },
      { key: "customerName", label: "Customer", render: (r) => r.customerName },
      { key: "name", label: "Ornament", render: (r) => r.name },
      { key: "purity", label: "Purity", render: (r) => r.purity },
      { key: "grossWeight", label: "Gross Wt", numeric: true, render: (r) => fmtW(r.grossWeight) },
      { key: "netWeight", label: "Net Wt", numeric: true, render: (r) => fmtW(r.netWeight) },
      { key: "goldValue", label: "Value", numeric: true, render: (r) => fmt(r.goldValue) },
    ],
    totals: (t) => [
      { label: "Total Gross Wt", value: fmtW(t.totalGrossWeight) },
      { label: "Total Net Wt", value: fmtW(t.totalNetWeight) },
      { label: "Total Value", value: fmt(t.totalGoldValue) },
    ],
  },
  {
    id: "packets",
    title: "Packet Tracking & Locker",
    description: "Movement & storage audit",
    icon: "scan",
    exportKey: "packets",
    fetchFn: getPackets,
    rowKey: (r) => r.packetId,
    filterGroups: [customerGroup(), loanGroup(), statusGroup(["Locker Stored", "Bank Pledged", "Returned", "Released"]), lockerGroup()],
    columns: [
      { key: "code", label: "Packet Code", render: (r) => r.code },
      { key: "loanNumber", label: "Loan #", render: (r) => r.loanNumber },
      { key: "status", label: "Status", render: (r) => r.status },
      { key: "lockerCode", label: "Locker", render: (r) => r.lockerCode || "—" },
      { key: "movementCount", label: "Movements", numeric: true, render: (r) => r.movementCount },
    ],
    totals: (t) => [
      { label: "Total", value: String(t.count) }, { label: "In Locker", value: String(t.inLocker) },
      { label: "Bank Pledged", value: String(t.bankPledged) }, { label: "Released", value: String(t.released) },
    ],
  },
  {
    id: "bank-pledge",
    title: "Bank Pledge & Liability",
    description: "External pledge exposure",
    icon: "bank",
    exportKey: "bank-pledge",
    fetchFn: getBankPledge,
    rowKey: (r) => r.recordId,
    filterGroups: [bankGroup(), statusGroup(["Active", "Released"])],
    columns: [
      { key: "loanNumber", label: "Loan #", render: (r) => r.loanNumber },
      { key: "bankName", label: "Bank", render: (r) => r.bankName },
      { key: "pledgeDate", label: "Pledge Date", render: (r) => dt(r.pledgeDate) },
      { key: "releaseDate", label: "Release Date", render: (r) => r.releaseDate ? dt(r.releaseDate) : "—" },
      { key: "status", label: "Status", render: (r) => r.status },
      { key: "pledgedAmount", label: "Pledged Amount", numeric: true, render: (r) => fmt(r.pledgedAmount) },
    ],
    totals: (t) => [{ label: "Records", value: String(t.count) }, { label: "Outstanding Liability", value: fmt(t.outstandingLiability) }],
  },
  {
    id: "loan-extensions",
    title: "Loan Extensions",
    description: "Requested tenure extensions",
    icon: "unlock",
    exportKey: "loan-extensions",
    fetchFn: getLoanExtensions,
    rowKey: (r) => r.requestId,
    filterGroups: [customerGroup(), statusGroup(["Pending", "Approved", "Rejected"])],
    columns: [
      { key: "loanNumber", label: "Loan #", render: (r) => r.loanNumber },
      { key: "requestedAt", label: "Requested", render: (r) => dt(r.requestedAt) },
      { key: "months", label: "Months", numeric: true, render: (r) => r.months ?? "—" },
      { key: "newDueDate", label: "New Due Date", render: (r) => r.newDueDate ? dt(r.newDueDate) : "—" },
      { key: "status", label: "Status", render: (r) => r.status },
    ],
    totals: (t) => [{ label: "Requests", value: String(t.count) }],
  },
  {
    id: "gold-release",
    title: "Gold Release / Closure",
    description: "Settlements and releases",
    icon: "unlock",
    exportKey: "gold-release",
    fetchFn: getGoldRelease,
    rowKey: (r) => r.requestId,
    filterGroups: [customerGroup(), loanGroup(), statusGroup(["Pending", "Approved", "Rejected"])],
    columns: [
      { key: "loanNumber", label: "Loan #", render: (r) => r.loanNumber },
      { key: "customerName", label: "Customer", render: (r) => r.customerName },
      { key: "requestedAt", label: "Requested", render: (r) => dt(r.requestedAt) },
      { key: "status", label: "Status", render: (r) => r.status },
      { key: "settlementAmount", label: "Settlement", numeric: true, render: (r) => fmt(r.settlementAmount) },
    ],
    totals: (t) => [{ label: "Requests", value: String(t.count) }, { label: "Total Settlement", value: fmt(t.totalSettlement) }],
  },
  {
    id: "auctions",
    title: "Auction Reports",
    description: "Cases, notices, recovery",
    icon: "gavel",
    exportKey: "auctions",
    fetchFn: getAuctions,
    rowKey: (r) => r.recordId,
    filterGroups: [customerGroup(), loanGroup(), { key: "settlement", label: "Settlement", param: "settlement", options: Object.entries(AUCTION_OUTCOME_LABELS).map(([value, label]) => ({ value, label })) }],
    columns: [
      { key: "loanNumber", label: "Loan #", render: (r) => r.loanNumber },
      { key: "stage", label: "Stage", render: (r) => r.stage },
      { key: "auctionDate", label: "Auction Date", render: (r) => r.auctionDate ? dt(r.auctionDate) : "—" },
      { key: "settlementStatus", label: "Settlement", width: "24%", render: (r) => AUCTION_OUTCOME_LABELS[r.settlementStatus as keyof typeof AUCTION_OUTCOME_LABELS] ?? r.settlementStatus },
      { key: "saleAmount", label: "Sale Amount", numeric: true, render: (r) => fmt(r.saleAmount) },
    ],
    totals: (t) => [{ label: "Records", value: String(t.count) }, { label: "Total Sale Amount", value: fmt(t.totalSaleAmount) }],
  },
  {
    id: "expense-cashflow",
    title: "Expense & Cash Flow",
    description: "Cash movement and expense heads",
    icon: "coin",
    exportKey: "expense-cashflow",
    fetchFn: getExpenseCashflow,
    rowKey: (r) => `${r.branchName}-${r.date}`,
    filterGroups: [expenseCategoryGroup(), { key: "collectionMode", label: "Collection Mode", param: "collectionMode", options: ["Cash", "UPI", "Bank Transfer", "Cheque"] }],
    columns: [
      { key: "date", label: "Date", render: (r) => dt(r.date) },
      { key: "branchName", label: "Branch", render: (r) => r.branchName },
      { key: "collections", label: "Collections", numeric: true, render: (r) => fmt(r.collections) },
      { key: "disbursements", label: "Disbursements", numeric: true, render: (r) => fmt(r.disbursements) },
      { key: "cashExpenses", label: "Cash Expenses", numeric: true, render: (r) => fmt(r.cashExpenses) },
    ],
    totals: (t) => [
      { label: "Collections", value: fmt(t.totalCollections) }, { label: "Disbursements", value: fmt(t.totalDisbursements) },
      { label: "Expenses", value: fmt(t.totalExpenses) }, { label: "Net Cashflow", value: fmt(t.netCashflow) },
    ],
  },
  {
    id: "kyc",
    title: "KYC Verification",
    description: "PAN/Aadhaar verification log",
    icon: "shield",
    exportKey: "kyc",
    fetchFn: getKYC,
    rowKey: (r) => r.customerId,
    filterGroups: [customerGroup(), verifyStatusGroup("kycStatus", "KYC", "kycStatus"), verifyStatusGroup("panStatus", "PAN", "panStatus"), verifyStatusGroup("aadhaarStatus", "Aadhaar", "aadhaarStatus")],
    columns: [
      { key: "code", label: "Customer Code", render: (r) => r.code },
      { key: "name", label: "Name", render: (r) => r.name },
      { key: "phone", label: "Phone", render: (r) => r.phone },
      { key: "kycStatus", label: "KYC Status", render: (r) => r.kycStatus },
      { key: "panStatus", label: "PAN", render: (r) => r.panStatus },
      { key: "aadhaarStatus", label: "Aadhaar", render: (r) => r.aadhaarStatus },
    ],
    totals: (t) => [{ label: "Customers", value: String(t.count) }, { label: "Verified", value: String(t.verified) }, { label: "Pending", value: String(t.pending) }],
  },
  {
    id: "gold-rate-history",
    title: "Gold Rate History",
    description: "Published daily rates",
    icon: "coin",
    exportKey: "gold-rate-history",
    fetchFn: getGoldRateHistory,
    rowKey: (r) => r.date,
    filterGroups: [setByGroup()],
    columns: [
      { key: "date", label: "Date", render: (r) => dt(r.date) },
      { key: "k24", label: "24K Rate", numeric: true, render: (r) => fmt(r.k24) },
      { key: "setBy", label: "Set By", render: (r) => r.setBy },
    ],
    totals: (t) => [{ label: "Entries", value: String(t.count) }],
  },
  {
    id: "employee-performance",
    title: "Employee Performance",
    description: "Loans, collections & follow-ups per employee",
    icon: "user",
    exportKey: "employee-performance",
    fetchFn: getEmployeePerformance,
    rowKey: (r) => r.employeeId,
    filterGroups: [employeeGroup(), roleGroup()],
    columns: [
      { key: "employeeCode", label: "Employee ID", render: (r) => r.employeeCode || "—" },
      { key: "name", label: "Employee", render: (r) => r.name },
      { key: "role", label: "Role", render: (r) => r.role },
      { key: "branchName", label: "Branch", render: (r) => r.branchName },
      { key: "loansProcessed", label: "Loans Processed", numeric: true, render: (r) => r.loansProcessed },
      { key: "collectionsAmount", label: "Collections", numeric: true, render: (r) => fmt(r.collectionsAmount) },
      { key: "remindersSent", label: "Reminders Sent", numeric: true, render: (r) => r.remindersSent },
      { key: "approvals", label: "Approvals", numeric: true, render: (r) => r.approvals },
    ],
    totals: (t) => [{ label: "Total Loans Processed", value: String(t.totalLoansProcessed) }, { label: "Total Collections", value: fmt(t.totalCollections) }],
  },
  {
    id: "communication-history",
    title: "Communication History",
    description: "WhatsApp messages sent per loan/customer",
    icon: "chat",
    exportKey: "communication-history",
    fetchFn: getCommunicationHistory,
    rowKey: (r) => r.id,
    filterGroups: [employeeGroup(), { key: "channel", label: "Channel", param: "channel", options: ["WhatsApp"] }, statusGroup(["sent", "failed"]), { key: "triggerType", label: "Trigger Type", param: "triggerType", options: ["loan_sanction", "payment", "closure", "auction_notice", "reminder", "otp"] }],
    columns: [
      { key: "recipientName", label: "Recipient", render: (r) => r.recipientName },
      { key: "recipientPhone", label: "Phone", render: (r) => r.recipientPhone },
      { key: "channel", label: "Channel", render: (r) => r.channel },
      { key: "triggerType", label: "Trigger Type", render: (r) => r.triggerType },
      { key: "status", label: "Status", render: (r) => r.status },
      { key: "sentAt", label: "Sent At", render: (r) => dt(r.sentAt) },
    ],
    totals: (t) => [{ label: "Total", value: String(t.count) }, { label: "Sent", value: String(t.sent) }, { label: "Failed", value: String(t.failed) }],
  },
  {
    id: "balance-sheet",
    searchable: false,
    title: "Balance Sheet",
    description: "Assets, liabilities & equity as of a date (Ind AS Division III format)",
    icon: "scale",
    exportKey: "balance-sheet",
    fetchFn: getBalanceSheet,
    // No date range — a balance sheet is a snapshot, so only the filter
    // bar's "To" date is meaningful here (used as the as-of date; ReportView
    // doesn't have a dedicated "as of" field, so "To" doubles as it).
    rowKey: (r) => r.label,
    columns: [
      { key: "label", label: "Particulars", render: (r) => statementLabelCell(r.label, r.style, r.indent) },
      { key: "amount", label: "Amount (₹)", numeric: true, render: (r) => statementAmountCell(r.amount, r.style) },
    ],
    totals: (t) => [
      { label: "Total Assets", value: fmt(t.totalAssets) },
      { label: "Total Liabilities", value: fmt(t.totalLiabilities) },
      { label: "Total Equity", value: fmt(t.totalEquity) },
    ],
  },
  {
    id: "profit-loss",
    searchable: false,
    title: "Statement of Profit and Loss",
    description: "Income & expenses for a period (Ind AS Division III format)",
    icon: "chart",
    exportKey: "profit-loss",
    fetchFn: getProfitAndLoss,
    rowKey: (r) => r.label,
    columns: [
      { key: "label", label: "Particulars", render: (r) => statementLabelCell(r.label, r.style, r.indent) },
      { key: "amount", label: "Amount (₹)", numeric: true, render: (r) => statementAmountCell(r.amount, r.style) },
    ],
    totals: (t) => [
      { label: "Total Income", value: fmt(t.totalIncome) },
      { label: "Total Expenses", value: fmt(t.totalExpenses) },
      { label: "Profit for Period", value: fmt(t.profitForPeriod) },
    ],
  },
  {
    id: "investments-deposit-register",
    title: "Investment Deposit Register",
    description: "Investor deposits opened per period",
    icon: "coin",
    exportKey: "investments-deposit-register",
    tenantModule: "investments",
    fetchFn: getDepositRegister,
    rowKey: (r) => r.investmentId,
    filterGroups: [investorGroup(), planGroup(), statusGroup(["Active", "Matured", "Closed", "Renewed"])],
    columns: [
      { key: "investmentNumber", label: "Investment ID", render: (r) => r.investmentNumber },
      { key: "customerName", label: "Investor", render: (r) => r.customerName },
      { key: "planName", label: "Plan", render: (r) => r.planName },
      { key: "branchName", label: "Branch", render: (r) => r.branchName },
      { key: "principalAmount", label: "Principal", numeric: true, render: (r) => fmt(r.principalAmount) },
      { key: "interestRate", label: "Rate", render: (r) => `${r.interestRate}%` },
      { key: "startDate", label: "Start", render: (r) => dt(r.startDate) },
      { key: "maturityDate", label: "Maturity", render: (r) => dt(r.maturityDate) },
      { key: "status", label: "Status", render: (r) => r.status },
    ],
    totals: (t) => [{ label: "Deposits", value: String(t.count) }, { label: "Total Principal", value: fmt(t.totalPrincipal) }],
  },
  {
    id: "investments-interest-payout-register",
    title: "Interest Payout Register",
    description: "Investor interest payouts due/paid per period",
    icon: "chart",
    exportKey: "investments-interest-payout-register",
    tenantModule: "investments",
    fetchFn: getInterestPayoutRegister,
    rowKey: (r) => `${r.investmentId}-${r.sequenceNo}`,
    filterGroups: [investorGroup(), planGroup(), statusGroup(["Pending", "Paid"])],
    columns: [
      { key: "investmentNumber", label: "Investment ID", render: (r) => r.investmentNumber },
      { key: "customerName", label: "Investor", render: (r) => r.customerName },
      { key: "sequenceNo", label: "#", render: (r) => r.sequenceNo },
      { key: "dueDate", label: "Due Date", render: (r) => dt(r.dueDate) },
      { key: "amount", label: "Amount", numeric: true, render: (r) => fmt(r.amount) },
      { key: "status", label: "Status", render: (r) => r.status },
      { key: "paidAt", label: "Paid At", render: (r) => (r.paidAt ? dt(r.paidAt) : "—") },
    ],
    totals: (t) => [
      { label: "Due", value: fmt(t.totalDue) }, { label: "Paid", value: fmt(t.totalPaid) }, { label: "Pending", value: fmt(t.totalPending) },
    ],
  },
  {
    id: "investments-maturity-register",
    title: "Investment Maturity Register",
    description: "Investments reaching maturity per period",
    icon: "cal",
    exportKey: "investments-maturity-register",
    tenantModule: "investments",
    fetchFn: getMaturityRegister,
    rowKey: (r) => r.investmentId,
    filterGroups: [investorGroup(), planGroup(), statusGroup(["Active", "Matured", "Closed", "Renewed"])],
    columns: [
      { key: "investmentNumber", label: "Investment ID", render: (r) => r.investmentNumber },
      { key: "customerName", label: "Investor", render: (r) => r.customerName },
      { key: "branchName", label: "Branch", render: (r) => r.branchName },
      { key: "principalAmount", label: "Principal", numeric: true, render: (r) => fmt(r.principalAmount) },
      { key: "maturityDate", label: "Maturity", render: (r) => dt(r.maturityDate) },
      { key: "status", label: "Status", render: (r) => r.status },
    ],
    totals: (t) => [
      { label: "Active", value: String(t.active) }, { label: "Matured", value: String(t.matured) },
      { label: "Closed", value: String(t.closed) }, { label: "Renewed", value: String(t.renewed) }, { label: "Total", value: String(t.count) },
    ],
  },
];

/* Form G's tile — kept out of REPORT_CONFIGS above because it doesn't fit
 * ReportConfig's Row/Totals-table shape (fetchFn/columns/totals/rowKey):
 * it's a fixed-layout statement, rendered by its own FormGReportView (see
 * that file's top comment) rather than the generic ReportView every other
 * report above shares. Only title/description/icon are needed for the tile
 * grid itself. */
const FORM_G_TILE = {
  id: "form-g",
  title: "Form G — Statement of Accounts",
  description: "Kerala Money-Lenders Rules 1964, Rule 15(3) — quarterly/yearly statement",
  icon: "doc",
};

/* Ledger export's own tile — like Form G, kept out of REPORT_CONFIGS since
 * it's a party-selector (customer/branch/bank) feeding the existing
 * exportPartyStatementBy* calls, not a fixed-dataset Row/Totals report. */
const LEDGER_EXPORT_TILE = {
  id: "ledger-export",
  title: "Ledger Report",
  description: "Download a full ledger for one customer, branch or bank",
  singleBranchDescription: "Download a full ledger for one customer or bank",
  icon: "coin",
};

/* Day Book's own tile — its entries are written by hand (add / edit / delete), which the
 * read-only generic ReportView has no place for, so it has its own DayBookReportView. */
const DAY_BOOK_TILE = {
  id: "day-book",
  title: "Day Book",
  description: "Record entries by hand — date, particulars, debit, credit and interest",
  icon: "note",
};

/* Ported from legacy/app.js's `renderReports()` tile grid, now wired to
 * real backend/internal/reports endpoints. Clicking a tile swaps the grid
 * for that report's ReportView (filter bar + paginated table + totals +
 * export) in place, rather than firing a stub toast. */
/* "Daily Loan Disbursement" → "daily-loan-disbursement": the report's segment in /reports/<slug>. */
function reportSlug(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

/* Title of the report a /reports/<slug> URL points at — backs the Topbar breadcrumb. */
export function reportTitleFromSlug(slug?: string): string | undefined {
  if (!slug) return undefined;
  return [...REPORT_CONFIGS, FORM_G_TILE, LEDGER_EXPORT_TILE, DAY_BOOK_TILE].find((r) => reportSlug(r.title) === slug)?.title;
}

export function ReportsPage({ reportSlug: slugFromUrl }: { reportSlug?: string }) {
  const toast = useToast();
  const { openModal } = useModal();
  const smallScreen = useIsSmallScreen();
  const { hasModule, singleBranch } = useBranding();
  // Single-branch plan: tile descriptions drop their branch wording.
  const tileDescription = (r: { description: string; singleBranchDescription?: string }) =>
    (singleBranch && r.singleBranchDescription) || r.description;
  // Personal Loans/Investments reports carry a tenantModule the way
  // Sidebar.tsx's own nav entries do for those pages — a business without
  // the module doesn't see the report tile exist, matching the backend
  // refusing the underlying API call too (see internal/reports/routes.go).
  const visibleConfigs = REPORT_CONFIGS.filter((r) => !r.tenantModule || hasModule(r.tenantModule));
  // Which report is open lives in the URL, so a refresh or a pasted link lands on it.
  const activeId = [...visibleConfigs, FORM_G_TILE, LEDGER_EXPORT_TILE, DAY_BOOK_TILE].find((r) => reportSlug(r.title) === slugFromUrl)?.id ?? null;
  const setActiveId = (id: string | null) => {
    const tile = [...visibleConfigs, FORM_G_TILE, LEDGER_EXPORT_TILE, DAY_BOOK_TILE].find((r) => r.id === id);
    navigate("reports", tile ? reportSlug(tile.title) : undefined);
  };
  const [printingId, setPrintingId] = useState<string | null>(null);
  const active = visibleConfigs.find((r) => r.id === activeId) || null;

  if (activeId === "form-g") {
    return <FormGReportView onBack={() => setActiveId(null)} />;
  }
  if (activeId === "ledger-export") {
    return <LedgerExportView onBack={() => setActiveId(null)} />;
  }
  if (activeId === "day-book") {
    return <DayBookReportView onBack={() => setActiveId(null)} />;
  }
  if (active) {
    return <ReportView key={active.id} config={active} onBack={() => setActiveId(null)} />;
  }

  function handlePrint(e: React.MouseEvent, r: ReportConfig | typeof FORM_G_TILE | typeof LEDGER_EXPORT_TILE | typeof DAY_BOOK_TILE) {
    e.stopPropagation();
    if (r.id === "ledger-export") { setActiveId("ledger-export"); return; }
    openModal(<ExportFormatModal onPick={(kind) => runPrint(r, kind)} />);
  }

  async function runPrint(r: ReportConfig | typeof FORM_G_TILE | typeof LEDGER_EXPORT_TILE | typeof DAY_BOOK_TILE, kind: ExportKind) { return singleFlight("reports:print:"+r.id, async () => {
    setPrintingId(r.id);
    try {
      // Form G defaults to the last 3 months everywhere else in this view
      // (see FormGReportView); the quick-print button uses the same
      // generic exportReport as every other tile (its export-key dispatch
      // in backend/internal/reports/export.go special-cases "form-g"
      // regardless of caller, so no separate handling is needed here beyond
      // the date range), just with that 3-month default instead of
      // firstOfMonth().
      const range = r.id === "form-g" ? { from: subMonths(today(), 3), to: today() } : { from: firstOfMonth(), to: today() };
      await exportReport(r.id === "form-g" || r.id === "day-book" ? r.id : (r as ReportConfig).exportKey, kind, range);
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Print failed.");
    } finally {
      setPrintingId(null);
    }
  }); }

  return (
    <>
      <div className="page-h">
        <div><h1>Reports</h1><p>Filterable reports, exportable to PDF / Excel</p></div>
      </div>
      {/* Small-screen margin override (matches Loans.tsx's own hr override)
       * — without it this rule was reading as missing on small/short
       * (useIsSmallScreen) windows, sitting too close to the header to read
       * as its own divider line. */}
      <hr className="gold-rule" style={smallScreen ? { margin: "4px 0 18px" } : undefined} />
      <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fill,minmax(250px,1fr))" }}>
        {[...visibleConfigs, FORM_G_TILE, LEDGER_EXPORT_TILE, DAY_BOOK_TILE].map((r) => (
          <div className="card" style={{ cursor: "pointer", minHeight: 120, display: "flex", flexDirection: "column", position: "relative" }} key={r.id} onClick={() => setActiveId(r.id)}>
            <button
              className="btn ghost sm"
              style={{ position: "absolute", top: 10, right: 10, width: 30, height: 30, padding: 0, display: "grid", placeContent: "center" }}
              disabled={printingId === r.id}
              onClick={(e) => handlePrint(e, r)}
              title={`Print ${r.title}`}
              aria-label={`Print ${r.title}`}
            >
              <span style={{ display: "grid", placeContent: "center", transform: "translateY(2px)" }}>
                <Icon name="print" />
              </span>
            </button>
            <div className="bd" style={{ display: "flex", flexDirection: "column", flex: 1 }}>
              <b style={{ fontSize: 14.5, color: "var(--charcoal)", paddingRight: 40 }}>{r.title}</b>
              <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2, paddingRight: 40 }}>{tileDescription(r)}</div>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
