import { useShowBranchFilter } from "@/common/hooks/use-branch-switch";
import { previewPdf } from "@/common/utils/presentFile";
import React, { useRef, useState } from "react";
import { View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import * as Sharing from "expo-sharing";
import { usePersistedState } from "@/common/hooks/use-persisted-state";
import { AccRow, Buffering, C, Card, EmptyText, FabMenu, Field, FlatHeader, Input, PScroll, SelectField, GroupedFilter, gfDate, gfValues, type GroupedFilterValue, type GFSection, Screen, SearchFilterRow,ServerFlatList, Txt, toast } from "@/common/components/ui";
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
  // Each report remembers its filters and search while moving around (web ReportView's `reports:<id>:*`), so
  // opening a record and coming back lands on the same view. Absent a saved value, the report's default range.
  const defaultFv = (): GroupedFilterValue => {
    const r = report?.defaultRange?.() ?? (report?.kind === "table" ? { from: firstOfMonth(), to: todayISO() } : {});
    return { options: {}, dates: { date: { from: r.from || undefined, to: r.to || undefined } } };
  };
  const [storedFv, setFv] = usePersistedState<GroupedFilterValue | null>(report ? `reports:${report.key}:filters` : null, null);
  const fv = storedFv ?? defaultFv();
  const from = gfDate(fv, "date").from ?? "";
  const to = gfDate(fv, "date").to ?? "";
  const branchId = (fv.options["branch"] ?? []).map((o) => o.value).join(",") || undefined;
  const [printing, setPrinting] = useState(false);
  const [exporting, setExporting] = useState(false);

  // Form G: a named period (quarter / year) replaces the From / To range; "" is the custom range.
  const [period, setPeriod] = usePersistedState<string>("reports:form-g:period", "");
  const [year, setYear] = usePersistedState<number>("reports:form-g:year", new Date().getFullYear());
  const isFormG = report?.kind === "formg";
  const usePeriod = isFormG && !!period;
  const isTable = report?.kind === "table";
  const totalsRef = useRef<any>(null);
  // Each group's selection goes out as its own param (comma-joined) — on the fetch and on the export.
  const extra: Record<string, string> = {};
  for (const g of report?.filterGroups ?? []) {
    const v = gfValues(fv, g.key);
    if (v.length) extra[g.param] = v.join(",");
  }
  const extraKey = JSON.stringify(extra);
  const filters = { from: usePeriod ? undefined : from || undefined, to: usePeriod ? undefined : to || undefined, branchId, extra: Object.keys(extra).length ? extra : undefined };
  const list = useServerList<any, { from?: string; to?: string; branchId?: string; extraKey: string; rk: string }>({
    key: ["reports", "table"],
    filters: { from: filters.from, to: filters.to, branchId, extraKey, rk: report?.key ?? "" },
    persistKey: report ? `reports:${report.key}` : undefined,
    keepSearch: true,
    enabled: visible && isTable,
    fetchPage: async (p) => {
      const page = Math.floor(p.offset / p.limit) + 1;
      const res = await report!.fetch!({ page, pageSize: p.limit, q: p.q, from: p.from, to: p.to, branchId: p.branchId, extra: filters.extra });
      totalsRef.current = res.totals;
      return { items: res.rows ?? [], hasMore: page * p.limit < (res.totalCount ?? 0), total: res.totalCount };
    },
  });

  // Statements are short fixed layouts — every line in one request.
  const statement = useQuery({
    queryKey: ["reports", "statement", report?.key, from, to, branchId],
    queryFn: () => report!.fetch!({ from: from || undefined, to: to || undefined, branchId, pageSize: 500 }),
    enabled: visible && report?.kind === "statement",
  });
  const formG = useQuery({
    queryKey: ["reports", "form-g", usePeriod ? period : "", usePeriod ? year : "", usePeriod ? "" : from, usePeriod ? "" : to, branchId],
    queryFn: () => getFormG(usePeriod ? { period, year, branchId } : { from: from || undefined, to: to || undefined, branchId }),
    enabled: visible && report?.kind === "formg",
  });

  // Form G's hand-entered figures (deposits, assets, liabilities) — never saved, they apply to the export only
  // and reset whenever the period / range / branch changes (web FormGReportView).
  const formGKey = `${period}|${year}|${from}|${to}|${branchId ?? ""}`;
  const [ovr, setOvr] = useState<{ k: string; v: Record<string, string> }>({ k: "", v: {} });
  const overrides = ovr.k === formGKey ? ovr.v : {};
  const setOverride = (key: string, value: string) => setOvr({ k: formGKey, v: { ...overrides, [key]: value.replace(/[^0-9.]/g, "") } });
  const formGExtra: Record<string, string> = {};
  if (isFormG) {
    if (usePeriod) {
      formGExtra.period = period;
      formGExtra.year = String(year);
    }
    for (const [k, v] of Object.entries(overrides)) if (v && Number(v) !== 0) formGExtra[k] = v;
  }
  const range = { ...filters, extra: isFormG ? formGExtra : filters.extra, q: isTable ? list.search.trim() || undefined : undefined };
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
      await previewPdf(uri);
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
        // A Form G period replaces the date range.
        ...(usePeriod ? [] : [{ kind: "date" as const, key: "date", label: "Date", hideFrom: report.key === "balance-sheet" }]),
      ]
    : [];
  const headExtra = report ? (
    <View style={{ paddingTop: 12, paddingBottom: 16 }}>
      {isTable ? (
        <SearchFilterRow
          value={list.search}
          onChangeText={list.setSearch}
          placeholder="Search this report"
          style={{ paddingHorizontal: 16, paddingBottom: 0 }}
          filter={
            <GroupedFilter title="Filter report" sections={sections} value={fv} onChange={setFv} />
          }
        />
      ) : (
        <View style={{ paddingHorizontal: 16, flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <GroupedFilter title="Filter report" sections={sections} value={fv} onChange={setFv} />
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
            {isFormG ? (
              <Card style={{ marginHorizontal: 16, marginBottom: 12, padding: 14 }}>
                <SelectField
                  label="Period"
                  value={period}
                  options={["", "q1", "q2", "q3", "q4", "annual"]}
                  labels={{ "": "Custom range", q1: "Q1 (Jan–Mar)", q2: "Q2 (Apr–Jun)", q3: "Q3 (Jul–Sep)", q4: "Q4 (Oct–Dec)", annual: "Annual / Full year" }}
                  onChange={setPeriod}
                />
                {period ? (
                  <SelectField
                    label="Year"
                    value={String(year)}
                    options={Array.from({ length: 8 }, (_, i) => String(new Date().getFullYear() - i))}
                    onChange={(v) => setYear(Number(v))}
                  />
                ) : null}
              </Card>
            ) : null}
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
            {isFormG && formG.data ? <FormGManualFigures overrides={overrides} onChange={setOverride} stmt={formG.data} /> : null}
          </>
        )}
      </PScroll>
    );
  }

  return (
    <Screen
      header={<FlatHeader back title={report?.title ?? "Report"} subtitle="Report details" />}
      floating={
        report ? (
          <FabMenu
            label="Export"
            actions={[
              { label: "Excel", icon: "download", onPress: onExport },
              { label: "PDF", icon: "download", onPress: onPrint },
            ]}
          />
        ) : undefined
      }
    >
      {!report ? <EmptyText>This report is not available.</EmptyText> : (
        <>
          {headExtra}
          <View style={{ flex: 1 }}>{body}</View>
        </>
      )}
    </Screen>
  );
}

const DEPOSIT_ROWS: [string, string, string][] = [
  ["Outstanding at beginning of period", "deposit_opening_count", "deposit_opening_amount"],
  ["Received during period", "deposit_during_count", "deposit_during_amount"],
  ["Repaid during period", "deposit_repaid_count", "deposit_repaid_amount"],
  ["Outstanding at end of period", "deposit_closing_count", "deposit_closing_amount"],
];

type FormGManualFiguresProps = { overrides: Record<string, string>; onChange: (key: string, value: string) => void; stmt: FormGStatement };

// Section 3 (deposits) and Section 4's assets / liabilities have no source ledger, so they are typed in here and
// sent with the export as overrides (web's gold-highlighted inputs); the excess lines recompute as you type.
function FormGManualFigures({ overrides, onChange, stmt }: FormGManualFiguresProps) {
  const assets = Number(overrides.assets_value) || 0;
  const liabilities = Number(overrides.liabilities_value) || 0;
  return (
    <Card style={{ marginHorizontal: 16, marginTop: 12, padding: 14 }}>
      <Txt style={{ fontWeight: "800", fontSize: 14 }}>Section 3 — Deposits received</Txt>
      <Txt style={{ fontSize: 11.5, color: C.muted, marginTop: 2, marginBottom: 8 }}>
        There is no deposit ledger to fill this from — enter figures if applicable; they apply to the exported file only.
      </Txt>
      {DEPOSIT_ROWS.map(([label, countKey, amountKey]) => (
        <View key={countKey} style={{ marginBottom: 6 }}>
          <Txt style={{ fontSize: 12.5, fontWeight: "600" }}>{label}</Txt>
          <View style={{ flexDirection: "row", gap: 8 }}>
            <Field label="Count" style={{ flex: 1 }}>
              <Input value={overrides[countKey] ?? ""} onChangeText={(v) => onChange(countKey, v.replace(/\D/g, ""))} keyboardType="number-pad" placeholder="0" />
            </Field>
            <Field label="Amount (Rs.)" style={{ flex: 1 }}>
              <Input value={overrides[amountKey] ?? ""} onChangeText={(v) => onChange(amountKey, v)} keyboardType="decimal-pad" placeholder="0" />
            </Field>
          </View>
        </View>
      ))}
      <Txt style={{ fontWeight: "800", fontSize: 14, marginTop: 8 }}>Section 4 — Financial position</Txt>
      <Txt style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>Maximum outstanding {inr(stmt.section4FinancialPosition.maxOutstanding)}</Txt>
      <Field label="Value of assets at end of period" style={{ marginTop: 6 }}>
        <Input value={overrides.assets_value ?? ""} onChangeText={(v) => onChange("assets_value", v)} keyboardType="decimal-pad" placeholder="0" />
      </Field>
      <Field label="Total liabilities at end of period">
        <Input value={overrides.liabilities_value ?? ""} onChangeText={(v) => onChange("liabilities_value", v)} keyboardType="decimal-pad" placeholder="0" />
      </Field>
      <Txt style={{ fontSize: 12.5, color: C.muted }}>Excess of assets over liabilities: <Txt style={{ fontWeight: "700", color: C.ink }}>{inr(Math.max(0, assets - liabilities))}</Txt></Txt>
      <Txt style={{ fontSize: 12.5, color: C.muted }}>Excess of liabilities over assets: <Txt style={{ fontWeight: "700", color: C.ink }}>{inr(Math.max(0, liabilities - assets))}</Txt></Txt>
      <Txt style={{ fontWeight: "800", fontSize: 14, marginTop: 12 }}>Declaration</Txt>
      <Txt style={{ fontSize: 12.5, color: C.muted, marginTop: 2 }}>
        I hereby declare that the information furnished in the above statement is true and correct to the best of my knowledge and belief. Place, date, name, signature and status are left blank in the export for manual completion.
      </Txt>
    </Card>
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
