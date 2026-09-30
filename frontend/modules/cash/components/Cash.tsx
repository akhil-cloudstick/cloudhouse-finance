"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useModal } from "@/common/components/Modal";
import { useToast } from "@/common/components/Toast";
import { Icon } from "@/common/components/Icon";
import { fmt } from "@/common/utils/format";
import { StatusChip } from "@/common/components/ui/StatusChip";
import { AddCashModalContent } from "@/common/components/modals/AddCashModal";
import { OpeningCashModalContent } from "@/common/components/modals/OpeningCashModal";
import { ExpenseModalContent, ReceiptViewModalContent } from "@/common/components/modals/ExpenseModal";
import { GoldSaleModalContent } from "@/common/components/modals/GoldSaleModal";
import { listActiveBranches, type BranchView } from "@/modules/branches/services/branchService";
import { listCustomersPage } from "@/modules/customers/services/customerService";
import { FilterPanel, type FilterCategory, type FilterValue } from "@/common/components/ui/FilterPanel";
import { LedgerRefLink } from "@/common/components/ui/LedgerRefLink";
import {
  listCashMovementsPage, listExpensesPage, listGoldSalesPage, getCashSummary,
  approveExpense, rejectExpense,
  exportCashMovements, exportExpenses,
  MODE_LEDGER_ROUTE,
  type CashMovementView, type ExpenseView, type GoldSaleView, type CashSummary, type CashMovementCategory,
} from "@/modules/cash/services/cashService";
import { ApiError } from "@/common/services/httpClient";
import { useAuth } from "@/common/auth-context";
import { useResponsivePageSize, useIsSmallScreen } from "@/common/utils/responsive";
import { useDropdownMenu } from "@/hooks/useDropdownMenu";

function Kpi({ l, v, s, parts, cls }: {
  l: string; v: string | number; s?: string; parts?: [string, number][]; cls?: string;
}) {
  return (
    <div className={`kpi ${cls || ""}`}>
      <div className="l">{l}</div>
      <div className="v">{v}</div>
      <div className="s">{s || ""}</div>
      {parts ? <KpiParts parts={parts} /> : null}
    </div>
  );
}

/* Breaks a KPI's single total back out into the sources that fed it. Zero
 * buckets are dropped so a quiet day shows a short list rather than a wall of
 * "0"s; if every bucket is zero the whole block collapses to one dash. */
function KpiParts({ parts }: { parts: [string, number][] }) {
  const shown = parts.filter(([, amt]) => amt !== 0);
  return (
    <div style={{ marginTop: 6, borderTop: "1px solid var(--line)", paddingTop: 6, display: "grid", gap: 2 }}>
      {shown.length ? shown.map(([label, amt]) => (
        <div key={label} style={{ display: "flex", fontSize: 11.5, color: "var(--muted)", gap: 6 }}>
          {/* min-width:0 lets the label actually shrink/ellipsize inside a
           * flex row instead of forcing the row (and the fixed-width card)
           * wider than it has room for — without it the amount span was
           * the one getting pushed past the card's edge and clipped by
           * .kpi's overflow:hidden. The amount itself never truncates. */}
          <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</span>
          <span className="num" style={{ flexShrink: 0, marginLeft: "auto", fontVariantNumeric: "tabular-nums" }}>{fmt(amt)}</span>
        </div>
      )) : <div style={{ fontSize: 11.5, color: "var(--muted)" }}>No movements today</div>}
    </div>
  );
}

// particularsFor mirrors LedgerExportView.tsx's "Particulars" column — the
// same purpose-or-source text, with the party link Cash.tsx's own Ledger
// table already had layered on top (customer/bank drill-down), so the two
// ledgers read the same way with this one kept clickable.
function particularsFor(m: CashMovementView) {
  const text = m.type === "in" ? (m.purpose ? `${m.source} · ${m.purpose}` : m.source) : m.purpose || "—";
  if (m.partyCustomerId) {
    return <LedgerRefLink kind="customer" id={m.partyCustomerId} label={text || "Customer"} />;
  }
  if (m.bankId) {
    return <LedgerRefLink kind="bank" id={m.bankId} label={text || "Bank"} />;
  }
  return text;
}

// loanNumberFor pulls the loan number back out of `purpose` — every
// loan-related movement's Purpose carries it as a "… — LN-00049" suffix
// (see cash.MovementService.RecordLoanDisbursementCashOut/
// RecordLoanPaymentCashIn/etc), there's no dedicated column for it. Movements
// with no loan number (manual top-ups, expenses, gold sales, …) fall back to
// the transaction group id / movement id, same as before.
const LOAN_NUMBER_RE = /—\s*(LN-\S+)\s*$/;
function loanNumberFor(m: CashMovementView): string {
  const match = m.purpose ? LOAN_NUMBER_RE.exec(m.purpose) : null;
  return match?.[1] || m.transactionGroupId || String(m.id);
}

// A row's Ref No column is only ever clickable when it actually resolved to
// a real loan number (LOAN_NUMBER_RE matched) — the transactionGroupId/id
// fallback isn't a navigable entity, just an internal identifier.
function refCellFor(m: CashMovementView) {
  const ref = loanNumberFor(m);
  if (ref.startsWith("LN-")) return <LedgerRefLink kind="loan" id={ref} label={ref} />;
  return ref;
}

function withRunningBalance(items: CashMovementView[]): { m: CashMovementView; balance: number }[] {
  const chronological = [...items].reverse();
  let running = 0;
  const withBalance = chronological.map((m) => {
    running += m.type === "out" ? m.amount : -m.amount;
    return { m, balance: running };
  });
  return withBalance.reverse();
}

// Every mode is a drill-down link to that mode's own ledger — same "click a
// reference, land on its ledger" pattern as LedgerRefLink's other kinds.
function modeCellFor(mode: string | undefined) {
  if (!mode) return "—";
  const route = MODE_LEDGER_ROUTE[mode];
  return route ? <a href={`#${route}`}>{mode}</a> : mode;
}

function MovementRow({ m, balance }: { m: CashMovementView; balance: number }) {
  return (
    <tr>
      <td data-label="Date">{m.d}</td>
      <td className="ledger-ref" data-label="Ref No" title={loanNumberFor(m)}>{refCellFor(m)}</td>
      <td data-label="Particulars">{particularsFor(m)}</td>
      <td data-label="Mode">{modeCellFor(m.mode)}</td>
      <td className="num" data-label="Debit" style={{ color: m.type === "out" ? "var(--red)" : undefined }}>{m.type === "out" ? fmt(m.amount) : "—"}</td>
      <td className="num" data-label="Credit" style={{ color: m.type === "in" ? "var(--green)" : undefined }}>{m.type === "in" ? fmt(m.amount) : "—"}</td>
      <td className="num" data-label="Balance">{fmt(balance)}</td>
    </tr>
  );
}

function ExpenseRow({ e, canUpdate, onViewReceipt, onApprove, onReject }: {
  e: ExpenseView; canUpdate: boolean; onViewReceipt: () => void; onApprove: () => void; onReject: () => void;
}) {
  return (
    <tr>
      <td data-label="Date">{e.d}</td>
      <td data-label="Category">{e.cat}</td>
      <td className="num" data-label="Amount">{fmt(e.amt)}</td>
      <td data-label="Mode">{e.mode}</td>
      <td data-label="Description / Payee">{e.payee}</td>
      <td data-label="Branch">{e.branch}</td>
      <td data-label="Status">
        <StatusChip status={e.status} />
        {e.remarks ? <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>{e.remarks}</div> : null}
      </td>
      <td data-label="Receipt" style={{ textAlign: "center" }}>
        {e.img
          ? <img src={e.img} style={{ width: 34, height: 34, objectFit: "cover", borderRadius: 6, border: "1px solid var(--line)", cursor: "pointer", verticalAlign: "middle" }} title="View receipt" onClick={onViewReceipt} />
          : <span style={{ color: "var(--muted)" }}>—</span>}
      </td>
      <td data-label="Actions">
        {e.status === "Pending" && canUpdate ? (
          <div style={{ display: "flex", gap: 4 }}>
            <button className="btn plain sm" style={{ padding: "3px 8px", color: "var(--green)" }} onClick={onApprove}>Approve</button>
            <button className="btn plain sm" style={{ padding: "3px 8px", color: "var(--red)" }} onClick={onReject}>Reject</button>
          </div>
        ) : "—"}
      </td>
    </tr>
  );
}

function GoldSaleRow({ g }: { g: GoldSaleView }) {
  return (
    <tr>
      <td>{g.d}</td>
      <td>{g.ornamentType}</td>
      <td className="num">{fmt(g.soldAmount)}</td>
      <td className="num">{fmt(g.costAmount)}</td>
      <td className="num" style={{ color: g.profit >= 0 ? "var(--green)" : "var(--red)" }}>
        {g.profit >= 0 ? "+" : "−"}{fmt(Math.abs(g.profit))}
      </td>
      <td>{g.branch}</td>
      <td>{g.remarks || "—"}</td>
    </tr>
  );
}

/* Ported from legacy/app.js's `renderCash()` / `toggleCashLoan()`. Fully
 * backend-backed: cash movements, the expense register, the opening cash
 * balance, and the Expected Cash in Hand figure all come from the Go API
 * (backend/internal/cash) instead of localStorage. */
export function Cash() {
  const { openModal } = useModal();
  const toast = useToast();
  // Recording cash movements and expenses is a create; approving an expense,
  // closing a loan movement and setting the opening balance are updates.
  // Whatever the role can't do is hidden outright (see Customers.tsx).
  const { can } = useAuth();
  const canCreateCash = can("Cash_Management", "can_create_cash");
  const canUpdateCash = can("Cash_Management", "can_update_cash");
  const today = new Date().toISOString().slice(0, 10);

  // Take Cash Out / Add Cash / Gold Sale Amount used to be 3 separate ghost
  // buttons beside "Record Expense" — collapsed into one "Actions" dropdown
  // the same way LoanDetail.tsx's Loan Actions/Documents menus are, since
  // they outgrew the header on anything but a very wide screen. Record
  // Expense stays its own visible button — it's the primary action here
  // (styled `btn`, not `btn ghost`), not something to bury a click deeper for.
  const {
    open: cashActionsMenuOpen,
    setOpen: setCashActionsMenuOpen,
    menuRef: cashActionsMenuRef,
    triggerRef: cashActionsMenuTriggerRef,
    onKeyDown: onCashActionsMenuKeyDown,
  } = useDropdownMenu<HTMLDivElement>();

  const [branchId, setBranchId] = useState<number | "">("");
  const [branchLabel, setBranchLabel] = useState("");
  const [movements, setMovements] = useState<CashMovementView[]>([]);
  const [expenses, setExpenses] = useState<ExpenseView[]>([]);
  const [goldSales, setGoldSales] = useState<GoldSaleView[]>([]);
  const [movementsPage, setMovementsPage] = useState(1);
  const [movementsHasMore, setMovementsHasMore] = useState(false);
  const [movementsTotal, setMovementsTotal] = useState(0);
  const cashPageSize = useResponsivePageSize(15, 15);
  const smallScreen = useIsSmallScreen();
  const [expensesPage, setExpensesPage] = useState(1);
  const [expensesHasMore, setExpensesHasMore] = useState(false);
  const [expensesTotal, setExpensesTotal] = useState(0);
  const [goldSalesPage, setGoldSalesPage] = useState(1);
  const [goldSalesHasMore, setGoldSalesHasMore] = useState(false);
  const [goldSalesTotal, setGoldSalesTotal] = useState(0);
  const movementsTotalPages = Math.max(1, Math.ceil(movementsTotal / cashPageSize));
  const expensesTotalPages = Math.max(1, Math.ceil(expensesTotal / cashPageSize));
  const goldSalesTotalPages = Math.max(1, Math.ceil(goldSalesTotal / cashPageSize));
  const [summary, setSummary] = useState<CashSummary | null>(null);
  // Switches the card below between the Cash Movements and Expense Register
  // tables instead of stacking both full tables on the page at once.
  const [activeCashTab, setActiveCashTab] = useState<"movements" | "expenses" | "goldSales">("movements");
  // Cash Movements' own date-range filter — empty means "no bound", the
  // table's default unfiltered view. Only this table is filtered; the KPI
  // row above and the Expense Register tab are untouched.
  const [movementsFrom, setMovementsFrom] = useState("");
  const [movementsTo, setMovementsTo] = useState("");
  // Loan/Auction/Collection/Expenses — narrows which cash movements show,
  // same Category* buckets backend/internal/cash/repository.go's FindAll
  // filters on server-side (not a client-side re-filter of loaded rows).
  // Now multi-select (the Type filter section allows checking several
  // buckets at once), so this is an array rather than the old single value.
  const [movementsTypes, setMovementsTypes] = useState<CashMovementCategory[]>([]);
  // Branch/Customer sections of the Ledger filter — independent of the KPI
  // row's own single `branchId` above (which picks whose summary to show);
  // these narrow the movement *rows* across however many branches/customers
  // are checked, same server-side filter as movementsTypes.
  const [movementsBranchIds, setMovementsBranchIds] = useState<string[]>([]);
  const [movementsCustomerIds, setMovementsCustomerIds] = useState<string[]>([]);
  const [allBranches, setAllBranches] = useState<BranchView[]>([]);
  const [downloadingMovements, setDownloadingMovements] = useState(false);
  const [downloadingExpenses, setDownloadingExpenses] = useState(false);

  useEffect(() => { listActiveBranches().then(setAllBranches).catch(() => {}); }, []);

  // Ledger table's grouped filter — Branch, Customer, Type (all
  // multi-select) + Date. Selecting one or more Branches narrows the
  // Customer picker to customers whose home branch is one of those
  // (customers belong to exactly one branch — see customer.model.go); a
  // Customer already picked whose home branch isn't among the selected
  // Branches then matches no rows server-side, same "customer has no
  // account in that branch → nothing shown" rule as the spec.
  const movementsFilterCategories: FilterCategory[] = [
    {
      key: "branch", label: "Branch", kind: "static",
      options: allBranches.map((b) => ({ value: String(b.id), label: b.name })),
    },
    {
      key: "customer", label: "Customer", kind: "async",
      fetchOptions: (search, p) =>
        listCustomersPage(search, p, { branchIds: movementsBranchIds.length ? movementsBranchIds : undefined }, 20).then((res) => ({
          items: res.items.map((c) => ({ value: String(c.id), label: `${c.name} (${c.code})` })),
          hasMore: res.hasMore,
        })),
    },
    {
      key: "type", label: "Type", kind: "static",
      options: [
        { value: "loan", label: "Loan" },
        { value: "auction", label: "Auction" },
        { value: "collection", label: "Collection" },
        { value: "personal loan", label: "Personal Loan" },
        { value: "investment", label: "Investment" },
        { value: "expenses", label: "Expenses" },
      ],
    },
    { key: "__date", label: "Date", kind: "date" },
  ];
  const movementsFilterValue: FilterValue = {
    branch: movementsBranchIds,
    customer: movementsCustomerIds,
    type: movementsTypes,
    __dateFrom: movementsFrom || undefined,
    __dateTo: movementsTo || undefined,
  };

  /* Guards against a stale response winning. The first render fires a
   * summary request before the branch list has loaded (branchId ""), then a
   * second, branch-scoped one the moment it does. The unscoped one has no
   * opening balance (it's per-branch), so if it resolved last it overwrote
   * the real figure with 0 — which is exactly what made a set opening
   * balance read as ₹0 after a refresh. Only the newest request may write. */
  const summarySeq = useRef(0);

  const refresh = useCallback(() => {
    listCashMovementsPage(movementsPage, cashPageSize, {
      fromDate: movementsFrom || undefined,
      toDate: movementsTo || undefined,
      branchIds: movementsBranchIds.length ? movementsBranchIds : undefined,
      customerIds: movementsCustomerIds.length ? movementsCustomerIds : undefined,
      types: movementsTypes.length ? movementsTypes : undefined,
    }).then(({ items, hasMore, total }) => {
      setMovements(items);
      setMovementsHasMore(hasMore);
      setMovementsTotal(total);
    }).catch(() => { setMovements([]); setMovementsHasMore(false); setMovementsTotal(0); });
    listExpensesPage(expensesPage, cashPageSize).then(({ items, hasMore, total }) => {
      setExpenses(items);
      setExpensesHasMore(hasMore);
      setExpensesTotal(total);
    }).catch(() => { setExpenses([]); setExpensesHasMore(false); setExpensesTotal(0); });
    listGoldSalesPage(goldSalesPage, cashPageSize).then(({ items, hasMore, total }) => {
      setGoldSales(items);
      setGoldSalesHasMore(hasMore);
      setGoldSalesTotal(total);
    }).catch(() => { setGoldSales([]); setGoldSalesHasMore(false); setGoldSalesTotal(0); });
    const seq = ++summarySeq.current;
    getCashSummary(branchId || undefined, today).then((s) => {
      if (seq !== summarySeq.current) return;
      setSummary(s);
    }).catch(() => {
      if (seq !== summarySeq.current) return;
      setSummary(null);
    });
  }, [branchId, today, movementsPage, expensesPage, goldSalesPage, cashPageSize, movementsFrom, movementsTo, movementsBranchIds, movementsCustomerIds, movementsTypes]);

  useEffect(() => {
    listActiveBranches().then((list) => {
      if (list.length) {
        setBranchId((cur) => cur || list[0].id);
        setBranchLabel((cur) => cur || list[0].name);
      }
    }).catch(() => {});
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const total = expenses.reduce((s, e) => s + e.amt, 0);
  // Running balance over the currently loaded (paginated) page only — same
  // best-effort approach LedgerExportView.tsx's preview table uses, not a
  // true running balance across the whole filtered set.
  const movementsWithBalance = withRunningBalance(movements);

  async function handleApprove(id: number) {
    try {
      await approveExpense(id);
      refresh();
      toast("Expense approved");
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Could not approve expense.");
    }
  }

  // Both downloads use whatever's currently in the filter state (date
  // range + category for movements) — never the loaded page's row count —
  // matching listCashMovementsPage's own filter params exactly.
  async function downloadMovements() {
    setDownloadingMovements(true);
    try {
      await exportCashMovements({
        fromDate: movementsFrom || undefined,
        toDate: movementsTo || undefined,
        branchIds: movementsBranchIds.length ? movementsBranchIds : undefined,
        customerIds: movementsCustomerIds.length ? movementsCustomerIds : undefined,
        types: movementsTypes.length ? movementsTypes : undefined,
      });
    } catch {
      toast("Could not download cash movements — try again.");
    } finally {
      setDownloadingMovements(false);
    }
  }

  async function downloadExpenses() {
    setDownloadingExpenses(true);
    try {
      await exportExpenses();
    } catch {
      toast("Could not download the expense register — try again.");
    } finally {
      setDownloadingExpenses(false);
    }
  }

  async function handleReject(id: number) {
    const remarks = window.prompt("Reason for rejecting this expense?");
    if (!remarks || !remarks.trim()) return;
    try {
      await rejectExpense(id, remarks.trim());
      refresh();
      toast("Expense rejected");
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Could not reject expense.");
    }
  }

  return (
    <>
      <div className="page-h">
        {/* .page-h-title (flex:1;min-width:0, app.css) lets this block shrink
         * and wrap its own subtitle instead of holding its full natural
         * width and forcing the button cluster below onto its own line —
         * same pattern as LoanDetail.tsx/Calendar.tsx. Without it, the title
         * + subtitle's natural width plus the 3 buttons tipped `.page-h`
         * past its wrap threshold on narrower screens well before the
         * buttons actually ran out of room beside the title. */}
        <div className="page-h-title"><h1>Ledger</h1><p>Daily cash movements, opening balances and branch expenses.</p></div>
        {/* .page-h-actions (app.css) rather than flat siblings of `.page-h`
         * — its own margin-left:auto/justify-content:flex-end keeps all 3
         * buttons right-aligned as a group even once they wrap to their
         * own line, instead of a plain sibling wrap starting flush at
         * `.page-h`'s left edge (which stranded "Record Expense" on its
         * own line at the far left, disconnected from Take Cash Out/Add
         * Cash beside the title). */}
        {canCreateCash && (
          <div className="page-h-actions">
            <div className="docs-dd" ref={cashActionsMenuRef} onKeyDown={onCashActionsMenuKeyDown}>
              <button
                ref={cashActionsMenuTriggerRef}
                className="btn ghost"
                onClick={() => setCashActionsMenuOpen((v) => !v)}
                aria-haspopup="menu"
                aria-expanded={cashActionsMenuOpen}
              >
                <Icon name="coin" /> Actions <Icon name="chevronDown" className="docs-dd-chev" />
              </button>
              {cashActionsMenuOpen && (
                <div className="docs-dd-menu" role="menu">
                  <a href="#" title="Add Cash" onClick={(e) => { e.preventDefault(); setCashActionsMenuOpen(false); openModal(<AddCashModalContent onSaved={refresh} />); }}>
                    <Icon name="coin" /><span className="tx">Add Cash</span>
                  </a>
                  <a href="#" title="Gold Sale Amount" onClick={(e) => { e.preventDefault(); setCashActionsMenuOpen(false); openModal(<GoldSaleModalContent onSaved={refresh} />); }}>
                    <Icon name="coin" /><span className="tx">Gold Sale Amount</span>
                  </a>
                </div>
              )}
            </div>
            <button className="btn" onClick={() => openModal(<ExpenseModalContent onSaved={refresh} />)}><Icon name="plus" /> Record Expense</button>
            {canUpdateCash && (
              <button
                className="btn ghost"
                onClick={() => openModal(
                  <OpeningCashModalContent
                    initialBranchId={branchId || undefined}
                    initialBranchLabel={branchId ? branchLabel : undefined}
                    date={today}
                    onSaved={refresh}
                  />
                )}
              >
                <Icon name="coin" /> Opening Balance
              </button>
            )}
          </div>
        )}
      </div>
      <hr className="gold-rule rule-sm" />

      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-start", gap: smallScreen ? 8 : 15, marginBottom: smallScreen?0:20  }}>
        <div className="kpis kpis-money" style={{ marginBottom: 0, maxWidth: 1113 }}>
          <Kpi l="Opening Cash (today)" v={fmt(summary?.openingCash || 0)} />
          {/* Backend's `collections` is every cash-in movement for the day —
              Savings top-ups, bank pledges and loan repayments alike, not just
              interest/principal (see cash.SummaryService.GetExpectedCash), so
              show `collectionsBreakdown` under the total rather than leaving the
              reader to guess what the one figure is made of. */}
          <Kpi
            l="Cash In (today)"
            v={fmt(summary?.collections || 0)}
            cls="ok"
            parts={[
              ["Loan repayments", summary?.collectionsBreakdown?.repayments || 0],
              ["Bank pledges", summary?.collectionsBreakdown?.pledges || 0],
              ["Auction proceeds", summary?.collectionsBreakdown?.auctions || 0],
              ["Gold sales", summary?.collectionsBreakdown?.goldSales || 0],
              ["Manual top-ups", summary?.collectionsBreakdown?.topUps || 0],
            ]}
          />
          {/* Likewise `disbursements` is every cash-out movement for the day —
              loan principal handed out, manual "Take Cash Out" withdrawals,
              and bank-pledge releases all land here. */}
          <Kpi
            l="Cash Out (today)"
            v={fmt(summary?.disbursements || 0)}
            parts={[
              ["Loan disbursements", summary?.disbursementsBreakdown?.loanDisbursements || 0],
              ["Bank releases", summary?.disbursementsBreakdown?.bankReleases || 0],
              ["Auction refunds", summary?.disbursementsBreakdown?.auctionRefunds || 0],
              ["Gold purchases", summary?.disbursementsBreakdown?.goldPurchases || 0],
              ["Withdrawals", summary?.disbursementsBreakdown?.withdrawals || 0],
            ]}
          />
          <Kpi l="Expenses (today)" v={fmt(summary?.expensesToday || 0)} s={fmt(summary?.cashExpenses || 0) + " cash"} />
          <Kpi l="Balance in Hand" v={fmt(summary?.expectedCash || 0)} s="auto-calculated" cls="ok" />
        </div>

        <div className="tabs cash-tabs-row" style={{ flexShrink: 0, marginBottom: 0 }}>
          <button
            className={activeCashTab === "movements" ? "on" : ""}
            onClick={() => setActiveCashTab("movements")}
          >
            Cash Movements
          </button>
          <button
            className={activeCashTab === "expenses" ? "on" : ""}
            onClick={() => setActiveCashTab("expenses")}
          >
            Expense Register
          </button>
          <button
            className={activeCashTab === "goldSales" ? "on" : ""}
            onClick={() => setActiveCashTab("goldSales")}
          >
            Gold Sales
          </button>
        </div>
      </div>

      {activeCashTab === "movements" && (
        <div className="card tbl-card tbl-card-fill">
          <div className="hd" style={{ flexWrap: "wrap", rowGap: 10 }}>
            <h3>Ledger</h3>
            <div className="sp" />
            <div className="cash-filter-row" style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <FilterPanel
                categories={movementsFilterCategories}
                value={movementsFilterValue}
                onChange={(next) => {
                  setMovementsTypes((Array.isArray(next.type) ? next.type : []) as CashMovementCategory[]);
                  setMovementsFrom(next.__dateFrom || "");
                  setMovementsTo(next.__dateTo || "");
                  const nextBranchIds = Array.isArray(next.branch) ? next.branch : [];
                  setMovementsBranchIds(nextBranchIds);
                  setMovementsCustomerIds(Array.isArray(next.customer) ? next.customer : []);
                  setMovementsPage(1);
                }}
                hideChips
              />
              <button className="btn ghost sm" onClick={downloadMovements} disabled={downloadingMovements} title="Download every row matching the current filters">
                <Icon name="download" /> {downloadingMovements ? "Preparing…" : "Download"}
              </button>
            </div>
          </div>
          <div className="tbl-wrap tbl-scroll">
            <table className="tbl tbl-center tbl-roomy tbl-stack">
              <thead><tr><th>Date</th><th>Ref No</th><th>Particulars</th><th>Mode</th><th className="num">Debit</th><th className="num">Credit</th><th className="num">Balance</th></tr></thead>
              <tbody>
                {movements.length
                  ? movementsWithBalance.map(({ m, balance }) => <MovementRow key={m.id} m={m} balance={balance} />)
                  : <tr><td colSpan={7} className="empty">No cash movements recorded yet. Use &quot;Add Cash&quot; or &quot;Take Cash Out&quot;.</td></tr>}
              </tbody>
            </table>
          </div>
          <div className="ft ft-static" style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <button className="btn plain sm" disabled={movementsPage <= 1} onClick={() => setMovementsPage((p) => Math.max(1, p - 1))}>‹ Prev</button>
            {/* No total-row count comes back from the {items, hasMore}
              * envelope — only whether another page exists — so this shows
              * just the current page rather than a fabricated "of N". */}
            <span style={{ fontSize: 12.5 }}>Page {movementsPage} of {movementsTotalPages}</span>
            <button className="btn plain sm" disabled={movementsPage >= movementsTotalPages} onClick={() => setMovementsPage((p) => Math.min(movementsTotalPages, p + 1))}>Next ›</button>
          </div>
        </div>
      )}

      {activeCashTab === "expenses" && (
        <div className="card tbl-card tbl-card-fill">
          <div className="hd">
            <h3>Expense Register</h3>
            <div className="sp" />
            <button className="btn ghost sm" onClick={downloadExpenses} disabled={downloadingExpenses} title="Download every expense row">
              <Icon name="download" /> {downloadingExpenses ? "Preparing…" : "Download"}
            </button>
            <span style={{ fontSize: 12.5, color: "var(--muted)", marginLeft: 12 }}>Total {fmt(total)}</span>
          </div>
          <div className="tbl-wrap tbl-scroll">
            <table className="tbl tbl-center tbl-roomy tbl-stack">
              <thead><tr><th>Date</th><th>Category</th><th className="num">Amount</th><th>Mode</th><th>Description / Payee</th><th>Branch</th><th>Status</th><th style={{ textAlign: "center" }}>Receipt</th><th>Actions</th></tr></thead>
              <tbody>
                {expenses.length
                  ? expenses.map((e) => (
                    <ExpenseRow
                      key={e.id}
                      e={e}
                      canUpdate={canUpdateCash}
                      onViewReceipt={() => openModal(<ReceiptViewModalContent e={e} />, true)}
                      onApprove={() => handleApprove(e.id)}
                      onReject={() => handleReject(e.id)}
                    />
                  ))
                  : <tr><td colSpan={9} className="empty">No expenses recorded yet.</td></tr>}
              </tbody>
            </table>
          </div>
          <div className="ft ft-static" style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <button className="btn plain sm" disabled={expensesPage <= 1} onClick={() => setExpensesPage((p) => Math.max(1, p - 1))}>‹ Prev</button>
            <span style={{ fontSize: 12.5 }}>Page {expensesPage} of {expensesTotalPages}</span>
            <button className="btn plain sm" disabled={expensesPage >= expensesTotalPages} onClick={() => setExpensesPage((p) => Math.min(expensesTotalPages, p + 1))}>Next ›</button>
            <span style={{ fontSize: 12.5, color: "var(--muted)" }}>Cash expenses automatically reflect in Cash-in-Hand calculations · receipt images attached to expense records</span>
          </div>
        </div>
      )}

      {activeCashTab === "goldSales" && (
        <div className="card tbl-card tbl-card-fill">
          <div className="hd">
            <h3>Gold Sales</h3>
            <div className="sp" />
            <span style={{ fontSize: 12.5, color: "var(--muted)" }}>
              Total profit {fmt(goldSales.reduce((s, g) => s + g.profit, 0))}
            </span>
          </div>
          <div className="tbl-wrap tbl-scroll">
            <table className="tbl tbl-center tbl-roomy">
              <thead><tr><th>Date</th><th>Ornament Type</th><th className="num">Sold For</th><th className="num">Cost</th><th className="num">Profit / Loss</th><th>Branch</th><th>Remarks</th></tr></thead>
              <tbody>
                {goldSales.length
                  ? goldSales.map((g) => <GoldSaleRow key={g.id} g={g} />)
                  : <tr><td colSpan={7} className="empty">No gold sales recorded yet. Use &quot;Gold Sale Amount&quot;.</td></tr>}
              </tbody>
            </table>
          </div>
          <div className="ft" style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <button className="btn plain sm" disabled={goldSalesPage <= 1} onClick={() => setGoldSalesPage((p) => Math.max(1, p - 1))}>‹ Prev</button>
            <span style={{ fontSize: 12.5 }}>Page {goldSalesPage} of {goldSalesTotalPages}</span>
            <button className="btn plain sm" disabled={goldSalesPage >= goldSalesTotalPages} onClick={() => setGoldSalesPage((p) => Math.min(goldSalesTotalPages, p + 1))}>Next ›</button>
            <span style={{ fontSize: 12.5, color: "var(--muted)" }}>Sold amount automatically books into Cash-in-Hand as a cash-in movement</span>
          </div>
        </div>
      )}
    </>
  );
}
