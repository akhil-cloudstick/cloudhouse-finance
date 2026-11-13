import { useShowBranchFilter } from "@/common/hooks/use-branch-switch";
import React, { useEffect, useRef, useState } from "react";
import { View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import * as Print from "expo-print";
import * as Sharing from "expo-sharing";
import { AccRow, Buffering, C, Card, EmptyText, ExportMenu, FlatHeader, PScroll, GroupedFilter, emptyGroupedFilter, gfDate, gfValues, type GroupedFilterValue, type GFSection, Screen, SearchFilterRow,ServerFlatList, Txt, toast } from "@/common/components/ui";
import { listBranchesPage } from "@/modules/branches/services/branchService";
import { useServerList } from "@/common/hooks/use-server-list";
import { useTheme } from "@/common/theme/ThemeProvider";
import { getFormG } from "@/modules/reports/services/reportsService";
import { downloadExport } from "@/modules/reports/services/reportDownload";
import { REPORTS, firstOfMonth } from "@/modules/reports/pages/ReportsScreen";
import { type FormGStatement, type StatementRow } from "@/modules/reports/types/reports-types";
import { dmy, inr, todayISO } from "@/common/utils/format";
import { isUserCancel, userMessage } from "@/common/services/apiErrors";

// Report details — its own page (app/(tabs)/reports/[key].tsx), opened from the Reports list.
/* eslint-disable @typescript-eslint/no-explicit-any */

export default function ReportDetailScreen() {
  const { key } = useLocalSearchParams<{ key: string }>();
  const { hasModule } = useTheme();
  const found = REPORTS.find((x) => x.key === key);
  const report = found && (!found.tenantModule || hasModule(found.tenantModule)) ? found : null;
  const visible = !!report;
  // No Branch filter for a one-branch business or a branch-confined role (same rule as web).
  const showBranchFilter = useShowBranchFilter();
  const [fv, setFv] = useState<GroupedFilterValue>(emptyGroupedFilter());
  const from = gfDate(fv, "date").from ?? "";
  const to = gfDate(fv, "date").to ?? "";
  const branchId = (fv.options["branch"] ?? []).map((o) => o.value).join(",") || undefined;
  const [printing, setPrinting] = useState(false);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    if (report) {
      // Table reports open on the current month, like web; the statements set their own range.
      const r = report.defaultRange?.() ?? (report.kind === "table" ? { from: firstOfMonth(), to: todayISO() } : {});
      // Default range seeds the Date section; Reset all clears it (like web).
      setFv({ options: {}, dates: { date: { from: r.from || undefined, to: r.to || undefined } } });
    }
  }, [report]);

  const isTable = report?.kind === "table";
  const totalsRef = useRef<any>(null);
  // Each group's selection goes out as its own param (comma-joined) — on the fetch and on the export.
  const extra: Record<string, string> = {};
  for (const g of report?.filterGroups ?? []) {
    const v = gfValues(fv, g.key);
    if (v.length) extra[g.param] = v.join(",");
  }
  const extraKey = JSON.stringify(extra);
  const filters = { from: from || undefined, to: to || undefined, branchId, extra: Object.keys(extra).length ? extra : undefined };
  const list = useServerList<any, { from?: string; to?: string; branchId?: string; extraKey: string; rk: string }>({
    key: ["reports", "table"],
    filters: { from: filters.from, to: filters.to, branchId, extraKey, rk: report?.key ?? "" },
    enabled: visible && isTable,
    fetchPage: async (p) => {
      const page = Math.floor(p.offset / p.limit) + 1;
      const res = await report!.fetch!({ page, pageSize: p.limit, q: p.q, from: p.from, to: p.to, branchId: p.branchId, extra: filters.extra });
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
    queryKey: ["reports", "statement", report?.key, from, to, branchId],
    queryFn: () => report!.fetch!({ from: from || undefined, to: to || undefined, branchId, pageSize: 500 }),
    enabled: visible && report?.kind === "statement",
  });
  const formG = useQuery({
    queryKey: ["reports", "form-g", from, to, branchId],
    queryFn: () => getFormG({ from: from || undefined, to: to || undefined, branchId }),
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

  // One grouped filter (Branch, the report's extra dropdown, Date) with the
  // Export Excel / Export PDF buttons beside it, in the table header.
  const sections: GFSection[] = report
    ? [
        ...(!showBranchFilter ? [] : [{
          kind: "async" as const,
          key: "branch",
          label: "Branch",
          fetchPage: (p: { q?: string; limit: number; offset: number }) => listBranchesPage({ q: p.q, limit: p.limit, offset: p.offset }).then((r) => ({ items: r.items.map((b) => ({ value: String(b.id), label: b.name })), hasMore: r.hasMore })),
        }]),
        ...(report.filterGroups ?? []).map((g) => g.section),
        { kind: "date", key: "date", label: "Date", hideFrom: report.key === "balance-sheet" },
      ]
    : [];
  const headExtra = report ? (
    <View style={{ paddingTop: 12, paddingBottom: 10 }}>
      {isTable ? (
        <SearchFilterRow
          value={list.search}
          onChangeText={list.setSearch}
          placeholder="Search this report"
          style={{ paddingHorizontal: 16, paddingBottom: 0 }}
          filter={
            <>
              <GroupedFilter title="Filter report" sections={sections} value={fv} onChange={setFv} />
              <ExportMenu busy={exporting || printing} onExcel={onExport} onPdf={onPrint} />
            </>
          }
        />
      ) : (
        <View style={{ paddingHorizontal: 16, flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <GroupedFilter title="Filter report" sections={sections} value={fv} onChange={setFv} />
          <View style={{ flex: 1 }} />
          <ExportMenu busy={exporting || printing} onExcel={onExport} onPdf={onPrint} />
        </View>
      )}
    </View>
  ) : null;

  let body: React.ReactNode = null;
  if (!report) body = null;
  else if (isTable)
    body = (
      <ServerFlatList
        list={list}
        items={list.items}
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
      <PScroll>
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
      </PScroll>
    );
  }

  return (
    <Screen header={<FlatHeader back title={report?.title ?? "Report"} subtitle="Report details" />}>
      {!report ? <EmptyText>This report is not available.</EmptyText> : (
        <>
          {headExtra}
          <View style={{ flex: 1 }}>{body}</View>
        </>
      )}
    </Screen>
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
