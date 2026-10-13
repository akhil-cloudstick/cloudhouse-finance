import React, { useEffect, useState } from "react";
import { View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { AccRow, C, GroupedFilter, PillButton, ServerFlatList, Txt, emptyGroupedFilter, gfDate, gfFirst, gfValues, openPage, toast, type AccDetail, type GFSection, type GroupedFilterValue } from "@/common/components/ui";
import { useServerList } from "@/common/hooks/use-server-list";
import { listBranchesPage } from "@/modules/branches/services/branchService";
import { listBanksPage } from "@/modules/banks/services/bankService";
import { getLedger, getModeLedger, listExpenseCategoriesPage, LEDGER_MODES, PICKER_PAGE_SIZE } from "@/modules/cash/services/cashService";
import { type LedgerKind, type LedgerRow } from "@/modules/cash/types/cash-types";
import { listLoansPage } from "@/modules/loans/services/loanService";
import { BillSheet } from "./BillSheet";
import { dmy, inr } from "@/common/utils/format";
import { isUserCancel, userMessage } from "@/common/services/apiErrors";
import { shareLedgerPdf } from "@/common/utils/ledgerExport";
import { useAuth } from "@/common/providers/AuthProvider";
import { LedgerLink } from "./LedgerLink";
import { EntrySub, useEntryActions } from "@/modules/cash/components/EntryActions";

// Mobile counterpart of the web ledger drill-downs (PartyLedger.tsx,
// ModeLedgerPage.tsx): every bank / customer / payment mode / expense
// category has its own ledger, and each row links on to the others it
// touches — one shared screen, app/(tabs)/cash/[id].tsx, keyed by kind.

/** The transaction a ledger link was followed from — the ledger it opens scrolls to and highlights the same one. */
export type LedgerFocus = { date: string; amount: number };

/** Open a ledger. `ref` is the bank/customer/category id, or the mode name. `focus` is the transaction the link
 * was tapped on, so the ledger opens on the page holding it. */
export function openLedger(kind: LedgerKind, ref: string | number, label: string, focus?: LedgerFocus) {
  const f = focus ? `&focusDate=${encodeURIComponent(focus.date.slice(0, 10))}&focusAmount=${encodeURIComponent(String(focus.amount))}` : "";
  openPage(`/cash/${kind}?ref=${encodeURIComponent(String(ref))}&label=${encodeURIComponent(label)}${f}`);
}

const isMode = (m?: string): m is string => !!m && (LEDGER_MODES as readonly string[]).includes(m);

/** A gold-loan number opens that loan's detail — mobile routes loans by id,
 * so it's resolved with a search first. */
export async function openLoanByNumber(loanNumber: string) {
  const res = await listLoansPage({ q: loanNumber, limit: 5, offset: 0 });
  const loan = res.items.find((l) => l.loanNumber.toLowerCase() === loanNumber.toLowerCase());
  if (loan) openPage(`/loans/${loan.id}`);
}

const EXPENSE_PREFIX = "Expense — ";

/** The category inside an approved expense's ledger text ("Expense — Rent"). */
export function expenseCategoryOf(text?: string): string | null {
  return text && text.startsWith(EXPENSE_PREFIX) ? text.slice(EXPENSE_PREFIX.length).trim() : null;
}

/** Query key of the category name -> id map below — invalidate it when a
 * category is created, or a new category has no ledger link until it's
 * refetched. */
export const EXPENSE_CATEGORY_IDS_KEY = ["expense-category-ids"];

/** Lower-cased category name -> id (Expense.category is free text server side). */
export function useExpenseCategoryIds(): Record<string, number> {
  const q = useQuery({
    queryKey: EXPENSE_CATEGORY_IDS_KEY,
    queryFn: async () => {
      const map: Record<string, number> = {};
      for (let page = 0; ; page++) {
        const res = await listExpenseCategoriesPage("", page, PICKER_PAGE_SIZE);
        for (const c of res.items) map[c.name.toLowerCase()] = c.id;
        if (!res.hasMore) break;
      }
      return map;
    },
    staleTime: 5 * 60_000,
  });
  return q.data ?? {};
}

/** An in-row hyperlink. `to` is the page it opens ("/cash", "/loans"): when
 * the user can't open that page it renders as plain text. */
// A ledger entry's bill — opens the uploaded image (server-root-relative URL).
export function billDetail(receiptImage?: string): { k: string; v: React.ReactNode }[] {
  if (!receiptImage) return [];
  return [{ k: "Bill", v: <BillLink path={receiptImage} /> }];
}

type BillLinkProps = { path: string };

// Opens the bill in an in-app sheet that sends the session token (the server
// only serves /uploads/* to a signed-in caller) and falls back cleanly.
function BillLink({ path }: BillLinkProps) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <LedgerLink label="View bill" to="/cash" onPress={() => setOpen(true)} />
      <BillSheet path={open ? path : null} onClose={() => setOpen(false)} />
    </>
  );
}

export const modeLink = (mode?: string, focus?: LedgerFocus) => (isMode(mode) ? <LedgerLink label={mode} to="/cash" onPress={() => openLedger("mode", mode, `${mode} Ledger`, focus)} /> : mode || "—");

export const loanRefOf = (text?: string) => (text ? text.match(/^LN-\d+/i)?.[0] || text.match(/—\s*(LN-\S+)\s*$/i)?.[1] || null : null);

type LedgerRowItemProps = { r: LedgerRow; index: number; kind: LedgerKind; ledgerRef: string; categoryIds: Record<string, number>; highlight?: boolean };

function LedgerRowItem({ r, index, kind, ledgerRef, categoryIds, highlight }: LedgerRowItemProps) {
  // Links on this row open the other ledgers on this same transaction.
  const focus: LedgerFocus = { date: r.date, amount: r.amount };
  const isDebit = r.debitOrCredit === "debit";
  // A cash-in / debit / self transfer a person keyed in: info icon + Edit.
  const entry = useEntryActions(r.entryId, r.editable);
  const loanRef = loanRefOf(r.reference) || loanRefOf(r.description);
  const category = expenseCategoryOf(r.description);
  const categoryId = category ? categoryIds[category.toLowerCase()] : undefined;
  const sameBank = kind === "bank" && String(r.bankId) === ledgerRef;
  const sameCustomer = kind === "customer" && String(r.customerId) === ledgerRef;
  const sameMode = kind === "mode" && r.method === ledgerRef;

  const details: AccDetail[] = [
    { k: "Date", v: dmy(r.date) },
    { k: "Ref No", v: loanRef ? <LedgerLink label={r.reference || loanRef} to="/loans" onPress={() => openLoanByNumber(loanRef)} /> : r.reference || "—" },
    { k: "Mode", v: sameMode ? r.method : modeLink(r.method, focus) },
    ...(r.bankId && !sameBank ? [{ k: "Bank", v: <LedgerLink label={r.bankName || "Bank"} to="/cash" onPress={() => openLedger("bank", r.bankId!, r.bankName || "Bank", focus)} /> }] : []),
    ...(r.customerId && !sameCustomer ? [{ k: "Customer", v: <LedgerLink label={r.customerName || "Customer"} to="/cash" onPress={() => openLedger("customer", r.customerId!, r.customerName || "Customer", focus)} /> }] : []),
    ...(categoryId && kind !== "category" ? [{ k: "Category", v: <LedgerLink label={category!} to="/cash" onPress={() => openLedger("category", categoryId, category!, focus)} /> }] : []),
    { k: "Debit", v: isDebit ? inr(r.amount) : "—", color: isDebit ? C.red : C.muted },
    { k: "Credit", v: isDebit ? "—" : inr(r.amount), color: isDebit ? C.muted : C.green },
    { k: "Balance", v: inr(r.runningBalance), color: C.brandDeep },
    ...billDetail(r.receiptImage),
  ];
  const subText = r.reference || r.method || undefined;
  return (
    <>
      <AccRow
        defaultOpen={index === 0}
        id={dmy(r.date)}
        name={r.description || r.type}
        sub={entry.infoButton ? <EntrySub text={subText} infoButton={entry.infoButton} /> : subText}
        amount={inr(r.amount)}
        amountColor={isDebit ? C.red : C.green}
        status={isDebit ? "Debit" : "Credit"}
        statusTone={isDebit ? "overdue" : "active"}
        details={details}
        actions={entry.actions}
        style={highlight ? { borderColor: C.brandDeep, borderWidth: 2, backgroundColor: "#f3f3ff" } : undefined}
      />
      {entry.sheets}
    </>
  );
}

type LedgerListProps = { kind: LedgerKind; ledgerRef: string; top?: React.ReactElement; onCategoryName?: (name: string) => void; focus?: LedgerFocus };

// Most rows loaded while looking for the focused transaction.
const FOCUS_MAX_ROWS = 600;

const sameAmount = (a: number, b: number) => Math.abs(a - b) < 0.005;

/** Paged ledger with a From/To date filter. `top` renders above the filter
 * (e.g. the customer detail's tabs). onCategoryName reports the category
 * ledger's resolved name for the screen title. */
export function LedgerList({ kind, ledgerRef, top, onCategoryName, focus }: LedgerListProps) {
  // One grouped filter: Mode (bank ledger only), Branch + Bank (mode ledgers;
  // Cash has no bank of record), and Date — like web's PartyLedger / ModeLedgerPage.
  const [fv, setFv] = useState<GroupedFilterValue>(emptyGroupedFilter());
  const fromDate = gfDate(fv, "date").from;
  const toDate = gfDate(fv, "date").to;
  // Several (or no) modes on a bank ledger fall back to its combined view.
  const modeValues = gfValues(fv, "mode");
  const singleMode = kind === "bank" && modeValues.length === 1 ? modeValues[0] : undefined;
  const branchCsv = kind === "mode" ? gfValues(fv, "branch").join(",") || undefined : undefined;
  const modeBankId = kind === "mode" && gfFirst(fv, "bank") ? Number(gfFirst(fv, "bank")) : undefined;
  const sections: GFSection[] = [
    ...(kind === "bank" ? [{ kind: "static" as const, key: "mode", label: "Mode", options: LEDGER_MODES.map((m) => ({ value: m, label: m })) }] : []),
    ...(kind === "mode"
      ? [
          {
            kind: "async" as const,
            key: "branch",
            label: "Branch",
            fetchPage: (p: { q?: string; limit: number; offset: number }) =>
              listBranchesPage({ q: p.q, limit: p.limit, offset: p.offset }).then((r) => ({ items: r.items.map((b) => ({ value: String(b.id), label: b.name })), hasMore: r.hasMore })),
          },
          ...(ledgerRef !== "Cash"
            ? [
                {
                  kind: "async" as const,
                  key: "bank",
                  label: "Bank",
                  single: true,
                  fetchPage: (p: { q?: string; limit: number; offset: number }) =>
                    listBanksPage({ q: p.q, limit: p.limit, offset: p.offset }).then((r) => ({ items: r.items.map((b) => ({ value: String(b.id), label: b.branch ? `${b.name} — ${b.branch}` : b.name })), hasMore: r.hasMore })),
                },
              ]
            : []),
        ]
      : []),
    { kind: "date" as const, key: "date", label: "Date" },
  ];
  const categoryIds = useExpenseCategoryIds();
  const canExport = useAuth().can("Ledger_Export", "can_export_ledger");
  // Server-side sums over every row matching the date filter, not just the
  // pages loaded so far.
  const [totals, setTotals] = useState<{ debit: number; credit: number } | null>(null);
  const [exporting, setExporting] = useState(false);

  // PDF of every row matching the date filter, like the web ledgers' Download.
  async function onDownload() {
    if (exporting) return;
    setExporting(true);
    toast.info("Preparing PDF", "The ledger will open in the share sheet.");
    try {
      if (singleMode) await shareLedgerPdf("mode", singleMode, { fromDate, toDate }, "Ledger", { bankId: Number(ledgerRef) });
      else await shareLedgerPdf(kind, ledgerRef, { fromDate, toDate }, "Ledger", { bankId: modeBankId, branchIds: branchCsv });
    } catch (e) {
      if (isUserCancel(e)) return;
      toast.error("Download failed", userMessage(e, "Could not download the ledger — try again."));
    } finally {
      setExporting(false);
    }
  }
  const list = useServerList<LedgerRow>({
    key: ["ledger", kind, ledgerRef, fromDate, toDate, singleMode, branchCsv, modeBankId],
    fetchPage: (p) =>
      (singleMode
        ? getModeLedger(singleMode, { limit: p.limit, offset: p.offset, fromDate, toDate, bankId: Number(ledgerRef) })
        : kind === "mode"
          ? getModeLedger(ledgerRef, { limit: p.limit, offset: p.offset, fromDate, toDate, bankId: modeBankId, branchIds: branchCsv })
          : getLedger(kind, ledgerRef, { limit: p.limit, offset: p.offset, fromDate, toDate })
      ).then((r) => {
        if (r.categoryName) onCategoryName?.(r.categoryName);
        setTotals({ debit: r.totalDebit ?? 0, credit: r.totalCredit ?? 0 });
        return { items: r.items ?? [], hasMore: p.offset + p.limit < r.total, total: r.total };
      }),
    fresh: true,
  });

  // Opened from another ledger on a transaction: keep loading pages until it shows up, then scroll to it and
  // highlight it for a few seconds.
  const focusIndex = focus
    ? (() => {
        const day = list.items.findIndex((r) => r.date.slice(0, 10) === focus.date.slice(0, 10) && sameAmount(r.amount, focus.amount));
        return day >= 0 ? day : list.items.findIndex((r) => sameAmount(r.amount, focus.amount));
      })()
    : -1;
  const [highlighted, setHighlighted] = useState(false);
  useEffect(() => {
    if (!focus || focusIndex >= 0 || list.isLoading || list.isFetchingNextPage || !list.hasNextPage || list.items.length >= FOCUS_MAX_ROWS) return;
    list.fetchNextPage();
  }, [focus, focusIndex, list.isLoading, list.isFetchingNextPage, list.hasNextPage, list.items.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const found = focusIndex >= 0;
  useEffect(() => {
    if (!found) return;
    setHighlighted(true);
    const t = setTimeout(() => setHighlighted(false), 10000);
    return () => clearTimeout(t);
  }, [found]);

  return (
    <>
    <ServerFlatList
      list={list}
      items={list.items}
      focusIndex={focusIndex}
      keyOf={(r) => `${r.type}-${r.id}-${r.method}`}
      emptyText="No transactions found."
      header={
        <>
          {top}
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap", paddingHorizontal: 18, paddingTop: 12 }}>
            <GroupedFilter title="Filter ledger" sections={sections} value={fv} onChange={setFv} />
            <View style={{ flex: 1 }} />
            {canExport ? <PillButton label={exporting ? "Preparing…" : "Download"} onPress={onDownload} /> : null}
          </View>
          {totals ? (
            <View style={{ flexDirection: "row", justifyContent: "space-between", marginHorizontal: 18, marginTop: 10, marginBottom: 14, paddingVertical: 10, paddingHorizontal: 12, borderRadius: 10, backgroundColor: C.card, borderWidth: 1, borderColor: C.line }}>
              <Txt style={{ fontSize: 12.5, color: C.muted }}>
                Total Debit <Txt style={{ fontWeight: "700", color: C.red }}>{inr(totals.debit)}</Txt>
              </Txt>
              <Txt style={{ fontSize: 12.5, color: C.muted }}>
                Total Credit <Txt style={{ fontWeight: "700", color: C.green }}>{inr(totals.credit)}</Txt>
              </Txt>
            </View>
          ) : null}
        </>
      }
      renderItem={(r, i) => <LedgerRowItem r={r} index={i} kind={kind} ledgerRef={ledgerRef} categoryIds={categoryIds} highlight={highlighted && i === focusIndex} />}
    />
    </>
  );
}
