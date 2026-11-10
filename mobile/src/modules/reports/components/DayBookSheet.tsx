import { useEffect, useMemo, useState } from "react";
import { View } from "react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import * as Print from "expo-print";
import * as Sharing from "expo-sharing";
import {
  AccBtn,
  AccRow,
  Buffering,
  C,
  Card,
  ConfirmSheet,
  EmptyText,
  ExportMenu,
  GroupedFilter,
  PillButton,
  Sheet,
  Txt,
  emptyGroupedFilter,
  gfDate,
  gfFirst,
  toast,
  type GFSection,
  type GroupedFilterValue,
} from "@/common/components/ui";
import { SheetScrollView } from "@/common/components/ui/SheetScrollView";
import { useShowBranchFilter } from "@/common/hooks/use-branch-switch";
import { isUserCancel, userMessage } from "@/common/services/apiErrors";
import { dmy, inr, todayISO } from "@/common/utils/format";
import { listBranchesPage } from "@/modules/branches/services/branchService";
import { DayBookEntrySheet } from "@/modules/reports/components/DayBookEntrySheet";
import { downloadExport } from "@/modules/reports/services/reportDownload";
import { deleteDayBookEntry, getDayBook } from "@/modules/reports/services/reportsService";
import { type DayBookRow } from "@/modules/reports/types/reports-types";

// Day Book — the lines staff record by hand (Date, Particulars, Debit, Credit, Interest), oldest
// first, with the period's totals. Opens on the current month; Date and Branch filters; add, edit
// and delete here; the same lines download as Excel or print as PDF.

const PAGE = 20;
const firstOfMonth = () => `${todayISO().slice(0, 8)}01`;

type DayBookSheetProps = { visible: boolean; onClose: () => void };

export function DayBookSheet({ visible, onClose }: DayBookSheetProps) {
  const qc = useQueryClient();
  const showBranchFilter = useShowBranchFilter();
  const [fv, setFv] = useState<GroupedFilterValue>(emptyGroupedFilter());
  const from = gfDate(fv, "date").from ?? "";
  const to = gfDate(fv, "date").to ?? "";
  const branchId = gfFirst(fv, "branch") || undefined;
  const [shown, setShown] = useState(PAGE);
  const [editing, setEditing] = useState<DayBookRow | null>(null);
  const [adding, setAdding] = useState(false);
  const [deleting, setDeleting] = useState<DayBookRow | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [printing, setPrinting] = useState(false);

  // Each opening starts on the current month.
  useEffect(() => {
    if (visible) setFv({ options: {}, dates: { date: { from: firstOfMonth(), to: todayISO() } } });
  }, [visible]);
  // Back to the first page whenever the filters change.
  useEffect(() => setShown(PAGE), [from, to, branchId]);

  const filters = { from: from || undefined, to: to || undefined, branchId };
  const book = useQuery({
    queryKey: ["reports", "day-book", from, to, branchId],
    queryFn: () => getDayBook(filters),
    enabled: visible,
  });
  const rows = useMemo(() => book.data?.rows ?? [], [book.data]);
  const totals = book.data?.totals;

  async function onExport() {
    setExporting(true);
    try {
      const uri = await downloadExport("day-book", "xlsx", filters);
      if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(uri, { mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", dialogTitle: "Day Book export" });
      else toast.info("Saved", `Saved to ${uri} — sharing isn't available on this device.`);
    } catch (e) {
      if (!isUserCancel(e)) toast.error("Export failed", userMessage(e, "Could not export — try again."));
    } finally {
      setExporting(false);
    }
  }
  async function onPrint() {
    setPrinting(true);
    try {
      await Print.printAsync({ uri: await downloadExport("day-book", "pdf", filters) });
    } catch (e) {
      if (!isUserCancel(e)) toast.error("Print failed", userMessage(e, "Could not print — try again."));
    } finally {
      setPrinting(false);
    }
  }
  async function confirmDelete() {
    if (!deleting) return;
    setDeleteBusy(true);
    setDeleteError(null);
    try {
      await deleteDayBookEntry(deleting.id);
      qc.invalidateQueries({ queryKey: ["reports", "day-book"] });
      setDeleting(null);
      toast.success("Entry deleted");
    } catch (e) {
      setDeleteError(userMessage(e, "Could not delete the entry — try again."));
    } finally {
      setDeleteBusy(false);
    }
  }

  const sections: GFSection[] = [
    ...(!showBranchFilter ? [] : [{
      kind: "async" as const,
      key: "branch",
      label: "Branch",
      single: true,
      fetchPage: (p: { q?: string; limit: number; offset: number }) => listBranchesPage({ q: p.q, limit: p.limit, offset: p.offset }).then((r) => ({ items: r.items.map((b) => ({ value: String(b.id), label: b.name })), hasMore: r.hasMore })),
    }]),
    { kind: "date", key: "date", label: "Date" },
  ];
  // Wraps on a narrow phone instead of squeezing the buttons.
  const headExtra = (
    <View style={{ paddingTop: 12, paddingBottom: 10, paddingHorizontal: 16, flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
      <GroupedFilter title="Filter day book" sections={sections} value={fv} onChange={setFv} />
      <View style={{ flex: 1 }} />
      <PillButton label="+ Add Entry" onPress={() => setAdding(true)} />
      <ExportMenu busy={exporting || printing} onExcel={onExport} onPdf={onPrint} />
    </View>
  );

  const stats = totals
    ? ([["Debit", totals.debit, C.red], ["Credit", totals.credit, C.green], ["Interest", totals.interest, C.ink]] as const)
    : [];
  return (
    <>
      <Sheet visible={visible} onClose={onClose} title="Day Book" maxHeightPct={88} scroll={false} headExtra={headExtra}>
        <View style={{ flexShrink: 1, minHeight: 320 }}>
          <SheetScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 16 }}>
            {book.isLoading ? (
              <Buffering block />
            ) : book.isError ? (
              <EmptyText>Couldn&apos;t load the day book.</EmptyText>
            ) : (
              <>
                {totals ? (
                  <Card style={{ marginHorizontal: 16, marginBottom: 12, padding: 14 }}>
                    <View style={{ flexDirection: "row", gap: 8 }}>
                      {stats.map(([k, v, color]) => (
                        <View key={k} style={{ flex: 1, minWidth: 0 }}>
                          <Txt style={{ fontSize: 10.5, fontWeight: "700", color: C.muted, textTransform: "uppercase" }}>{k}</Txt>
                          <Txt style={{ fontSize: 14.5, fontWeight: "800", color, marginTop: 2 }} numberOfLines={1} adjustsFontSizeToFit>{inr(v)}</Txt>
                        </View>
                      ))}
                    </View>
                  </Card>
                ) : null}
                {rows.length === 0 ? (
                  <EmptyText>No entries in this period — tap Add Entry to record one.</EmptyText>
                ) : (
                  <View style={{ paddingHorizontal: 16 }}>
                    {rows.slice(0, shown).map((r) => (
                      <AccRow
                        key={r.id}
                        id={dmy(r.date)}
                        name={r.particulars}
                        amount={r.debit ? inr(r.debit) : r.credit ? inr(r.credit) : r.interest ? inr(r.interest) : undefined}
                        amountColor={r.debit ? C.red : r.credit ? C.green : undefined}
                        details={[
                          { k: "Debit", v: r.debit ? inr(r.debit) : "—", color: r.debit ? C.red : undefined },
                          { k: "Credit", v: r.credit ? inr(r.credit) : "—", color: r.credit ? C.green : undefined },
                          { k: "Interest", v: r.interest ? inr(r.interest) : "—" },
                        ]}
                        actions={[
                          { label: "Edit", primary: true, onPress: () => setEditing(r) },
                          { label: "Delete", danger: true, onPress: () => { setDeleteError(null); setDeleting(r); } },
                        ]}
                      />
                    ))}
                    {rows.length > shown ? <AccBtn label={`Load more (${rows.length - shown} left)`} onPress={() => setShown((n) => n + PAGE)} /> : null}
                  </View>
                )}
              </>
            )}
          </SheetScrollView>
        </View>
      </Sheet>
      <DayBookEntrySheet visible={adding || !!editing} entry={editing} onClose={() => { setAdding(false); setEditing(null); }} />
      <ConfirmSheet
        visible={!!deleting}
        onClose={() => setDeleting(null)}
        title="Delete Day Book Entry"
        message={deleting ? `Delete "${deleting.particulars}" dated ${dmy(deleting.date)}?` : ""}
        confirmLabel="Delete"
        danger
        loading={deleteBusy}
        error={deleteError}
        onConfirm={confirmDelete}
      />
    </>
  );
}
