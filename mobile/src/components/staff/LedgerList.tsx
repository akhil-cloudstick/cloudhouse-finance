import React, { useState } from "react";
import { View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { AccRow, C, DateField, FabCorner, ServerFlatList, Txt, openPage, toast, type AccDetail } from "../ui";
import { useServerList } from "../../hooks/useServerList";
import { getLedger, listExpenseCategoriesPage, LEDGER_MODES, PICKER_PAGE_SIZE, type LedgerKind, type LedgerRow } from "../../api/cash";
import { listLoansPage } from "../../api/loans";
import { dmy, inr } from "../../lib/format";
import { isUserCancel, userMessage } from "../../api/errors";
import { shareLedgerPdf } from "../../utils/ledgerExport";

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

/** Tappable ledger-link text for an AccRow detail value. */
export function LedgerLink({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Txt onPress={onPress} style={{ fontSize: 13, fontWeight: "600", color: C.brandDeep, textDecorationLine: "underline" }}>
      {label}
    </Txt>
  );
}

export const modeLink = (mode?: string) => (isMode(mode) ? <LedgerLink label={mode} onPress={() => openLedger("mode", mode, `${mode} Ledger`)} /> : mode || "—");

export const loanRefOf = (text?: string) => (text ? text.match(/^LN-\d+/i)?.[0] || text.match(/—\s*(LN-\S+)\s*$/i)?.[1] || null : null);

function LedgerRowItem({ r, index, kind, ledgerRef, categoryIds }: { r: LedgerRow; index: number; kind: LedgerKind; ledgerRef: string; categoryIds: Record<string, number> }) {
  const isDebit = r.debitOrCredit === "debit";
  const loanRef = loanRefOf(r.reference) || loanRefOf(r.description);
  const category = expenseCategoryOf(r.description);
  const categoryId = category ? categoryIds[category.toLowerCase()] : undefined;
  const sameBank = kind === "bank" && String(r.bankId) === ledgerRef;
  const sameCustomer = kind === "customer" && String(r.customerId) === ledgerRef;
  const sameMode = kind === "mode" && r.method === ledgerRef;

  const details: AccDetail[] = [
    { k: "Date", v: dmy(r.date) },
    { k: "Ref No", v: loanRef ? <LedgerLink label={r.reference || loanRef} onPress={() => openLoanByNumber(loanRef)} /> : r.reference || "—" },
    { k: "Mode", v: sameMode ? r.method : modeLink(r.method) },
    ...(r.bankId && !sameBank ? [{ k: "Bank", v: <LedgerLink label={r.bankName || "Bank"} onPress={() => openLedger("bank", r.bankId!, r.bankName || "Bank")} /> }] : []),
    ...(r.customerId && !sameCustomer ? [{ k: "Customer", v: <LedgerLink label={r.customerName || "Customer"} onPress={() => openLedger("customer", r.customerId!, r.customerName || "Customer")} /> }] : []),
    ...(categoryId && kind !== "category" ? [{ k: "Category", v: <LedgerLink label={category!} onPress={() => openLedger("category", categoryId, category!)} /> }] : []),
    { k: "Debit", v: isDebit ? inr(r.amount) : "—", color: isDebit ? C.red : C.muted },
    { k: "Credit", v: isDebit ? "—" : inr(r.amount), color: isDebit ? C.muted : C.green },
    { k: "Balance", v: inr(r.runningBalance), color: C.brandDeep },
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

/** Paged ledger with a From/To date filter. `top` renders above the filter
 * (e.g. the customer detail's tabs). onCategoryName reports the category
 * ledger's resolved name for the screen title. */
export function LedgerList({ kind, ledgerRef, top, onCategoryName }: { kind: LedgerKind; ledgerRef: string; top?: React.ReactElement; onCategoryName?: (name: string) => void }) {
  const [fromDate, setFromDate] = useState<string | undefined>();
  const [toDate, setToDate] = useState<string | undefined>();
  const categoryIds = useExpenseCategoryIds();
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
      await shareLedgerPdf(kind, ledgerRef, { fromDate, toDate }, "Ledger");
    } catch (e) {
      if (isUserCancel(e)) return;
      toast.error("Download failed", userMessage(e, "Could not download the ledger — try again."));
    } finally {
      setExporting(false);
    }
  }
  const list = useServerList<LedgerRow>({
    key: ["ledger", kind, ledgerRef, fromDate, toDate],
    fetchPage: (p) =>
      getLedger(kind, ledgerRef, { limit: p.limit, offset: p.offset, fromDate, toDate }).then((r) => {
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
      keyOf={(r) => `${r.type}-${r.id}`}
      emptyText="No transactions found."
      header={
        <>
          {top}
          <View style={{ flexDirection: "row", gap: 10, paddingHorizontal: 18, paddingTop: 12 }}>
            <View style={{ flex: 1 }}>
              <DateField label="From" value={fromDate} onChange={setFromDate} max={toDate} clearable />
            </View>
            <View style={{ flex: 1 }}>
              <DateField label="To" value={toDate} onChange={setToDate} min={fromDate} clearable />
            </View>
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
    {/* Floating corner button, same as the Customers page's Register button.
        Rendered here (not via Screen's `floating`) so every screen hosting
        this list gets it; the list's body view ends where the screen does,
        so it lands in the same spot. */}
    {list.items.length > 0 ? <FabCorner icon="download" label="Download ledger PDF" onPress={onDownload} /> : null}
    </>
  );
}
