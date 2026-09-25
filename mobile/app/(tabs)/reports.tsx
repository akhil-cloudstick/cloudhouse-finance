import React, { useEffect, useState } from "react";
import { useLocalSearchParams } from "expo-router";
import { View, StyleSheet, Pressable, RefreshControl, Alert } from "react-native";
import { GutterScrollView } from "../../src/components/Gutter";
import { useQuery } from "@tanstack/react-query";
import * as Print from "expo-print";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import { useRefetchOnFocus, useResetOnBlur } from "../../src/hooks/useRefetchOnFocus";
import { API_BASE_URL } from "../../src/api/config";
import { getToken } from "../../src/auth/tokenStorage";
import { ScreenContainer } from "../../src/components/ScreenContainer";
import { BottomSheetModal, SheetFlatList } from "../../src/components/BottomSheetModal";
import { EdgeFade } from "../../src/components/EdgeFade";
import { Card } from "../../src/components/Card";
import { ThemedText } from "../../src/components/ThemedText";
import { GoldButton } from "../../src/components/GoldButton";
import { colors } from "../../src/theme/colors";
import { useTheme } from "../../src/theme/ThemeProvider";
import { TENANT_MODULES, type TenantModule } from "../../src/config/tenantModules";
import {
  getDisbursement,
  getLoansStatus,
  getInterestCollection,
  getOutstandingPrincipal,
  getPaymentCollection,
  getGoldWeight,
  getPackets,
  getBankPledge,
  getLoanExtensions,
  getGoldRelease,
  getAuctions,
  getExpenseCashflow,
  getKYC,
  getGoldRateHistory,
  getEmployeePerformance,
  getCommunicationHistory,
  getPersonalLoans,
  getBalanceSheet,
  getProfitAndLoss,
  getFormG,
  getDepositRegister,
  getInterestPayoutRegister,
  getMaturityRegister,
  type FormGStatement,
  type StatementRow,
} from "../../src/api/reports";

import { fmt } from "../../src/lib/format";

const fmtW = (n: number) => `${(n ?? 0).toFixed(2)}g`;
const dt = (v?: string | null) => (v ? new Date(v).toDateString() : "—");

const ymd = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const today = () => ymd(new Date());
const firstOfMonth = () => {
  const d = new Date();
  return ymd(new Date(d.getFullYear(), d.getMonth(), 1));
};
const monthsAgo = (months: number) => {
  const d = new Date();
  d.setMonth(d.getMonth() - months);
  return ymd(d);
};

// Date windows for the reports that aren't meaningful all-time — same
// defaults as the web: Balance Sheet is a snapshot as of today, P&L covers
// month-to-date, Form G the last 3 months (see FormGReportView.tsx).
const BALANCE_SHEET_RANGE = { to: today() };
const PROFIT_LOSS_RANGE = { from: firstOfMonth(), to: today() };
const FORM_G_RANGE = { from: monthsAgo(3), to: today() };

type ReportRow = { title: string; detail: string; bold?: boolean };

// Balance Sheet / P&L rows: headers and totals bold, sub-items indented,
// header lines carry no amount (mirrors web's statementLabelCell/AmountCell).
const statementRow = (r: StatementRow): ReportRow => ({
  title: `${"   ".repeat(r.indent ?? 0)}${r.label}`,
  detail: r.style === "header" ? "" : fmt(r.amount),
  bold: !!r.style,
});

// Form G is one fixed-layout statement rather than {rows, totals}, so it's
// flattened into section-header + line rows for the shared preview list.
function formGRows(s?: FormGStatement): ReportRow[] {
  if (!s) return [];
  const out: ReportRow[] = [];
  const category = (heading: string, list: FormGStatement["section1Advanced"]) => {
    out.push({ title: heading, detail: "", bold: true });
    for (const c of list ?? []) {
      out.push({ title: c.label, detail: `${c.persons} persons · ${fmt(c.amount)}${c.remarks ? ` · ${c.remarks}` : ""}` });
    }
  };
  category("1. Loans advanced during the period", s.section1Advanced);
  category("2. Loans redeemed during the period", s.section2Redeemed);
  const d = s.section3Deposits;
  out.push({ title: "3. Deposits", detail: "", bold: true });
  out.push({ title: "Opening balance", detail: `${d.openingCount} · ${fmt(d.openingAmount)}` });
  out.push({ title: "Received during the period", detail: `${d.duringCount} · ${fmt(d.duringAmount)}` });
  out.push({ title: "Repaid during the period", detail: `${d.repaidCount} · ${fmt(d.repaidAmount)}` });
  out.push({ title: "Closing balance", detail: `${d.closingCount} · ${fmt(d.closingAmount)}` });
  const f = s.section4FinancialPosition;
  out.push({ title: "4. Financial position", detail: "", bold: true });
  out.push({ title: "Maximum outstanding", detail: `${fmt(f.maxOutstanding)}${f.maxOutstandingDate ? ` on ${dt(f.maxOutstandingDate)}` : ""}` });
  out.push({ title: "Value of assets", detail: fmt(f.assetsValue) });
  out.push({ title: "Value of liabilities", detail: fmt(f.liabilitiesValue) });
  out.push({ title: "Excess of assets over liabilities", detail: fmt(f.excessAssetsOverLiabilities) });
  out.push({ title: "Excess of liabilities over assets", detail: fmt(f.excessLiabilitiesOverAssets) });
  return out;
}

// KPI-tile visual approach reused from dashboard.tsx. Real data only — every
// number here comes straight from backend/internal/reports's 16 aggregation
// endpoints (see frontend/lib/reportsApi.ts for the web equivalent). All 16
// reports are surfaced as tiles, matching web parity; tapping a tile opens a
// "preview" modal listing the rows behind that KPI.
type Section = {
  key: string;
  title: string;
  query: ReturnType<typeof useQuery>;
  headline: (totals: any) => string;
  sub?: (totals: any) => string;
  renderRow: (row: any) => ReportRow;
  // Reports whose response isn't {rows, totals} (Form G) supply their own
  // totals/rows extraction; everything else reads data.totals / data.rows.
  totals?: (data: any) => any;
  rows?: (data: any) => any[];
  // Date window sent to both the list endpoint and the export.
  range?: { from?: string; to?: string };
  // Optional per-business module this report belongs to — hidden (and never
  // fetched) when the business doesn't have it. See src/config/tenantModules.ts.
  tenantModule?: TenantModule;
};

const NOOP = () => {};

const sectionTotals = (s: Section) => (s.totals ? s.totals(s.query.data) : (s.query.data as any)?.totals);
const sectionRows = (s: Section): any[] => (s.rows ? s.rows(s.query.data) : (s.query.data as any)?.rows ?? []);

export default function ReportsScreen() {
  const { colors, hasModule } = useTheme();
  const [preview, setPreview] = useState<Section | null>(null);
  const personalLoansOn = hasModule(TENANT_MODULES.personalLoans);
  const investmentsOn = hasModule(TENANT_MODULES.investments);

  const disbursement = useQuery({ queryKey: ["reports", "disbursement"], queryFn: () => getDisbursement({ pageSize: 50 }) });
  const loansStatus = useQuery({ queryKey: ["reports", "loans-status"], queryFn: () => getLoansStatus({ pageSize: 50 }) });
  const interestCollection = useQuery({ queryKey: ["reports", "interest-collection"], queryFn: () => getInterestCollection({ pageSize: 50 }) });
  const outstandingPrincipal = useQuery({ queryKey: ["reports", "outstanding-principal"], queryFn: () => getOutstandingPrincipal({ pageSize: 50 }) });
  const paymentCollection = useQuery({ queryKey: ["reports", "payment-collection"], queryFn: () => getPaymentCollection({ pageSize: 50 }) });
  const goldWeight = useQuery({ queryKey: ["reports", "gold-weight"], queryFn: () => getGoldWeight({ pageSize: 50 }) });
  const packets = useQuery({ queryKey: ["reports", "packets"], queryFn: () => getPackets({ pageSize: 50 }) });
  const bankPledge = useQuery({ queryKey: ["reports", "bank-pledge"], queryFn: () => getBankPledge({ pageSize: 50 }) });
  const loanExtensions = useQuery({ queryKey: ["reports", "loan-extensions"], queryFn: () => getLoanExtensions({ pageSize: 50 }) });
  const goldRelease = useQuery({ queryKey: ["reports", "gold-release"], queryFn: () => getGoldRelease({ pageSize: 50 }) });
  const auctions = useQuery({ queryKey: ["reports", "auctions"], queryFn: () => getAuctions({ pageSize: 50 }) });
  const expenseCashflow = useQuery({ queryKey: ["reports", "expense-cashflow"], queryFn: () => getExpenseCashflow({ pageSize: 50 }) });
  const kyc = useQuery({ queryKey: ["reports", "kyc"], queryFn: () => getKYC({ pageSize: 50 }) });
  const goldRateHistory = useQuery({ queryKey: ["reports", "gold-rate-history"], queryFn: () => getGoldRateHistory({ pageSize: 50 }) });
  const employeePerformance = useQuery({ queryKey: ["reports", "employee-performance"], queryFn: () => getEmployeePerformance({ pageSize: 50 }) });
  const communicationHistory = useQuery({ queryKey: ["reports", "communication-history"], queryFn: () => getCommunicationHistory({ pageSize: 50 }) });
  const personalLoans = useQuery({ queryKey: ["reports", "personal-loans"], queryFn: () => getPersonalLoans({ pageSize: 50 }), enabled: personalLoansOn });
  // Statements are short fixed layouts — fetch every line, not a page of them.
  const balanceSheet = useQuery({ queryKey: ["reports", "balance-sheet", BALANCE_SHEET_RANGE], queryFn: () => getBalanceSheet({ ...BALANCE_SHEET_RANGE, pageSize: 500 }) });
  const profitLoss = useQuery({ queryKey: ["reports", "profit-loss", PROFIT_LOSS_RANGE], queryFn: () => getProfitAndLoss({ ...PROFIT_LOSS_RANGE, pageSize: 500 }) });
  const formG = useQuery({ queryKey: ["reports", "form-g", FORM_G_RANGE], queryFn: () => getFormG(FORM_G_RANGE) });
  const depositRegister = useQuery({ queryKey: ["reports", "investments-deposit-register"], queryFn: () => getDepositRegister({ pageSize: 50 }), enabled: investmentsOn });
  const interestPayoutRegister = useQuery({ queryKey: ["reports", "investments-interest-payout-register"], queryFn: () => getInterestPayoutRegister({ pageSize: 50 }), enabled: investmentsOn });
  const maturityRegister = useQuery({ queryKey: ["reports", "investments-maturity-register"], queryFn: () => getMaturityRegister({ pageSize: 50 }), enabled: investmentsOn });

  const allQueries = [
    disbursement,
    loansStatus,
    interestCollection,
    outstandingPrincipal,
    paymentCollection,
    goldWeight,
    packets,
    bankPledge,
    loanExtensions,
    goldRelease,
    auctions,
    expenseCashflow,
    kyc,
    goldRateHistory,
    employeePerformance,
    communicationHistory,
    personalLoans,
    balanceSheet,
    profitLoss,
    formG,
    depositRegister,
    interestPayoutRegister,
    maturityRegister,
  ];

  // refetch() ignores `enabled`, so a disabled module's queries are skipped
  // here explicitly (NOOP keeps the argument count stable across renders).
  const queryOn = (q: (typeof allQueries)[number]) =>
    q === personalLoans
      ? personalLoansOn
      : q === depositRegister || q === interestPayoutRegister || q === maturityRegister
        ? investmentsOn
        : true;

  useRefetchOnFocus(...allQueries.map((q) => (queryOn(q) ? q.refetch : NOOP)));

  useResetOnBlur(() => {
    setPreview(null);
  });

  const [refreshing, setRefreshing] = useState(false);
  async function onRefresh() {
    setRefreshing(true);
    await Promise.all(allQueries.filter(queryOn).map((q) => q.refetch()));
    setRefreshing(false);
  }

  const sections: Section[] = [
    {
      key: "disbursement",
      title: "Daily Loan Disbursement",
      query: disbursement,
      headline: (t) => fmt(t?.totalAmount),
      sub: (t) => `${t?.count ?? 0} loans`,
      renderRow: (r) => ({ title: `${r.loanNumber} · ${r.customerName}`, detail: `${fmt(r.amount)} · ${r.branchName} · ${new Date(r.openedDate).toDateString()}` }),
    },
    {
      key: "loans-status",
      title: "Active / Closed / Overdue Loans",
      query: loansStatus,
      headline: (t) => String(t?.count ?? 0),
      sub: (t) => `${t?.active ?? 0} active · ${t?.overdue ?? 0} overdue · ${t?.dueSoon ?? 0} due soon`,
      renderRow: (r) => ({ title: `${r.loanNumber} · ${r.customerName}`, detail: `${r.status} · ${fmt(r.outstanding)} outstanding` }),
    },
    {
      key: "interest-collection",
      title: "Interest & Penal Collection",
      query: interestCollection,
      headline: (t) => fmt(t?.total),
      sub: (t) => `${fmt(t?.totalInterest)} interest · ${fmt(t?.totalPenal)} penal`,
      renderRow: (r) => ({ title: r.loanNumber, detail: `${fmt(r.interestApplied)} + ${fmt(r.penalApplied)} penal · ${new Date(r.paidOn).toDateString()}` }),
    },
    {
      key: "outstanding-principal",
      title: "Outstanding Principal",
      query: outstandingPrincipal,
      headline: (t) => fmt(t?.totalOutstanding),
      sub: (t) => `${t?.totalLoans ?? 0} loans across branches`,
      renderRow: (r) => ({ title: r.branchName, detail: `${r.loanCount} loans · ${fmt(r.outstanding)} outstanding` }),
    },
    {
      key: "payment-collection",
      title: "Payment Collection",
      query: paymentCollection,
      headline: (t) => fmt(t?.totalAmount),
      sub: (t) => `${t?.count ?? 0} payments`,
      renderRow: (r) => ({ title: `${r.loanNumber} · ${r.type}`, detail: `${fmt(r.amount)} · ${r.branchName} · ${r.employeeName} · ${dt(r.paidOn)}` }),
    },
    {
      key: "gold-weight",
      title: "Gold / Ornament & Weight",
      query: goldWeight,
      headline: (t) => fmtW(t?.totalNetWeight),
      sub: (t) => `${fmt(t?.totalGoldValue)} total value`,
      renderRow: (r) => ({ title: `${r.name} · ${r.loanNumber}`, detail: `${r.customerName} · ${r.purity} · ${fmtW(r.netWeight)} net · ${fmt(r.goldValue)}` }),
    },
    {
      key: "packets",
      title: "Packet Tracking & Locker",
      query: packets,
      headline: (t) => String(t?.count ?? 0),
      sub: (t) => `${t?.inLocker ?? 0} in locker · ${t?.bankPledged ?? 0} pledged · ${t?.released ?? 0} released`,
      renderRow: (r) => ({ title: `${r.code} · ${r.loanNumber}`, detail: `${r.status} · ${r.lockerCode || "—"} · ${r.movementCount} movements` }),
    },
    {
      key: "bank-pledge",
      title: "Bank Pledge & Liability",
      query: bankPledge,
      headline: (t) => fmt(t?.outstandingLiability),
      sub: (t) => `${t?.count ?? 0} pledge records`,
      renderRow: (r) => ({ title: `${r.loanNumber} · ${r.bankName}`, detail: `${fmt(r.pledgedAmount)} · ${r.status}` }),
    },
    {
      key: "loan-extensions",
      title: "Loan Extensions",
      query: loanExtensions,
      headline: (t) => String(t?.count ?? 0),
      sub: () => "requested tenure extensions",
      renderRow: (r) => ({ title: r.loanNumber, detail: `${r.months ?? "—"} months · new due ${dt(r.newDueDate)} · ${r.status}` }),
    },
    {
      key: "gold-release",
      title: "Gold Release / Closure",
      query: goldRelease,
      headline: (t) => String(t?.count ?? 0),
      sub: (t) => `${fmt(t?.totalSettlement)} total settlement`,
      renderRow: (r) => ({ title: `${r.loanNumber} · ${r.customerName}`, detail: `${fmt(r.settlementAmount)} · ${r.status} · ${dt(r.requestedAt)}` }),
    },
    {
      key: "auctions",
      title: "Auction Reports",
      query: auctions,
      headline: (t) => String(t?.count ?? 0),
      sub: (t) => `${fmt(t?.totalSaleAmount)} total sale amount`,
      renderRow: (r) => ({ title: r.loanNumber, detail: `${r.stage} · ${r.settlementStatus} · ${fmt(r.saleAmount)}` }),
    },
    {
      key: "expense-cashflow",
      title: "Expense & Cash Flow",
      query: expenseCashflow,
      headline: (t) => fmt(t?.netCashflow),
      sub: (t) => `${fmt(t?.totalCollections)} in · ${fmt(t?.totalDisbursements)} out`,
      renderRow: (r) => ({ title: r.branchName, detail: `${new Date(r.date).toDateString()} · ${fmt(r.collections)} in / ${fmt(r.disbursements)} out` }),
    },
    {
      key: "kyc",
      title: "KYC Verification",
      query: kyc,
      headline: (t) => String(t?.count ?? 0),
      sub: (t) => `${t?.verified ?? 0} verified · ${t?.pending ?? 0} pending`,
      renderRow: (r) => ({ title: `${r.name} · ${r.code}`, detail: `${r.kycStatus} · PAN ${r.panStatus} · Aadhaar ${r.aadhaarStatus}` }),
    },
    {
      key: "gold-rate-history",
      title: "Gold Rate History",
      query: goldRateHistory,
      headline: (t) => String(t?.count ?? 0),
      sub: () => "published daily rates",
      renderRow: (r) => ({ title: `${fmt(r.k24)} / g (24K)`, detail: `${dt(r.date)} · set by ${r.setBy}` }),
    },
    {
      key: "employee-performance",
      title: "Employee Performance",
      query: employeePerformance,
      headline: (t) => String(t?.totalLoansProcessed ?? 0),
      sub: (t) => `${fmt(t?.totalCollections)} collected`,
      renderRow: (r) => ({ title: `${r.name} · ${r.role}`, detail: `${r.branchName} · ${r.loansProcessed} loans · ${fmt(r.collectionsAmount)} · ${r.remindersSent} reminders · ${r.approvals} approvals` }),
    },
    {
      key: "communication-history",
      title: "Communication History",
      query: communicationHistory,
      headline: (t) => String(t?.count ?? 0),
      sub: (t) => `${t?.sent ?? 0} sent · ${t?.failed ?? 0} failed`,
      renderRow: (r) => ({ title: `${r.recipientName} · ${r.channel}`, detail: `${r.triggerType} · ${r.status} · ${r.recipientPhone} · ${dt(r.sentAt)}` }),
    },
    {
      key: "personal-loans",
      title: "Personal Loans",
      query: personalLoans,
      tenantModule: TENANT_MODULES.personalLoans,
      headline: (t) => fmt(t?.totalOutstanding),
      sub: (t) => `${t?.count ?? 0} loans · ${fmt(t?.totalDisbursed)} disbursed`,
      renderRow: (r) => ({ title: `${r.loanNumber} · ${r.customerName}`, detail: `${fmt(r.principalAmount)} · ${r.frequency} · ${r.status} · ${fmt(r.outstandingAmount)} outstanding` }),
    },
    {
      key: "balance-sheet",
      title: "Balance Sheet",
      query: balanceSheet,
      range: BALANCE_SHEET_RANGE,
      headline: (t) => fmt(t?.totalAssets),
      sub: (t) => `Assets as of today · ${fmt(t?.totalLiabilities)} liabilities · ${fmt(t?.totalEquity)} equity`,
      renderRow: statementRow,
    },
    {
      key: "profit-loss",
      title: "Statement of Profit and Loss",
      query: profitLoss,
      range: PROFIT_LOSS_RANGE,
      headline: (t) => fmt(t?.profitForPeriod),
      sub: (t) => `This month · ${fmt(t?.totalIncome)} income · ${fmt(t?.totalExpenses)} expenses`,
      renderRow: statementRow,
    },
    {
      key: "form-g",
      title: "Form G — Statement of Accounts",
      query: formG,
      range: FORM_G_RANGE,
      totals: (d) => d,
      rows: (d) => formGRows(d),
      headline: () => "Rule 15(3)",
      sub: (s) => s?.periodLabel ?? "Last 3 months",
      renderRow: (r) => r,
    },
    {
      key: "investments-deposit-register",
      title: "Investment Deposit Register",
      query: depositRegister,
      tenantModule: TENANT_MODULES.investments,
      headline: (t) => fmt(t?.totalPrincipal),
      sub: (t) => `${t?.count ?? 0} deposits`,
      renderRow: (r) => ({ title: `${r.investmentNumber} · ${r.customerName}`, detail: `${r.planName} · ${fmt(r.principalAmount)} @ ${r.interestRate}% · matures ${dt(r.maturityDate)} · ${r.status}` }),
    },
    {
      key: "investments-interest-payout-register",
      title: "Interest Payout Register",
      query: interestPayoutRegister,
      tenantModule: TENANT_MODULES.investments,
      headline: (t) => fmt(t?.totalPending),
      sub: (t) => `pending · ${fmt(t?.totalPaid)} paid of ${fmt(t?.totalDue)}`,
      renderRow: (r) => ({ title: `${r.investmentNumber} #${r.sequenceNo} · ${r.customerName}`, detail: `${fmt(r.amount)} · due ${dt(r.dueDate)} · ${r.status}${r.paidAt ? ` · paid ${dt(r.paidAt)}` : ""}` }),
    },
    {
      key: "investments-maturity-register",
      title: "Investment Maturity Register",
      query: maturityRegister,
      tenantModule: TENANT_MODULES.investments,
      headline: (t) => String(t?.count ?? 0),
      sub: (t) => `${t?.active ?? 0} active · ${t?.matured ?? 0} matured · ${t?.renewed ?? 0} renewed`,
      renderRow: (r) => ({ title: `${r.investmentNumber} · ${r.customerName}`, detail: `${fmt(r.principalAmount)} · matures ${dt(r.maturityDate)} · ${r.status}` }),
    },
  ];

  // Dashboard tiles deep-link here with ?section=<key> to open that
  // section's preview; `t` re-applies it per tap.
  const params = useLocalSearchParams<{ section?: string; t?: string }>();
  useEffect(() => {
    const target = sections.find((s) => s.key === params.section);
    if (target) setPreview(target);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.section, params.t]);

  // Prints the section whose preview sheet is open. Used to build its own
  // ad-hoc HTML table client-side, which looked nothing like the web app's
  // print output — the web "Print" button just downloads the real,
  // server-rendered PDF (GET /reports/export/:key?format=pdf, same
  // backend/internal/reports/export.go handler exportSection below already
  // uses for .xlsx) and lets the browser print that. Mirroring that here:
  // download the same PDF, then hand its local file uri straight to the
  // system print dialog — same document either platform prints, not a
  // reimplementation of its layout.
  const [printing, setPrinting] = useState(false);

  async function printSection(section: Section) {
    setPrinting(true);
    try {
      const token = await getToken();
      const targetUri = `${FileSystem.cacheDirectory}${section.key}-${Date.now()}.pdf`;
      const qs = new URLSearchParams({ format: "pdf" });
      if (section.range?.from) qs.set("from", section.range.from);
      if (section.range?.to) qs.set("to", section.range.to);
      const result = await FileSystem.downloadAsync(
        `${API_BASE_URL}/reports/export/${section.key}?${qs.toString()}`,
        targetUri,
        { headers: token ? { Authorization: `Bearer ${token}` } : {} }
      );
      if (result.status < 200 || result.status >= 300) {
        throw new Error(`Print failed (${result.status})`);
      }
      await Print.printAsync({ uri: result.uri });
    } catch (e) {
      Alert.alert("Print failed", e instanceof Error ? e.message : "Could not print — try again.");
    } finally {
      setPrinting(false);
    }
  }

  // Exports the section whose preview sheet is open as a real .xlsx —
  // unlike printSection above (which only prints the ~50 rows already
  // fetched for the on-screen preview), this hits the same
  // GET /reports/export/:key?format=xlsx the web app's "Export" button
  // uses (backend/internal/reports/export.go's Handler.Export), which
  // ignores pagination and builds the full filtered dataset server-side
  // via excelize — no xlsx-generation logic needed on the mobile side.
  const [exporting, setExporting] = useState(false);

  async function exportSection(section: Section) {
    setExporting(true);
    try {
      const token = await getToken();
      const filename = `${section.key}-${Date.now()}.xlsx`;
      const targetUri = `${FileSystem.cacheDirectory}${filename}`;
      const qs = new URLSearchParams({ format: "xlsx" });
      if (section.range?.from) qs.set("from", section.range.from);
      if (section.range?.to) qs.set("to", section.range.to);
      const result = await FileSystem.downloadAsync(
        `${API_BASE_URL}/reports/export/${section.key}?${qs.toString()}`,
        targetUri,
        { headers: token ? { Authorization: `Bearer ${token}` } : {} }
      );
      if (result.status < 200 || result.status >= 300) {
        throw new Error(`Export failed (${result.status})`);
      }
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(result.uri, {
          mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          dialogTitle: `${section.title} export`,
        });
      } else {
        Alert.alert("Saved", `Saved to ${result.uri} — sharing isn't available on this device.`);
      }
    } catch (e) {
      Alert.alert("Export failed", e instanceof Error ? e.message : "Could not export — try again.");
    } finally {
      setExporting(false);
    }
  }

  return (
    <ScreenContainer style={{ padding: 0 }}>
      <View style={{ flex: 1, paddingHorizontal: 8, paddingTop: 20 }}>
      <GutterScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        <View style={styles.grid}>
          {sections.filter((s) => !s.tenantModule || hasModule(s.tenantModule)).map((s) => {
            const totals = sectionTotals(s);
            return (
              <Pressable key={s.key} style={styles.tileWrap} onPress={() => setPreview(s)}>
                <Card style={styles.tile}>
                  <ThemedText variant="label" color={colors.muted}>
                    {s.title}
                  </ThemedText>
                  <ThemedText variant="h3">
                    {s.query.isLoading ? "…" : s.query.isError ? "—" : s.headline(totals)}
                  </ThemedText>
                  {s.sub ? (
                    <ThemedText variant="small" color={colors.muted}>
                      {s.query.isLoading ? "" : s.query.isError ? "Could not load" : s.sub(totals)}
                    </ThemedText>
                  ) : null}
                </Card>
              </Pressable>
            );
          })}
        </View>
      </GutterScrollView>

      <BottomSheetModal visible={!!preview} onClose={() => setPreview(null)} maxHeightPct={85}>
        <View style={styles.sheetHeader}>
          <ThemedText variant="h3" color={colors.brandDeep} numberOfLines={1} style={{ flex: 1 }}>
            {preview?.title}
          </ThemedText>
          <Pressable onPress={() => setPreview(null)} hitSlop={10} style={{ paddingLeft: 12 }}>
            <ThemedText variant="h3" color={colors.muted}>
              ×
            </ThemedText>
          </Pressable>
        </View>
        {/* Each of the 16 reports has its own bespoke row shape (renderRow
         * returns a plain title/detail pair, not a fixed set of columns
         * like Loans/Customers), so this stays a title+detail list rather
         * than forcing 16 one-off column definitions onto the shared
         * table component — but it picks up the same single-card
         * shadow/border/divider treatment as everywhere else instead of a
         * stack of individually-shadowed Cards. */}
        <View style={{ flexShrink: 1 }}>
          {(() => {
            const rows = preview ? sectionRows(preview) : [];
            if (rows.length === 0) {
              return <ThemedText color={colors.muted}>No records.</ThemedText>;
            }
            return (
              <SheetFlatList
                data={rows}
                keyExtractor={(_, i) => String(i)}
                showsVerticalScrollIndicator={true}
                style={{ flexShrink: 1 }}
                // Padding gives the cards' shadows room inside the list's clip.
                contentContainerStyle={{ paddingHorizontal: 6, paddingTop: 4, paddingBottom: 6 }}
                renderItem={({ item, index }) => {
                  const row = preview!.renderRow(item);
                  // Same "each row its own separated, shadowed card" treatment
                  // as every other table in the app now uses (see
                  // ExpandableTable.tsx's cardRows) — this preview list is its
                  // own bespoke title/detail layout rather than TableRow (16
                  // reports, 16 different row shapes), so it re-implements the
                  // card look directly instead of sharing that component.
                  return (
                    <View style={styles.previewCardOuter}>
                      <View style={styles.previewCardInner}>
                        <ThemedText variant="body" style={row.bold ? { fontWeight: "700" } : undefined}>
                          {row.title}
                        </ThemedText>
                        {row.detail ? (
                          <ThemedText variant="small" color={colors.muted} style={row.bold ? { fontWeight: "700" } : undefined}>
                            {row.detail}
                          </ThemedText>
                        ) : null}
                      </View>
                    </View>
                  );
                }}
              />
            );
          })()}
          {/* Soft fade where the scrolling list meets the fixed header/footer
              bars, matching the same edge-fade treatment used elsewhere in
              the app rather than a hard cut against those solid bars. */}
          <EdgeFade edge="top" />
          <EdgeFade edge="bottom" />
        </View>
        {/* Pinned below the list (outside it), so the actions stay visible however far the report scrolls. */}
        <View style={styles.sheetFooter}>
          <View style={{ flex: 1 }}>
            <GoldButton
              title={exporting ? "Exporting…" : "Export .xlsx"}
              icon="download"
              variant="outline"
              onPress={() => preview && exportSection(preview)}
              disabled={exporting || !preview}
            />
          </View>
          <View style={{ flex: 1 }}>
            <GoldButton
              title={printing ? "Printing…" : "Print"}
              icon="doc"
              onPress={() => preview && printSection(preview)}
              disabled={printing || !preview}
            />
          </View>
        </View>
      </BottomSheetModal>
      </View>
    </ScreenContainer>  );
}

const styles = StyleSheet.create({
  sheetFooter: { flexDirection: "row", gap: 8, paddingTop: 12, borderTopWidth: 1, borderTopColor: colors.line, marginTop: 8 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  tileWrap: { minWidth: "47%", flexGrow: 1 },
  tile: { flex: 1 },
  sheetHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 16,
  },
  // Mirrors ExpandableTable.tsx's cardOuter/cardInner split — the shadow
  // and the rounded/clipped border live on two nested Views rather than
  // one, since a View can't clip its children via overflow:hidden while
  // still painting a shadow that extends past its own bounds on iOS.
  // Same card look as every other table's rows (ExpandableTable cardOuter/cardInner).
  previewCardOuter: {
    marginBottom: 10,
    borderRadius: 14,
    boxShadow: "0px 5px 10px rgba(43, 26, 94, 0.2)",
  },
  previewCardInner: {
    borderRadius: 14,
    overflow: "hidden",
    backgroundColor: colors.card,
    paddingVertical: 16,
    paddingHorizontal: 14,
  },
});
