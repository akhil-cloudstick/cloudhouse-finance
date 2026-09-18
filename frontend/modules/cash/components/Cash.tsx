"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useModal } from "@/common/components/Modal";
import { useToast } from "@/common/components/Toast";
import { Icon } from "@/common/components/Icon";
import { fmt } from "@/common/utils/format";
import { StatusChip } from "@/common/components/ui/StatusChip";
import { AddCashModalContent } from "@/common/components/modals/AddCashModal";
import { CashOutModalContent } from "@/common/components/modals/CashOutModal";
import { ExpenseModalContent, ReceiptViewModalContent } from "@/common/components/modals/ExpenseModal";
import { GoldSaleModalContent } from "@/common/components/modals/GoldSaleModal";
import { listActiveBranches, type BranchView } from "@/modules/branches/services/branchService";
import { SearchableSelect } from "@/common/components/ui/SearchableSelect";
import { DatePicker } from "@/common/components/ui/DatePicker";
import {
  listCashMovementsPage, listExpensesPage, listGoldSalesPage, getCashSummary, setOpeningBalance,
  setCashMovementLoanStatus, approveExpense, rejectExpense,
  exportCashMovements, exportExpenses,
  type CashMovementView, type ExpenseView, type GoldSaleView, type CashSummary, type CashMovementCategory,
} from "@/modules/cash/services/cashService";
import { Select } from "@/common/components/ui/Select";
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

function MovementRow({ m, canUpdate, onToggleLoan }: { m: CashMovementView; canUpdate: boolean; onToggleLoan: (id: number) => void }) {
  const isLoan = m.type === "in" && m.source === "Loan";
  return (
    <tr>
      <td data-label="Date">{m.d}</td>
      <td data-label="Type">{m.type === "in" ? <span className="chip green">Cash In</span> : <span className="chip red">Cash Out</span>}</td>
      {/* Loan repayments post as source="Collection" with the payment
          type/loan number in `purpose` (see cash.MovementService.
          RecordLoanPaymentCashIn) — show both, not just source, so those
          rows don't all read as a bare "Collection". */}
      <td data-label="Source / Purpose">
        {m.partyCustomerId ? (
          <a href="#" onClick={(e) => { e.preventDefault(); location.hash = "party-customer/" + m.partyCustomerId; }}>
            {m.type === "in" ? (m.purpose ? `${m.source} · ${m.purpose}` : m.source) : m.purpose || "—"}
          </a>
        ) : (
          m.type === "in" ? (m.purpose ? `${m.source} · ${m.purpose}` : m.source) : m.purpose || "—"
        )}
      </td>
      <td data-label="Mode">{m.mode || "—"}</td>
      <td data-label="Bank">
        {m.bankId ? (
          <a href="#" onClick={(e) => { e.preventDefault(); location.hash = "party-bank/" + m.bankId; }}>{m.bank || "—"}</a>
        ) : (
          m.bank || "—"
        )}
      </td>
      <td className="num" data-label="Amount" style={{ color: m.type === "in" ? "var(--green)" : "var(--red)" }}>
        {m.type === "in" ? "+" : "−"}{fmt(m.amount)}
      </td>
      <td data-label="Loan Status">
        {isLoan ? (
          <>
            <span className={`chip ${m.status === "Closed" ? "gray" : "amber"}`}>{m.status || "Open"}</span>
            {canUpdate && (
              <button className="btn plain sm" style={{ padding: "3px 8px", marginLeft: 6 }} onClick={() => onToggleLoan(m.id)}>
                {m.status === "Closed" ? "Reopen" : "Mark Closed"}
              </button>
            )}
          </>
        ) : "—"}
      </td>
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

  const [branches, setBranches] = useState<BranchView[]>([]);
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
  const [openingInput, setOpeningInput] = useState("");
  // Once today's opening balance exists for the selected branch we show it
  // read-only instead of an empty-looking input asking for it again — the
  // figure is entered once per branch per day. "Change" reopens the input.
  const [editingOpening, setEditingOpening] = useState(false);
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
  const [movementsCategory, setMovementsCategory] = useState<CashMovementCategory>("");
  const [downloadingMovements, setDownloadingMovements] = useState(false);
  const [downloadingExpenses, setDownloadingExpenses] = useState(false);

  /* Guards against a stale response winning. The first render fires a
   * summary request before the branch list has loaded (branchId ""), then a
   * second, branch-scoped one the moment it does. The unscoped one has no
   * opening balance (it's per-branch), so if it resolved last it overwrote
   * the real figure with 0 — which is exactly what made a set opening
   * balance read as ₹0 after a refresh. Only the newest request may write. */
  const summarySeq = useRef(0);

  const refresh = useCallback(() => {
    listCashMovementsPage(movementsPage, cashPageSize, { fromDate: movementsFrom || undefined, toDate: movementsTo || undefined, category: movementsCategory || undefined }).then(({ items, hasMore, total }) => {
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
      setOpeningInput(s.openingCashSet ? String(s.openingCash) : "");
      setEditingOpening(false);
    }).catch(() => {
      if (seq !== summarySeq.current) return;
      setSummary(null);
    });
  }, [branchId, today, movementsPage, expensesPage, goldSalesPage, cashPageSize, movementsFrom, movementsTo, movementsCategory]);

  useEffect(() => {
    listActiveBranches().then((list) => {
      setBranches(list);
      if (list.length) {
        setBranchId((cur) => cur || list[0].id);
        setBranchLabel((cur) => cur || list[0].name);
      }
    }).catch(() => {});
  }, []);

  // "All branches" is a synthetic id-0 row (never a real Branch) prepended
  // to the local filter list — GET /branches is already scoped server-side
  // (non-admins only ever get their own branch back), so it's only ever
  // meaningfully different from the single real row for an Administrator.
  const ALL_BRANCHES: BranchView = { id: 0, name: "All branches", code: "", address: "", phone: "", isActive: true };
  async function searchBranchesFilter(q: string, _page: number): Promise<{ items: BranchView[]; hasMore: boolean }> {
    const query = q.trim().toLowerCase();
    const all = [ALL_BRANCHES, ...branches];
    const items = query ? all.filter((b) => b.name.toLowerCase().includes(query)) : all;
    return { items, hasMore: false };
  }

  useEffect(() => { refresh(); }, [refresh]);

  // Locked = today's figure is already on record for this branch, so the
  // card reports it rather than asking for it again.
  const openingLocked = !!branchId && !!summary?.openingCashSet && !editingOpening;

  const total = expenses.reduce((s, e) => s + e.amt, 0);
  const cashIn = movements.filter((m) => m.type === "in").reduce((s, m) => s + m.amount, 0);
  const cashOut = movements.filter((m) => m.type === "out").reduce((s, m) => s + m.amount, 0);

  async function toggleCashLoan(id: number) {
    const m = movements.find((x) => x.id === id);
    if (!m) return;
    const next = m.status === "Closed" ? "Open" : "Closed";
    try {
      await setCashMovementLoanStatus(id, next);
      refresh();
      toast(`Loan from ${m.bank} marked ${next.toLowerCase()}`);
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Could not update loan status.");
    }
  }

  async function saveOpeningBalance() {
    if (!branchId) { toast("Select a branch first."); return; }
    const amount = +openingInput;
    if (openingInput.trim() === "" || !(amount >= 0)) { toast("Enter a valid opening balance."); return; }
    try {
      await setOpeningBalance(branchId, amount, today);
      refresh();
      toast(`Opening cash set to ${fmt(amount)}`);
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Could not save opening balance.");
    }
  }

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
      await exportCashMovements({ fromDate: movementsFrom || undefined, toDate: movementsTo || undefined, category: movementsCategory || undefined });
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
        <div className="page-h-title"><h1>Cash-in-Hand &amp; Expenses</h1><p>Daily cash movements, opening balances and branch expenses.</p></div>
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
                  <a href="#" title="Take Cash Out" onClick={(e) => { e.preventDefault(); setCashActionsMenuOpen(false); openModal(<CashOutModalContent onSaved={refresh} />); }}>
                    <Icon name="coin" /><span className="tx">Take Cash Out</span>
                  </a>
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
          </div>
        )}
      </div>
      <hr className="gold-rule rule-sm" />

      <div className="card" style={{ marginBottom: smallScreen ? 14 : 24 }}>
        <div className="hd">
          <h3>Opening Cash Balance — Today</h3>
          <div className="sp" />
          <div style={{ width: 140 }}>
            <SearchableSelect<BranchView>
              value={branchLabel}
              onChange={(id, item) => { setBranchId(item.id === 0 ? "" : item.id); setBranchLabel(item.name); }}
              fetchFn={searchBranchesFilter}
              getLabel={(b) => b.name}
              getId={(b) => String(b.id)}
              placeholder="Search branch…"
            />
          </div>
          {/* Without "can update cash" the figure is read-only: no Change
              button, and no input/Set pair to record one with either. */}
          {openingLocked || !canUpdateCash ? (
            <>
              <b style={{ marginLeft: 8, fontSize: 16, color: "var(--brand-deep)" }}>{fmt(summary?.openingCash || 0)}</b>
              {canUpdateCash && (
                <button className="btn ghost sm" style={{ marginLeft: 8 }} onClick={() => { setOpeningInput(String(summary?.openingCash ?? "")); setEditingOpening(true); }}>Change</button>
              )}
            </>
          ) : (
            <>
              <input className="inp" style={{ width: 140, marginLeft: 8 }} type="number" min={0} placeholder="e.g. 50000" value={openingInput} onChange={(e) => setOpeningInput(e.target.value)} />
              <button className="btn sm" style={{ marginLeft: 8 }} onClick={saveOpeningBalance} disabled={!branchId}>Set</button>
              {editingOpening && (
                <button className="btn ghost sm" style={{ marginLeft: 8 }} onClick={() => setEditingOpening(false)}>Cancel</button>
              )}
            </>
          )}
        </div>
        <div className="ft">
          {openingLocked
            ? "Already recorded for this branch today — it feeds directly into the KPI below. Use “Change” only to correct a wrong figure."
            : "Enter the opening cash-in-hand for the selected branch at the start of the day — it feeds directly into the KPI below."}
        </div>
      </div>

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
            <h3>Cash Movements</h3>
            <div className="sp" />
            {/* From/To/Clear as one tight group, then the In/Out summary
                further right still — the rightmost thing in the row. The
                whole cluster wraps as a unit onto its own line below the
                title on narrow screens (flexWrap above), not each control
                wrapping individually. */}
            {/* DatePicker is a fixed 230px app-wide by house convention
                (app.css's `.dp.dp-date` rule ignores a narrower wrapper),
                so these sit at their natural width rather than fighting it. */}
            <div className="cash-filter-row" style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <div style={{ width: 150 }}>
                <Select
                  options={[
                    { value: "", label: "All types" },
                    { value: "loan", label: "Loan" },
                    { value: "auction", label: "Auction" },
                    { value: "collection", label: "Collection" },
                    { value: "expenses", label: "Expenses" },
                  ]}
                  value={movementsCategory}
                  onChange={(v) => { setMovementsCategory(v as CashMovementCategory); setMovementsPage(1); }}
                />
              </div>
              <DatePicker value={movementsFrom} onChange={(v) => { setMovementsFrom(v); setMovementsPage(1); }} placeholder="From date…" max={movementsTo || undefined} />
              <DatePicker value={movementsTo} onChange={(v) => { setMovementsTo(v); setMovementsPage(1); }} placeholder="To date…" min={movementsFrom || undefined} />
              {(movementsFrom || movementsTo || movementsCategory) && (
                <button className="btn ghost sm" onClick={() => { setMovementsFrom(""); setMovementsTo(""); setMovementsCategory(""); setMovementsPage(1); }}>Clear</button>
              )}
              <button className="btn ghost sm" onClick={downloadMovements} disabled={downloadingMovements} title="Download every row matching the current filters">
                <Icon name="download" /> {downloadingMovements ? "Preparing…" : "Download"}
              </button>
            </div>
          </div>
          <div className="tbl-wrap tbl-scroll">
            <table className="tbl tbl-center tbl-roomy tbl-stack">
              <thead><tr><th>Date</th><th>Type</th><th>Source / Purpose</th><th>Mode</th><th>Bank</th><th className="num">Amount</th><th>Loan Status</th></tr></thead>
              <tbody>
                {movements.length
                  ? movements.map((m) => <MovementRow key={m.id} m={m} canUpdate={canUpdateCash} onToggleLoan={toggleCashLoan} />)
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
            <div className="sp" />
            <span style={{ fontSize: 12.5, color: "var(--muted)" }}>In {fmt(cashIn)} · Out {fmt(cashOut)}</span>
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
