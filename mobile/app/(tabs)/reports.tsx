import React, { useEffect, useRef, useState } from "react";
import { View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import * as Print from "expo-print";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import {
  AccRow,
  BtnRow2,
  Buffering,
  C,
  Card,
  DateField,
  EmptyText,
  FieldRow,
  FlatHeader,
  PScroll,
  PrimaryButton,
  ReportRow,
  ReportSectionLabel,
  Screen,
  SearchInput,
  ServerFlatList,
  Sheet,
  Txt,
  type AccDetail,
  openPage,
  toast,
} from "../../src/components/ui";
import { SheetScrollView } from "../../src/components/BottomSheetModal";
import { useServerList } from "../../src/hooks/useServerList";
import { API_BASE_URL } from "../../src/api/config";
import { getToken } from "../../src/auth/tokenStorage";
import { useTheme } from "../../src/theme/ThemeProvider";
import { TENANT_MODULES, type TenantModule } from "../../src/config/tenantModules";
import {
  getAuctions,
  getBalanceSheet,
  getBankPledge,
  getCommunicationHistory,
  getDepositRegister,
  getDisbursement,
  getEmployeePerformance,
  getExpenseCashflow,
  getFormG,
  getGoldRateHistory,
  getGoldRelease,
  getGoldWeight,
  getInterestCollection,
  getInterestPayoutRegister,
  getKYC,
  getLoanExtensions,
  getLoansStatus,
  getMaturityRegister,
  getOutstandingPrincipal,
  getPackets,
  getPaymentCollection,
  getPersonalLoans,
  getProfitAndLoss,
  type FormGStatement,
  type ReportFilters,
  type ReportResult,
  type StatementRow,
} from "../../src/api/reports";
import { dmy, inr, todayISO } from "../../src/lib/format";
import { isUserCancel, userMessage } from "../../src/api/errors";

// Reports — prototype #header-reports + #page-reports (grouped report rows)
// and #report-table-modal. Tapping a report opens its table in a sheet:
// server-paged (page / page_size = 10) with a server-side search (`q`) and
// optional from/to, rows as accordion rows, Export .xlsx + Print through the
// server export (GET /reports/export/:key). Balance Sheet / P&L / Form G are
// statements, rendered as statement lines inside the same sheet.

/* eslint-disable @typescript-eslint/no-explicit-any */
type RowView = { id?: string; name: string; sub?: string; amount?: string; status?: string; details?: AccDetail[] };
// "link" opens another screen instead of a report sheet (see `href`).
type Kind = "table" | "statement" | "formg" | "link";
type ReportDef = {
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
};

const w = (n?: number | null) => `${(n ?? 0).toFixed(2)} g`;
const firstOfMonth = () => `${todayISO().slice(0, 8)}01`;
const monthsAgo = (months: number) => {
  const d = new Date();
  d.setMonth(d.getMonth() - months);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

const REPORTS: ReportDef[] = [
  // Loans & Collections
  {
    key: "disbursement",
    title: "Daily Loan Disbursement",
    group: "Loans & Collections",
    kind: "table",
    fetch: getDisbursement,
    headline: (t) => inr(t?.totalAmount),
    sub: (t) => `${t?.count ?? 0} loans`,
    row: (r) => ({ id: r.loanNumber, name: r.customerName, sub: dmy(r.openedDate), amount: inr(r.amount), details: [{ k: "Branch", v: r.branchName || "—" }, { k: "Scheme", v: r.schemeName || "—" }] }),
  },
  {
    key: "loans-status",
    title: "Active / Closed / Overdue Loans",
    group: "Loans & Collections",
    kind: "table",
    fetch: getLoansStatus,
    headline: (t) => `${t?.count ?? 0} loans`,
    sub: (t) => `${t?.active ?? 0} active · ${t?.overdue ?? 0} overdue · ${t?.dueSoon ?? 0} due soon · ${t?.closed ?? 0} closed`,
    row: (r) => ({ id: r.loanNumber, name: r.customerName, sub: `Due ${dmy(r.dueDate)}`, amount: inr(r.outstanding), status: r.status, details: [{ k: "Branch", v: r.branchName || "—" }, { k: "Outstanding", v: inr(r.outstanding) }] }),
  },
  {
    key: "interest-collection",
    title: "Interest & Penal Collection",
    group: "Loans & Collections",
    kind: "table",
    fetch: getInterestCollection,
    headline: (t) => inr(t?.total),
    sub: (t) => `${inr(t?.totalInterest)} interest · ${inr(t?.totalPenal)} penal`,
    row: (r) => ({
      id: r.loanNumber,
      name: dmy(r.paidOn),
      sub: r.branchName,
      amount: inr((r.interestApplied ?? 0) + (r.penalApplied ?? 0)),
      details: [{ k: "Interest", v: inr(r.interestApplied) }, { k: "Penal", v: inr(r.penalApplied) }],
    }),
  },
  {
    key: "outstanding-principal",
    title: "Outstanding Principal",
    group: "Loans & Collections",
    kind: "table",
    fetch: getOutstandingPrincipal,
    headline: (t) => inr(t?.totalOutstanding),
    sub: (t) => `${t?.totalLoans ?? 0} loans across branches`,
    row: (r) => ({ name: r.branchName, sub: `${r.loanCount} loans`, amount: inr(r.outstanding), details: [{ k: "Loans", v: String(r.loanCount) }, { k: "Outstanding", v: inr(r.outstanding) }] }),
  },
  {
    key: "payment-collection",
    title: "Payment Collection",
    group: "Loans & Collections",
    kind: "table",
    fetch: getPaymentCollection,
    headline: (t) => inr(t?.totalAmount),
    sub: (t) => `${t?.count ?? 0} payments`,
    row: (r) => ({ id: r.loanNumber, name: r.type, sub: dmy(r.paidOn), amount: inr(r.amount), details: [{ k: "Branch", v: r.branchName || "—" }, { k: "Staff", v: r.employeeName || "—" }] }),
  },
  // Gold & Custody
  {
    key: "gold-weight",
    title: "Gold / Ornament & Weight",
    group: "Gold & Custody",
    kind: "table",
    fetch: getGoldWeight,
    headline: (t) => w(t?.totalNetWeight),
    sub: (t) => `${w(t?.totalGrossWeight)} gross · ${inr(t?.totalGoldValue)} total value`,
    row: (r) => ({
      id: r.loanNumber,
      name: r.name,
      sub: r.customerName,
      amount: inr(r.goldValue),
      details: [{ k: "Purity", v: r.purity || "—" }, { k: "Gross wt", v: w(r.grossWeight) }, { k: "Net wt", v: w(r.netWeight) }],
    }),
  },
  {
    key: "packets",
    title: "Packet Tracking & Locker",
    group: "Gold & Custody",
    kind: "table",
    fetch: getPackets,
    headline: (t) => `${t?.count ?? 0} packets`,
    sub: (t) => `${t?.inLocker ?? 0} in locker · ${t?.bankPledged ?? 0} pledged · ${t?.released ?? 0} released`,
    row: (r) => ({ id: r.code, name: r.loanNumber, sub: r.lockerCode ? `Locker ${r.lockerCode}` : undefined, status: r.status, details: [{ k: "Locker", v: r.lockerCode || "—" }, { k: "Movements", v: String(r.movementCount ?? 0) }] }),
  },
  {
    key: "bank-pledge",
    title: "Bank Pledge & Liability",
    group: "Gold & Custody",
    kind: "table",
    fetch: getBankPledge,
    headline: (t) => inr(t?.outstandingLiability),
    sub: (t) => `${t?.count ?? 0} pledge records`,
    row: (r) => ({
      id: r.loanNumber,
      name: r.bankName,
      sub: dmy(r.pledgeDate),
      amount: inr(r.pledgedAmount),
      status: r.status,
      details: [{ k: "Pledged on", v: dmy(r.pledgeDate) }, { k: "Released on", v: dmy(r.releaseDate) }],
    }),
  },
  {
    key: "loan-extensions",
    title: "Loan Extensions",
    group: "Gold & Custody",
    kind: "table",
    fetch: getLoanExtensions,
    headline: (t) => `${t?.count ?? 0} requests`,
    sub: () => "Requested tenure extensions",
    row: (r) => ({
      id: r.loanNumber,
      name: `${r.months ?? "—"} months`,
      sub: `Requested ${dmy(r.requestedAt)}`,
      status: r.status,
      details: [{ k: "New due date", v: dmy(r.newDueDate) }, { k: "Requested on", v: dmy(r.requestedAt) }],
    }),
  },
  {
    key: "gold-release",
    title: "Gold Release / Closure",
    group: "Gold & Custody",
    kind: "table",
    fetch: getGoldRelease,
    headline: (t) => `${t?.count ?? 0} releases`,
    sub: (t) => `${inr(t?.totalSettlement)} total settlement`,
    row: (r) => ({ id: r.loanNumber, name: r.customerName, sub: dmy(r.requestedAt), amount: inr(r.settlementAmount), status: r.status, details: [{ k: "Requested on", v: dmy(r.requestedAt) }, { k: "Settlement", v: inr(r.settlementAmount) }] }),
  },
  {
    key: "auctions",
    title: "Auction Reports",
    group: "Gold & Custody",
    kind: "table",
    fetch: getAuctions,
    headline: (t) => `${t?.count ?? 0} auctions`,
    sub: (t) => `${inr(t?.totalSaleAmount)} total sale amount`,
    row: (r) => ({ id: r.loanNumber, name: r.stage, sub: dmy(r.auctionDate), amount: inr(r.saleAmount), status: r.settlementStatus, details: [{ k: "Auction date", v: dmy(r.auctionDate) }, { k: "Sale amount", v: inr(r.saleAmount) }] }),
  },
  // Branch & Compliance
  {
    key: "expense-cashflow",
    title: "Expense & Cash Flow",
    group: "Branch & Compliance",
    kind: "table",
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
    fetch: getKYC,
    headline: (t) => `${t?.count ?? 0} customers`,
    sub: (t) => `${t?.verified ?? 0} verified · ${t?.pending ?? 0} pending`,
    row: (r) => ({ id: r.code, name: r.name, sub: r.phone, status: r.kycStatus, details: [{ k: "PAN", v: r.panStatus || "—" }, { k: "Aadhaar", v: r.aadhaarStatus || "—" }] }),
  },
  {
    key: "gold-rate-history",
    title: "Gold Rate History",
    group: "Branch & Compliance",
    kind: "table",
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
    fetch: getEmployeePerformance,
    headline: (t) => `${t?.totalLoansProcessed ?? 0} loans processed`,
    sub: (t) => `${inr(t?.totalCollections)} collected`,
    row: (r) => ({
      name: r.name,
      sub: [r.role, r.branchName].filter(Boolean).join(" · "),
      amount: inr(r.collectionsAmount),
      details: [
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
    fetch: getCommunicationHistory,
    headline: (t) => `${t?.count ?? 0} messages`,
    sub: (t) => `${t?.sent ?? 0} sent · ${t?.failed ?? 0} failed`,
    row: (r) => ({ name: r.recipientName, sub: `${r.channel} · ${dmy(r.sentAt)}`, status: r.status, details: [{ k: "Phone", v: r.recipientPhone || "—" }, { k: "Trigger", v: r.triggerType || "—" }] }),
  },
  {
    key: "personal-loans",
    title: "Personal Loans",
    group: "Branch & Compliance",
    kind: "table",
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
  // Web's "Ledger / Statement Export" tile — on mobile it opens the Ledger
  // (Cash tab Movements), which carries the same Branch/Customer/Type/Date
  // filters, clickable loan/customer/bank/category/mode links and a PDF
  // download of whatever the filters show.
  {
    key: "ledger-export",
    title: "Ledger / Statement Export",
    group: "Financial Statements",
    kind: "link",
    href: "/cash?tab=movements",
  },
  // Investments
  {
    key: "investments-deposit-register",
    title: "Investment Deposit Register",
    group: "Investments",
    kind: "table",
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
    kind: "table",
    fetch: getInterestPayoutRegister,
    headline: (t) => `${inr(t?.totalPending)} pending`,
    sub: (t) => `${inr(t?.totalPaid)} paid of ${inr(t?.totalDue)}`,
    row: (r) => ({ id: `${r.investmentNumber} #${r.sequenceNo}`, name: r.customerName, sub: `Due ${dmy(r.dueDate)}`, amount: inr(r.amount), status: r.status, details: [{ k: "Due date", v: dmy(r.dueDate) }, { k: "Paid on", v: dmy(r.paidAt) }] }),
  },
  {
    key: "investments-maturity-register",
    title: "Investment Maturity Register",
    group: "Investments",
    kind: "table",
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
  const [open, setOpen] = useState<ReportDef | null>(null);

  const available = REPORTS.filter((r) => !r.tenantModule || hasModule(r.tenantModule));
  // Static list of report titles (not data) — filtered locally.
  const needle = search.trim().toLowerCase();
  const shown = needle ? available.filter((r) => r.title.toLowerCase().includes(needle)) : available;

  // Dashboard tiles deep-link here with ?section=<key>; `t` re-applies it per tap.
  const params = useLocalSearchParams<{ section?: string; t?: string }>();
  const openReport = (r: ReportDef) => {
    if (r.kind === "link" && r.href) openPage(`${r.href}&t=${Date.now()}`);
    else setOpen(r);
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
                <ReportRow key={r.key} title={r.title} onPress={() => openReport(r)} />
              ))}
            </View>
          );
        })}
        {shown.length === 0 ? <EmptyText>No reports match your search.</EmptyText> : null}
      </PScroll>
      <ReportSheet report={open} onClose={() => setOpen(null)} />
    </Screen>
  );
}

// ---------------------------------------------------------------------------
// Report table sheet (prototype #report-table-modal)
// ---------------------------------------------------------------------------
async function downloadExport(key: string, format: "xlsx" | "pdf", range: { from?: string; to?: string; q?: string }) {
  const token = await getToken();
  const targetUri = `${FileSystem.cacheDirectory}${key}-${Date.now()}.${format}`;
  const qs = new URLSearchParams({ format });
  if (range.from) qs.set("from", range.from);
  if (range.to) qs.set("to", range.to);
  if (range.q) qs.set("q", range.q);
  const result = await FileSystem.downloadAsync(`${API_BASE_URL}/reports/export/${key}?${qs.toString()}`, targetUri, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (result.status < 200 || result.status >= 300) throw new Error(`${format === "pdf" ? "Print" : "Export"} failed (${result.status})`);
  return result.uri;
}

function ReportSheet({ report, onClose }: { report: ReportDef | null; onClose: () => void }) {
  const visible = !!report;
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [printing, setPrinting] = useState(false);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    if (report) {
      const r = report.defaultRange?.() ?? {};
      setFrom(r.from ?? "");
      setTo(r.to ?? "");
    }
  }, [report]);

  const isTable = report?.kind === "table";
  const totalsRef = useRef<any>(null);
  const filters = { from: from || undefined, to: to || undefined };
  const list = useServerList<any, { from?: string; to?: string; rk: string }>({
    key: ["reports", "table"],
    filters: { ...filters, rk: report?.key ?? "" },
    enabled: visible && isTable,
    fetchPage: async (p) => {
      const page = Math.floor(p.offset / p.limit) + 1;
      const res = await report!.fetch!({ page, pageSize: p.limit, q: p.q, from: p.from, to: p.to });
      totalsRef.current = res.totals;
      return { items: res.rows ?? [], hasMore: page * p.limit < (res.totalCount ?? 0), total: res.totalCount };
    },
  });
  // Reset the search box when switching reports.
  useEffect(() => {
    list.setSearch("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [report?.key]);

  // Statements are short fixed layouts — every line in one request.
  const statement = useQuery({
    queryKey: ["reports", "statement", report?.key, from, to],
    queryFn: () => report!.fetch!({ from: from || undefined, to: to || undefined, pageSize: 500 }),
    enabled: visible && report?.kind === "statement",
  });
  const formG = useQuery({
    queryKey: ["reports", "form-g", from, to],
    queryFn: () => getFormG({ from: from || undefined, to: to || undefined }),
    enabled: visible && report?.kind === "formg",
  });

  const range = { ...filters, q: isTable ? list.search.trim() || undefined : undefined };
  async function onExport() {
    if (!report) return;
    setExporting(true);
    try {
      const uri = await downloadExport(report.key, "xlsx", range);
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, { mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", dialogTitle: `${report.title} export` });
      } else {
        toast.info("Saved", `Saved to ${uri} — sharing isn't available on this device.`);
      }
    } catch (e) {
      if (isUserCancel(e)) return;
      toast.error("Export failed", userMessage(e, "Could not export — try again."));
    } finally {
      setExporting(false);
    }
  }
  async function onPrint() {
    if (!report) return;
    setPrinting(true);
    try {
      const uri = await downloadExport(report.key, "pdf", range);
      await Print.printAsync({ uri });
    } catch (e) {
      if (isUserCancel(e)) return;
      toast.error("Print failed", userMessage(e, "Could not print — try again."));
    } finally {
      setPrinting(false);
    }
  }

  const totals = report?.kind === "statement" ? statement.data?.totals : totalsRef.current;
  const summary =
    report?.headline && totals && !(isTable && list.isLoading) ? (
      <Card style={{ marginHorizontal: 16, marginBottom: 12, padding: 14 }}>
        <Txt style={{ fontWeight: "800", fontSize: 16.5 }}>{report.headline(totals)}</Txt>
        {report.sub ? <Txt style={{ fontSize: 11.5, color: C.muted, marginTop: 2 }}>{report.sub(totals)}</Txt> : null}
      </Card>
    ) : null;

  const headExtra = report ? (
    <View style={{ paddingTop: 12 }}>
      {isTable ? <SearchInput value={list.search} onChangeText={list.setSearch} placeholder="Search this report" style={{ paddingHorizontal: 16, paddingBottom: 8 }} /> : null}
      <View style={{ paddingHorizontal: 16 }}>
        <FieldRow>
          {report.key === "balance-sheet" ? null : <DateField label="From date" value={from} onChange={setFrom} clearable max={to || undefined} />}
          <DateField label={report.key === "balance-sheet" ? "As of" : "To date"} value={to} onChange={setTo} clearable min={from || undefined} />
        </FieldRow>
      </View>
    </View>
  ) : null;

  let body: React.ReactNode = null;
  if (!report) body = null;
  else if (isTable)
    body = (
      <ServerFlatList
        list={list}
        items={list.items}
        inSheet
        gutter={16}
        header={summary}
        emptyText={list.search ? "No records match your search." : "No records."}
        keyOf={(_, i) => String(i)}
        renderItem={(r, i) => {
          const v = report.row!(r);
          return <AccRow defaultOpen={i === 0} id={v.id} name={v.name || "—"} sub={v.sub} amount={v.amount} status={v.status} details={v.details} />;
        }}
      />
    );
  else {
    const loading = report.kind === "statement" ? statement.isLoading : formG.isLoading;
    const error = report.kind === "statement" ? statement.isError : formG.isError;
    const lines = report.kind === "statement" ? (statement.data?.rows ?? []).map(statementLine) : formGLines(formG.data);
    body = (
      <SheetScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 16 }}>
        {loading ? (
          <Buffering block />
        ) : error ? (
          <EmptyText>Couldn&apos;t load this statement.</EmptyText>
        ) : (
          <>
            {summary}
            {report.kind === "formg" && formG.data ? (
              <Card style={{ marginHorizontal: 16, marginBottom: 12, padding: 14 }}>
                <Txt style={{ fontWeight: "800", fontSize: 14 }}>{formG.data.lenderName}</Txt>
                <Txt style={{ fontSize: 11.5, color: C.muted, marginTop: 2 }}>{[formG.data.periodLabel, formG.data.lenderAddress].filter(Boolean).join(" · ")}</Txt>
              </Card>
            ) : null}
            {lines.length === 0 ? (
              <EmptyText>No records.</EmptyText>
            ) : (
              <Card style={{ marginHorizontal: 16, paddingVertical: 4 }}>
                {lines.map((l, i) => (
                  <View
                    key={i}
                    style={{
                      flexDirection: "row",
                      justifyContent: "space-between",
                      gap: 12,
                      paddingVertical: 9,
                      paddingLeft: l.indent * 12,
                      borderTopWidth: i === 0 ? 0 : 1,
                      borderTopColor: C.line,
                    }}
                  >
                    <Txt style={{ flex: 1, fontSize: 12.5, fontWeight: l.bold ? "700" : "500", color: l.bold ? C.ink : C.muted }}>{l.title}</Txt>
                    {l.detail ? <Txt style={{ fontSize: 12.5, fontWeight: "700", textAlign: "right", flexShrink: 1 }}>{l.detail}</Txt> : null}
                  </View>
                ))}
              </Card>
            )}
          </>
        )}
      </SheetScrollView>
    );
  }

  return (
    <Sheet visible={visible} onClose={onClose} title={report?.title ?? "Report"} maxHeightPct={88} scroll={false} headExtra={headExtra}>
      <View style={{ flexShrink: 1 }}>{body}</View>
      <BtnRow2 style={{ paddingHorizontal: 16, paddingTop: 12, paddingBottom: 16 }}>
        <PrimaryButton label={exporting ? "Exporting…" : "Export .xlsx"} variant="outline" loading={exporting} onPress={onExport} />
        <PrimaryButton label={printing ? "Printing…" : "Print"} loading={printing} onPress={onPrint} />
      </BtnRow2>
    </Sheet>
  );
}

type Line = { title: string; detail: string; bold?: boolean; indent: number };

// Balance Sheet / P&L lines: headers and totals bold, sub-items indented,
// header lines carry no amount (mirrors the web statement cells).
function statementLine(r: StatementRow): Line {
  return { title: r.label, detail: r.style === "header" ? "" : inr(r.amount), bold: !!r.style, indent: r.indent ?? 0 };
}

// Form G is one fixed-layout statement, flattened into section + line rows.
function formGLines(s?: FormGStatement): Line[] {
  if (!s) return [];
  const out: Line[] = [];
  const category = (heading: string, list: FormGStatement["section1Advanced"]) => {
    out.push({ title: heading, detail: "", bold: true, indent: 0 });
    for (const c of list ?? []) out.push({ title: c.label, detail: `${c.persons} persons · ${inr(c.amount)}${c.remarks ? ` · ${c.remarks}` : ""}`, indent: 1 });
  };
  category("1. Loans advanced during the period", s.section1Advanced);
  category("2. Loans redeemed during the period", s.section2Redeemed);
  const d = s.section3Deposits;
  out.push({ title: "3. Deposits", detail: "", bold: true, indent: 0 });
  out.push({ title: "Opening balance", detail: `${d.openingCount} · ${inr(d.openingAmount)}`, indent: 1 });
  out.push({ title: "Received during the period", detail: `${d.duringCount} · ${inr(d.duringAmount)}`, indent: 1 });
  out.push({ title: "Repaid during the period", detail: `${d.repaidCount} · ${inr(d.repaidAmount)}`, indent: 1 });
  out.push({ title: "Closing balance", detail: `${d.closingCount} · ${inr(d.closingAmount)}`, indent: 1 });
  const f = s.section4FinancialPosition;
  out.push({ title: "4. Financial position", detail: "", bold: true, indent: 0 });
  out.push({ title: "Maximum outstanding", detail: `${inr(f.maxOutstanding)}${f.maxOutstandingDate ? ` on ${dmy(f.maxOutstandingDate)}` : ""}`, indent: 1 });
  out.push({ title: "Value of assets", detail: inr(f.assetsValue), indent: 1 });
  out.push({ title: "Value of liabilities", detail: inr(f.liabilitiesValue), indent: 1 });
  out.push({ title: "Excess of assets over liabilities", detail: inr(f.excessAssetsOverLiabilities), indent: 1 });
  out.push({ title: "Excess of liabilities over assets", detail: inr(f.excessLiabilitiesOverAssets), indent: 1 });
  return out;
}
