import { useShowBranchFilter } from "@/common/hooks/use-branch-switch";
import { MOVEMENT_TYPE_OPTIONS } from "@/common/components/movementLedger";
import React, { useEffect, useState } from "react";
import { Pressable, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { AccRow, C, GroupedFilter, PIcon, PillButton, ServerFlatList, Txt, emptyGroupedFilter, gfDate, gfFirst, gfValues, openPage, toast, type AccDetail, type GFSection, type GroupedFilterValue } from "@/common/components/ui";
import { useServerList } from "@/common/hooks/use-server-list";
import { listBranchesPage } from "@/modules/branches/services/branchService";
import { listBanksPage } from "@/modules/banks/services/bankService";
import { getLedger, getModeLedger, listExpenseCategoriesPage, LEDGER_MODES, PICKER_PAGE_SIZE } from "@/modules/cash/services/cashService";
import { type LedgerKind, type LedgerRow, type LoanLedgerSummary } from "@/modules/cash/types/cash-types";
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

// Lower-cased loan-source name -> its bank loan number (filled by the load below), like web's loanNumberOfCategory.
const loanNumberByCategory: Record<string, string> = {};
const loanNumberOfCategory = (name: string) => loanNumberByCategory[name.trim().toLowerCase()] || "";
// A name starting with "Loan" is one bank loan (same rule as web's isLoanSource).
const isLoanSource = (name: string) => name.trim().toLowerCase().startsWith("loan");
const SELF_TRANSFER_PREFIX = "Self transfer — ";

/** Lower-cased category name -> id (Expense.category is free text server side). */
export function useExpenseCategoryIds(): Record<string, number> {
  const q = useQuery({
    queryKey: EXPENSE_CATEGORY_IDS_KEY,
    queryFn: async () => {
      const map: Record<string, number> = {};
      for (let page = 0; ; page++) {
        const res = await listExpenseCategoriesPage("", page, PICKER_PAGE_SIZE);
        for (const c of res.items) {
          map[c.name.toLowerCase()] = c.id;
          const n = (c as { loanNumber?: string }).loanNumber;
          if (n) loanNumberByCategory[c.name.trim().toLowerCase()] = n;
        }
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

type BillLinkProps = { path: string; label?: string; /** Title of the viewer sheet — the name of the thing being viewed (default "Bill"). */ title?: string; /** Show an eye icon (accessibilityLabel "View document") instead of the text link. */ icon?: boolean };

// Opens the bill in an in-app sheet that sends the session token (the server
// only serves /uploads/* to a signed-in caller) and falls back cleanly.
export function BillLink({ path, label = "View bill", title, icon }: BillLinkProps) {
  const [open, setOpen] = useState(false);
  return (
    <>
      {icon ? (
        <Pressable onPress={() => setOpen(true)} hitSlop={8} accessibilityRole="button" accessibilityLabel={title ? `View ${title}` : "View document"}>
          <PIcon name="eye" color={C.brandDeep} size={20} />
        </Pressable>
      ) : (
        <LedgerLink label={label} to="/cash" onPress={() => setOpen(true)} />
      )}
      <BillSheet path={open ? path : null} title={title} onClose={() => setOpen(false)} />
    </>
  );
}

export const modeLink = (mode?: string, focus?: LedgerFocus) => (isMode(mode) ? <LedgerLink label={mode} to="/cash" onPress={() => openLedger("mode", mode, `${mode} Ledger`, focus)} /> : mode || "—");

export const loanRefOf = (text?: string) => (text ? text.match(/^LN-\d+/i)?.[0] || text.match(/—\s*(LN-\S+)\s*$/i)?.[1] || null : null);

// An investment (INV-…) or personal-loan (PL-…) number, bare or at the end of a description ("… — INV-00003").
const prefixedRefOf = (prefix: "INV" | "PL", text?: string) =>
  text ? text.match(new RegExp(`^${prefix}-\\d+`, "i"))?.[0] || text.match(new RegExp(`—\\s*(${prefix}-\\S+)\\s*$`, "i"))?.[1] || null : null;

/** Ref No for a row with no loan / investment / personal-loan number — same cases as web's loanCatRef: a repayment
 * booked on a bank loan, a self transfer to one, or a loan-source row, each linking to that loan's own ledger. */
function categoryRefOf(r: LedgerRow, categoryIds: Record<string, number>, focus: LedgerFocus): React.ReactNode {
  const link = (id: number, label: string) => <LedgerLink label={label} to="/cash" onPress={() => openLedger("category", id, label, focus)} />;
  const expenseCat = expenseCategoryOf(r.description);
  if (expenseCat && isLoanSource(expenseCat)) {
    const id = categoryIds[expenseCat.toLowerCase()];
    const number = loanNumberOfCategory(expenseCat) || expenseCat;
    return id ? link(id, number) : number;
  }
  if (r.type === "Self Transfer") {
    const cat = r.description.startsWith(SELF_TRANSFER_PREFIX) ? r.description.slice(SELF_TRANSFER_PREFIX.length).trim() : "";
    const id = cat && isLoanSource(cat) ? categoryIds[cat.toLowerCase()] : undefined;
    return id ? link(id, loanNumberOfCategory(cat) || cat) : "—";
  }
  const id = r.type && isLoanSource(r.type) ? categoryIds[r.type.toLowerCase()] : undefined;
  return id && r.reference ? link(id, r.reference) : r.reference || "—";
}

type LedgerRowItemProps ={ r: LedgerRow; index: number; kind: LedgerKind; ledgerRef: string; categoryIds: Record<string, number>; highlight?: boolean };

function LedgerRowItem({ r, index, kind, ledgerRef, categoryIds, highlight }: LedgerRowItemProps) {
  // Links on this row open the other ledgers on this same transaction.
  const focus: LedgerFocus = { date: r.date, amount: r.amount };
  const isDebit = r.debitOrCredit === "debit";
  // A cash-in / debit / self transfer a person keyed in: info icon + Edit.
  // Every row gets the info icon; rows with no cash movement behind them open a popup built from the row itself.
  const entry = useEntryActions(r.entryId, r.editable, r);
  const loanRef = loanRefOf(r.reference) || loanRefOf(r.description);
  const invRef = prefixedRefOf("INV", r.reference) || prefixedRefOf("INV", r.description);
  const plRef = prefixedRefOf("PL", r.reference) || prefixedRefOf("PL", r.description);
  const category = expenseCategoryOf(r.description);
  const categoryId = category ? categoryIds[category.toLowerCase()] : undefined;
  const sameBank = kind === "bank" && String(r.bankId) === ledgerRef;
  const sameCustomer = kind === "customer" && String(r.customerId) === ledgerRef;
  const sameMode = kind === "mode" && r.method === ledgerRef;

  // A memo row records how money was applied (an auction applied to a loan), not money moving — greyed like web.
  const memo = !!r.memo;
  // Mobile has no per-record page for these two, so the link opens their list.
  const refCell = loanRef ? <LedgerLink label={r.reference || loanRef} to="/loans" onPress={() => openLoanByNumber(loanRef)} />
    : invRef ? <LedgerLink label={invRef} to="/investments" onPress={() => openPage("/investments")} />
    : plRef ? <LedgerLink label={plRef} to="/personal-loans" onPress={() => openPage("/personal-loans")} />
    : categoryRefOf(r, categoryIds, focus);

  const details: AccDetail[] = [
    { k: "Date", v: dmy(r.date) },
    { k: "Type", v: r.type || "—" },
    { k: "Ref No", v: refCell },
    { k: "Mode", v: sameMode ? r.method : modeLink(r.method, focus) },
    ...(r.bankId && !sameBank ? [{ k: "Bank", v: <LedgerLink label={r.bankName || "Bank"} to="/cash" onPress={() => openLedger("bank", r.bankId!, r.bankName || "Bank", focus)} /> }] : []),
    ...(r.customerId && !sameCustomer ? [{ k: "Customer", v: <LedgerLink label={r.customerName || "Customer"} to="/cash" onPress={() => openLedger("customer", r.customerId!, r.customerName || "Customer", focus)} /> }] : []),
    ...(categoryId && kind !== "category" ? [{ k: "Category", v: <LedgerLink label={category!} to="/cash" onPress={() => openLedger("category", categoryId, category!, focus)} /> }] : []),
    { k: "Debit", v: isDebit ? inr(r.amount) : "—", color: isDebit ? C.red : C.muted },
    { k: "Credit", v: isDebit ? "—" : inr(r.amount), color: isDebit || memo ? C.muted : C.green },
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
        amountColor={isDebit ? C.red : memo ? C.muted : C.green}
        status={memo ? "Memo" : isDebit ? "Debit" : "Credit"}
        statusTone={memo ? "closed" : isDebit ? "overdue" : "active"}
        details={details}
        actions={entry.actions}
        style={highlight ? { borderColor: C.brandDeep, borderWidth: 2, backgroundColor: "#f3f3ff" } : undefined}
      />
      {entry.sheets}
    </>
  );
}

type LedgerListProps = { kind: LedgerKind; ledgerRef: string; top?: React.ReactElement; onCategoryName?: (name: string) => void; focus?: LedgerFocus; initialOffset?: number };

// Most rows loaded while looking for the focused transaction.
const FOCUS_MAX_ROWS = 600;

const sameAmount = (a: number, b: number) => Math.abs(a - b) < 0.005;

type LedgerListOptions = { kind: LedgerKind; ledgerRef: string; onCategoryName?: (name: string) => void; focus?: LedgerFocus; enabled?: boolean; fresh?: boolean };

/** The ledger's data + controls as a hook, so a screen with other tabs can host
 * it in ONE persistent list (the customer profile) instead of swapping lists.
 * `controls` is the filter row + totals; `renderItem`/`keyOf` draw the rows. */
export function useLedgerList({ kind, ledgerRef, onCategoryName, focus, enabled = true, fresh = true }: LedgerListOptions) {
  // One grouped filter: Mode (bank ledger only), Branch + Bank (mode ledgers;
  // Cash has no bank of record), and Date — like web's PartyLedger / ModeLedgerPage.
  const [fv, setFv] = useState<GroupedFilterValue>(emptyGroupedFilter());
  // No Branch filter for a one-branch business or a branch-confined role (same rule as web).
  const showBranchFilter = useShowBranchFilter();
  const fromDate = gfDate(fv, "date").from;
  const toDate = gfDate(fv, "date").to;
  // Bank ledgers take any number of modes (like web); mode ledgers take Branch, Bank and Type.
  const modeCsv = kind === "bank" ? gfValues(fv, "mode").join(",") || undefined : undefined;
  const typeCsv = kind === "mode" ? gfValues(fv, "type").join(",") || undefined : undefined;
  const branchCsv = kind === "mode" && showBranchFilter ? gfValues(fv, "branch").join(",") || undefined : undefined;
  // Customer ledger only: narrow to specific loans of that customer (backend loan_numbers).
  const loanCsv = kind === "customer" ? gfValues(fv, "loan").join(",") || undefined : undefined;
  const modeBankId = kind === "mode" && gfFirst(fv, "bank") ? Number(gfFirst(fv, "bank")) : undefined;
  const sections: GFSection[] = [
    ...(kind === "bank" ? [{ kind: "static" as const, key: "mode", label: "Mode", options: LEDGER_MODES.map((m) => ({ value: m, label: m })) }] : []),
    ...(kind === "mode"
      ? [
          ...(!showBranchFilter ? [] : [{
            kind: "async" as const,
            key: "branch",
            label: "Branch",
            fetchPage: (p: { q?: string; limit: number; offset: number }) =>
              listBranchesPage({ q: p.q, limit: p.limit, offset: p.offset }).then((r) => ({ items: r.items.map((b) => ({ value: String(b.id), label: b.name })), hasMore: r.hasMore })),
          }]),
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
    // Mode ledgers can also narrow by transaction type — same options as the Ledger page.
    ...(kind === "mode" ? [{ kind: "static" as const, key: "type", label: "Type", options: MOVEMENT_TYPE_OPTIONS }] : []),
    ...(kind === "customer"
      ? [{
          kind: "async" as const,
          key: "loan",
          label: "Loan",
          fetchPage: (p: { q?: string; limit: number; offset: number }) =>
            listLoansPage({ customerId: Number(ledgerRef), q: p.q, limit: p.limit, offset: p.offset }).then((r) => ({ items: r.items.map((l) => ({ value: l.loanNumber, label: l.loanNumber })), hasMore: r.hasMore })),
        }]
      : []),
    { kind: "date" as const, key: "date", label: "Date" },
  ];
  const categoryIds = useExpenseCategoryIds();
  const canExport = useAuth().can("Ledger_Export", "can_export_ledger");
  const [exporting, setExporting] = useState(false);
  // Set when this category is a loan source — the ledger is then that loan's own, principal-based.
  const [loan, setLoan] = useState<LoanLedgerSummary | undefined>();

  // PDF of every row matching the date filter, like the web ledgers' Download.
  async function onDownload() {
    if (exporting) return;
    setExporting(true);
    toast.info("Preparing PDF", "The ledger will open in the share sheet.");
    try {
      await shareLedgerPdf(kind, ledgerRef, { fromDate, toDate }, "Ledger", { bankId: modeBankId, branchIds: branchCsv, modes: modeCsv, types: typeCsv, loanNumbers: loanCsv });
    } catch (e) {
      if (isUserCancel(e)) return;
      toast.error("Download failed", userMessage(e, "Could not download the ledger — try again."));
    } finally {
      setExporting(false);
    }
  }
  const list = useServerList<LedgerRow>({
    key: ["ledger", kind, ledgerRef, fromDate, toDate, modeCsv, typeCsv, branchCsv, modeBankId, loanCsv],
    fetchPage: (p) =>
      (kind === "mode"
        ? getModeLedger(ledgerRef, { limit: p.limit, offset: p.offset, fromDate, toDate, bankId: modeBankId, branchIds: branchCsv, types: typeCsv })
        : getLedger(kind, ledgerRef, { limit: p.limit, offset: p.offset, fromDate, toDate, modes: modeCsv, loanNumbers: loanCsv })
      ).then((r) => {
        if (r.categoryName) onCategoryName?.(r.categoryName);
        setLoan(kind === "category" ? r.loan : undefined);
        // Server-side sums over every row matching the filters, not just the pages loaded so far.
        return { items: r.items ?? [], hasMore: p.offset + p.limit < r.total, total: r.total, totalDebit: r.totalDebit, totalCredit: r.totalCredit };
      }),
    fresh,
    enabled,
    staleTime: fresh ? undefined : 30_000,
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

  // Read off the cached first page, so the totals still show when the list comes back from cache without a refetch.
  const firstPage = list.pages?.[0];
  const totals = firstPage ? { debit: firstPage.totalDebit ?? 0, credit: firstPage.totalCredit ?? 0 } : null;
  const totalRows: [string, number, string][] = totals
    ? [
        ["Net", totals.credit - totals.debit, totals.credit - totals.debit < 0 ? C.red : C.green],
        ["Debit", totals.debit, C.red],
        ["Credit", totals.credit, C.green],
      ]
    : [];

  const controls = (
    <>
          {/* paddingBottom keeps the same gap above the first row whether or not the totals card shows. */}
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap", paddingHorizontal: 18, paddingTop: 12, paddingBottom: 16 }}>
            <GroupedFilter title="Filter ledger" sections={sections} value={fv} onChange={setFv} />
            <View style={{ flex: 1 }} />
            {canExport ? <PillButton label={exporting ? "Preparing…" : "Download"} onPress={onDownload} /> : null}
          </View>
          {loan ? (
            <View style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", rowGap: 6, marginHorizontal: 18, marginBottom: 10, paddingVertical: 10, paddingHorizontal: 12, borderRadius: 10, backgroundColor: C.card, borderWidth: 1, borderColor: C.line }}>
              <Txt style={{ fontSize: 12.5, color: C.muted, width: "100%" }}>
                {loan.name}{loan.loanNumber ? ` · ${loan.loanNumber}` : ""}
              </Txt>
              {([["Principal", loan.principal], ["Drawn", loan.drawn], ["Repaid", loan.repaid], ["Balance", loan.balance]] as const).map(([k, v]) => (
                <Txt key={k} style={{ fontSize: 12.5, color: C.muted }}>
                  {k} <Txt style={{ fontWeight: "700", color: C.brandDeep }}>{inr(v)}</Txt>
                </Txt>
              ))}
            </View>
          ) : null}
          {/* One line each — side by side, large amounts were clipped off the edge of the screen. */}
          {totals ? (
            <View style={{ marginHorizontal: 18, marginBottom: 14, paddingHorizontal: 12, borderRadius: 10, backgroundColor: C.card, borderWidth: 1, borderColor: C.line }}>
              {totalRows.map(([k, v, color], i) => (
                <View key={k} style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 12, paddingVertical: 9, ...(i > 0 ? { borderTopWidth: 1, borderTopColor: C.line } : null) }}>
                  <Txt style={{ fontSize: 12.5, color: C.muted }}>{k}</Txt>
                  <Txt style={{ fontSize: 12.5, fontWeight: "700", color }}>{inr(v)}</Txt>
                </View>
              ))}
            </View>
          ) : null}
    </>
  );
  return {
    list,
    focusIndex,
    controls,
    emptyText: "No transactions found.",
    keyOf: (r: LedgerRow) => `ledger-${r.type}-${r.id}-${r.method}`,
    renderItem: (r: LedgerRow, i: number) => <LedgerRowItem r={r} index={i} kind={kind} ledgerRef={ledgerRef} categoryIds={categoryIds} highlight={highlighted && i === focusIndex} />,
  };
}

/** Paged ledger with a From/To date filter. `top` renders above the filter
 * (e.g. the customer detail's tabs). onCategoryName reports the category
 * ledger's resolved name for the screen title. */
export function LedgerList({ kind, ledgerRef, top, onCategoryName, focus, initialOffset }: LedgerListProps) {
  const l = useLedgerList({ kind, ledgerRef, onCategoryName, focus });
  return (
    <ServerFlatList
      list={l.list}
      items={l.list.items}
      focusIndex={l.focusIndex}
      initialOffset={initialOffset}
      keyOf={l.keyOf}
      emptyText={l.emptyText}
      header={
        <>
          {top}
          {l.controls}
        </>
      }
      renderItem={l.renderItem}
    />
  );
}
