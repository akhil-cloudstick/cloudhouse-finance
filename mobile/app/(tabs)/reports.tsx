import React, { useState } from "react";
import { View, StyleSheet, Pressable, RefreshControl, Alert } from "react-native";
import { GutterScrollView } from "../../src/components/Gutter";
import { useQuery } from "@tanstack/react-query";
import * as Print from "expo-print";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import { useRefetchOnFocus } from "../../src/hooks/useRefetchOnFocus";
import { API_BASE_URL } from "../../src/api/config";
import { getToken } from "../../src/auth/tokenStorage";
import { ScreenContainer } from "../../src/components/ScreenContainer";
import { BottomSheetModal, SheetFlatList } from "../../src/components/BottomSheetModal";
import { Card } from "../../src/components/Card";
import { ThemedText } from "../../src/components/ThemedText";
import { GoldButton } from "../../src/components/GoldButton";
import { colors } from "../../src/theme/colors";
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
} from "../../src/api/reports";

import { fmt } from "../../src/lib/format";
import { BRAND } from "../../src/config/brand";

const fmtW = (n: number) => `${(n ?? 0).toFixed(2)}g`;
const dt = (v?: string | null) => (v ? new Date(v).toDateString() : "—");

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
  renderRow: (row: any) => { title: string; detail: string };
};

export default function ReportsScreen() {
  const [preview, setPreview] = useState<Section | null>(null);

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
  ];

  useRefetchOnFocus(...allQueries.map((q) => q.refetch));

  const [refreshing, setRefreshing] = useState(false);
  async function onRefresh() {
    setRefreshing(true);
    await Promise.all(allQueries.map((q) => q.refetch()));
    setRefreshing(false);
  }

  const sections: Section[] = [
    {
      key: "disbursement",
      title: "Disbursement",
      query: disbursement,
      headline: (t) => fmt(t?.totalAmount),
      sub: (t) => `${t?.count ?? 0} loans`,
      renderRow: (r) => ({ title: `${r.loanNumber} · ${r.customerName}`, detail: `${fmt(r.amount)} · ${r.branchName} · ${new Date(r.openedDate).toDateString()}` }),
    },
    {
      key: "loans-status",
      title: "Loan Status",
      query: loansStatus,
      headline: (t) => String(t?.count ?? 0),
      sub: (t) => `${t?.active ?? 0} active · ${t?.overdue ?? 0} overdue · ${t?.dueSoon ?? 0} due soon`,
      renderRow: (r) => ({ title: `${r.loanNumber} · ${r.customerName}`, detail: `${r.status} · ${fmt(r.outstanding)} outstanding` }),
    },
    {
      key: "interest-collection",
      title: "Interest Collected",
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
      title: "Bank-Pledged Loans",
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
      title: "Gold Release Requests",
      query: goldRelease,
      headline: (t) => String(t?.count ?? 0),
      sub: (t) => `${fmt(t?.totalSettlement)} total settlement`,
      renderRow: (r) => ({ title: `${r.loanNumber} · ${r.customerName}`, detail: `${fmt(r.settlementAmount)} · ${r.status} · ${dt(r.requestedAt)}` }),
    },
    {
      key: "auctions",
      title: "Auction Cases",
      query: auctions,
      headline: (t) => String(t?.count ?? 0),
      sub: (t) => `${fmt(t?.totalSaleAmount)} total sale amount`,
      renderRow: (r) => ({ title: r.loanNumber, detail: `${r.stage} · ${r.settlementStatus} · ${fmt(r.saleAmount)}` }),
    },
    {
      key: "expense-cashflow",
      title: "Net Cashflow",
      query: expenseCashflow,
      headline: (t) => fmt(t?.netCashflow),
      sub: (t) => `${fmt(t?.totalCollections)} in · ${fmt(t?.totalDisbursements)} out`,
      renderRow: (r) => ({ title: r.branchName, detail: `${new Date(r.date).toDateString()} · ${fmt(r.collections)} in / ${fmt(r.disbursements)} out` }),
    },
    {
      key: "kyc",
      title: "KYC Status",
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
  ];

  // Prints the section whose preview sheet is open — headline, sub-line and
  // every row currently listed in the sheet. Goes straight to the system
  // print dialog (Print.printAsync); the earlier
  // printToFileAsync + Sharing.shareAsync path failed on Android with
  // "Not allowed to read file under given URL" because the generated PDF
  // lives in a cache dir the share target can't read.
  const [printing, setPrinting] = useState(false);

  async function printSection(section: Section) {
    setPrinting(true);
    try {
      const data = section.query.data as any;
      const totals = data?.totals;
      const rows: any[] = data?.rows ?? [];
      const rowsHtml = rows.length
        ? rows
            .map((r) => {
              const row = section.renderRow(r);
              return `<tr><td style="padding:6px 10px;border-bottom:1px solid #e9e4f2;">${row.title}</td>
                <td style="padding:6px 10px;border-bottom:1px solid #e9e4f2;color:#64748b;">${row.detail}</td></tr>`;
            })
            .join("")
        : `<tr><td colspan="2" style="padding:10px;color:#64748b;">No records.</td></tr>`;
      const html = `
        <html>
          <body style="font-family: -apple-system, sans-serif; padding: 24px; color: #16233d;">
            <h1 style="color:#2b1a5e;margin:0 0 4px;">${BRAND.legalName}</h1>
            <h2 style="margin:0 0 4px;">${section.title}</h2>
            <p style="margin:0 0 4px;"><b>${section.headline(totals)}</b>${
              section.sub ? ` — ${section.sub(totals)}` : ""
            }</p>
            <p style="margin:0 0 16px;color:#64748b;font-size:12px;">Generated ${new Date().toLocaleString()} · ${rows.length} rows</p>
            <table style="width:100%;border-collapse:collapse;font-size:13px;">${rowsHtml}</table>
          </body>
        </html>
      `;
      await Print.printAsync({ html });
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
      const result = await FileSystem.downloadAsync(
        `${API_BASE_URL}/reports/export/${section.key}?format=xlsx`,
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
          {sections.map((s) => {
            const totals = (s.query.data as any)?.totals;
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
        {(() => {
          const rows: any[] = (preview?.query.data as any)?.rows ?? [];
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
                      <ThemedText variant="body">{row.title}</ThemedText>
                      <ThemedText variant="small" color={colors.muted}>
                        {row.detail}
                      </ThemedText>
                    </View>
                  </View>
                );
              }}
            />
          );
        })()}
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
