"use client";

import { useState } from "react";
import { Icon } from "@/common/components/Icon";
import { useToast } from "@/common/components/Toast";
import { ApiError } from "@/common/services/httpClient";
import { fmt, fmtW } from "@/common/utils/format";
import { FormGReportView } from "@/modules/reports/components/FormGReportView";
import { ReportView, type ReportConfig } from "@/modules/reports/components/ReportView";
import {
  getDisbursement, getLoansStatus, getInterestCollection, getOutstandingPrincipal,
  getPaymentCollection, getGoldWeight, getPackets, getBankPledge, getLoanExtensions,
  getGoldRelease, getAuctions, getExpenseCashflow, getKYC, getGoldRateHistory,
  getEmployeePerformance, getCommunicationHistory, exportReport,
} from "@/modules/reports/services/reportsService";

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

const dt = (v: string) => v ? new Date(v).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—";

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
    id: "loans-status",
    title: "Active / Closed / Overdue Loans",
    description: "Portfolio status breakdown",
    icon: "list",
    exportKey: "loans-status",
    fetchFn: getLoansStatus,
    rowKey: (r) => r.loanId,
    extraFilter: { field: "status", label: "Status", options: ["Active", "Closed", "Pending Approval", "Auction Eligible"] },
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
      { label: "Due Soon", value: String(t.dueSoon) }, { label: "Overdue", value: String(t.overdue) },
      { label: "Defaulted", value: String(t.defaulted) }, { label: "Total", value: String(t.count) },
    ],
  },
  {
    id: "interest-collection",
    title: "Interest & Penal Collection",
    description: "Collections by month and branch",
    icon: "coin",
    exportKey: "interest-collection",
    fetchFn: getInterestCollection,
    rowKey: (r) => `${r.loanId}-${r.paidOn}`,
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
    id: "outstanding-principal",
    title: "Outstanding Principal",
    description: "Exposure by scheme & branch",
    icon: "chart",
    exportKey: "outstanding-principal",
    fetchFn: getOutstandingPrincipal,
    rowKey: (r) => r.branchName,
    columns: [
      { key: "branchName", label: "Branch", render: (r) => r.branchName },
      { key: "loanCount", label: "Loans", numeric: true, render: (r) => r.loanCount },
      { key: "outstanding", label: "Outstanding", numeric: true, render: (r) => fmt(r.outstanding) },
    ],
    totals: (t) => [{ label: "Total Loans", value: String(t.totalLoans) }, { label: "Total Outstanding", value: fmt(t.totalOutstanding) }],
  },
  {
    id: "payment-collection",
    title: "Payment Collection",
    description: "Collections by date, branch & employee",
    icon: "coin",
    exportKey: "payment-collection",
    fetchFn: getPaymentCollection,
    rowKey: (r) => r.paymentId,
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
    columns: [
      { key: "loanNumber", label: "Loan #", render: (r) => r.loanNumber },
      { key: "stage", label: "Stage", render: (r) => r.stage },
      { key: "auctionDate", label: "Auction Date", render: (r) => r.auctionDate ? dt(r.auctionDate) : "—" },
      { key: "settlementStatus", label: "Settlement", render: (r) => r.settlementStatus },
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
    columns: [
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
    extraFilter: {
      field: "triggerType", label: "Trigger Type",
      options: ["loan_sanction", "payment", "closure", "auction_notice", "reminder", "otp"],
    },
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

/* Ported from legacy/app.js's `renderReports()` tile grid, now wired to
 * real backend/internal/reports endpoints. Clicking a tile swaps the grid
 * for that report's ReportView (filter bar + paginated table + totals +
 * export) in place, rather than firing a stub toast. */
export function Reports() {
  const toast = useToast();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [printingId, setPrintingId] = useState<string | null>(null);
  const active = REPORT_CONFIGS.find((r) => r.id === activeId) || null;

  if (activeId === "form-g") {
    return <FormGReportView onBack={() => setActiveId(null)} />;
  }
  if (active) {
    return <ReportView config={active} onBack={() => setActiveId(null)} />;
  }

  async function handlePrint(e: React.MouseEvent, r: ReportConfig | typeof FORM_G_TILE) {
    e.stopPropagation();
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
      await exportReport(r.id === "form-g" ? "form-g" : (r as ReportConfig).exportKey, "pdf", range);
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Print failed.");
    } finally {
      setPrintingId(null);
    }
  }

  return (
    <>
      <div className="page-h">
        <div><h1>Reports</h1><p>Filterable reports, exportable to PDF / Excel</p></div>
      </div>
      <hr className="gold-rule" />
      <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fill,minmax(250px,1fr))" }}>
        {[...REPORT_CONFIGS, FORM_G_TILE].map((r) => (
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
              <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>{r.description}</div>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
