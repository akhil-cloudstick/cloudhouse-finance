import React, { useState } from "react";
import { ScrollView, View, StyleSheet, Pressable, FlatList } from "react-native";
import { useQuery } from "@tanstack/react-query";
import * as Print from "expo-print";
import * as Sharing from "expo-sharing";
import { ScreenContainer } from "../../src/components/ScreenContainer";
import { BottomSheetModal } from "../../src/components/BottomSheetModal";
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

  async function printReport() {
    const rowsHtml = sections
      .map((s) => {
        const totals = (s.query.data as any)?.totals;
        return `<h3>${s.title}</h3><p><b>${s.headline(totals)}</b>${s.sub ? ` — ${s.sub(totals)}` : ""}</p>`;
      })
      .join("");
    const html = `
      <html>
        <body style="font-family: -apple-system, sans-serif; padding: 24px;">
          <h1>Ambika Gold Finance — Reports Summary</h1>
          <p>Generated ${new Date().toLocaleString()}</p>
          <hr/>
          ${rowsHtml}
        </body>
      </html>
    `;
    const { uri } = await Print.printToFileAsync({ html });
    if (await Sharing.isAvailableAsync()) {
      await Sharing.shareAsync(uri, { mimeType: "application/pdf", dialogTitle: "Reports Summary" });
    } else {
      await Print.printAsync({ html });
    }
  }

  return (
    <ScreenContainer>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <ThemedText variant="h2" color={colors.goldDeep}>
          Reports
        </ThemedText>
        <GoldButton title="Print" variant="outline" onPress={printReport} />
      </View>

      <ScrollView showsVerticalScrollIndicator={false}>
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
      </ScrollView>

      <BottomSheetModal visible={!!preview} onClose={() => setPreview(null)} maxHeightPct={85}>
        <View style={styles.sheetHeader}>
          <ThemedText variant="h3">{preview?.title}</ThemedText>
          <Pressable onPress={() => setPreview(null)}>
            <ThemedText variant="h3" color={colors.muted}>
              ×
            </ThemedText>
          </Pressable>
        </View>
        <FlatList
          data={(preview?.query.data as any)?.rows ?? []}
          keyExtractor={(_, i) => String(i)}
          ListEmptyComponent={<ThemedText color={colors.muted}>No records.</ThemedText>}
          renderItem={({ item }) => {
            const row = preview!.renderRow(item);
            return (
              <Card>
                <ThemedText variant="body">{row.title}</ThemedText>
                <ThemedText variant="small" color={colors.muted}>
                  {row.detail}
                </ThemedText>
              </Card>
            );
          }}
        />
      </BottomSheetModal>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  tileWrap: { minWidth: "47%", flexGrow: 1 },
  tile: { flex: 1 },
  sheetHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 16,
  },
});
