import React, { useState } from "react";
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

// Mobile counterpart of the web ledger drill-downs (PartyLedger.tsx,
// ModeLedgerPage.tsx): every bank / customer / payment mode / expense
// category has its own ledger, and each row links on to the others it
// touches — one shared screen, app/(tabs)/cash/[id].tsx, keyed by kind.

/** Open a ledger. `ref` is the bank/customer/category id, or the mode name. */
export function openLedger(kind: LedgerKind, ref: string | number, label: string) {
  openPage(`/cash/${kind}?ref=${encodeURIComponent(String(ref))}&label=${encodeURIComponent(label)}`);
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

export const modeLink = (mode?: string) => (isMode(mode) ? <LedgerLink label={mode} to="/cash" onPress={() => openLedger("mode", mode, `${mode} Ledger`)} /> : mode || "—");

export const loanRefOf = (text?: string) => (text ? text.match(/^LN-\d+/i)?.[0] || text.match(/—\s*(LN-\S+)\s*$/i)?.[1] || null : null);

type LedgerRowItemProps = { r: LedgerRow; index: number; kind: LedgerKind; ledgerRef: string; categoryIds: Record<string, number> };

function LedgerRowItem({ r, index, kind, ledgerRef, categoryIds }: LedgerRowItemProps) {
  const isDebit = r.debitOrCredit === "debit";
  const loanRef = loanRefOf(r.reference) || loanRefOf(r.description);
  const category = expenseCategoryOf(r.description);
  const categoryId = category ? categoryIds[category.toLowerCase()] : undefined;
  const sameBank = kind === "bank" && String(r.bankId) === ledgerRef;
  const sameCustomer = kind === "customer" && String(r.customerId) === ledgerRef;
  const sameMode = kind === "mode" && r.method === ledgerRef;

  const details: AccDetail[] = [
    { k: "Date", v: dmy(r.date) },
    { k: "Ref No", v: loanRef ? <LedgerLink label={r.reference || loanRef} to="/loans" onPress={() => openLoanByNumber(loanRef)} /> : r.reference || "—" },
    { k: "Mode", v: sameMode ? r.method : modeLink(r.method) },
    ...(r.bankId && !sameBank ? [{ k: "Bank", v: <LedgerLink label={r.bankName || "Bank"} to="/cash" onPress={() => openLedger("bank", r.bankId!, r.bankName || "Bank")} /> }] : []),
    ...(r.customerId && !sameCustomer ? [{ k: "Customer", v: <LedgerLink label={r.customerName || "Customer"} to="/cash" onPress={() => openLedger("customer", r.customerId!, r.customerName || "Customer")} /> }] : []),
    ...(categoryId && kind !== "category" ? [{ k: "Category", v: <LedgerLink label={category!} to="/cash" onPress={() => openLedger("category", categoryId, category!)} /> }] : []),
    { k: "Debit", v: isDebit ? inr(r.amount) : "—", color: isDebit ? C.red : C.muted },
    { k: "Credit", v: isDebit ? "—" : inr(r.amount), color: isDebit ? C.muted : C.green },
    { k: "Balance", v: inr(r.runningBalance), color: C.brandDeep },
    ...billDetail(r.receiptImage),
  ];
  return (
    <AccRow
      defaultOpen={index === 0}
      id={dmy(r.date)}
      name={r.description || r.type}
      sub={r.reference || r.method || undefined}
      amount={inr(r.amount)}
      amountColor={isDebit ? C.red : C.green}
      status={isDebit ? "Debit" : "Credit"}
      statusTone={isDebit ? "overdue" : "active"}
      details={details}
    />
  );
}

type LedgerListProps = { kind: LedgerKind; ledgerRef: string; top?: React.ReactElement; onCategoryName?: (name: string) => void };

/** Paged ledger with a From/To date filter. `top` renders above the filter
 * (e.g. the customer detail's tabs). onCategoryName reports the category
 * ledger's resolved name for the screen title. */
export function LedgerList({ kind, ledgerRef, top, onCategoryName }: LedgerListProps) {
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

  return (
    <>
    <ServerFlatList
      list={list}
      items={list.items}
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
      renderItem={(r, i) => <LedgerRowItem r={r} index={i} kind={kind} ledgerRef={ledgerRef} categoryIds={categoryIds} />}
    />
    </>
  );
}
