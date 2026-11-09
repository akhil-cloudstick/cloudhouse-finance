"use client";

import { usePersistedState } from "@/common/hooks/use-persisted-state";
import { useDebouncedValue } from "@/common/hooks/use-debounced-value";
import { TableSearch } from "@/common/components/ui/TableSearch";
import { useCallback, useEffect, useRef, useState } from "react";
import { useModal } from "@/common/components/ModalProvider";
import { useToast } from "@/common/components/ToastProvider";
import { Icon } from "@/common/components/Icon";
import { fmt, fmtDate, localToday } from "@/common/utils/format";
import { DatePicker } from "@/common/components/ui/DatePicker";
import { AddEntryModalContent } from "@/modules/cash/components/AddEntryModalContent";
import { ReceiptViewModalContent } from "@/modules/cash/components/ReceiptViewModalContent";
import { listActiveBranches } from "@/modules/branches/services/branchService";
import { type BranchView } from "@/modules/branches/types/branch-types";
import { listCustomersPage } from "@/modules/customers/services/customerService";
import { FilterPanel, type FilterCategory, type FilterValue } from "@/common/components/ui/FilterPanel";
import { FooterTotals } from "@/common/components/ui/FooterTotals";
import { useExpenseCategoryIdsState } from "@/common/hooks/use-expense-category-ids";
import { rememberedLedgerPage, reloadedLedgerPosition, saveLedgerPosition, useLedgerFocus } from "@/common/hooks/use-ledger-focus";
import { listCashMovementsPage, listExpensesPage, getExpense, listGoldSalesPage, getCashSummary, approveExpense, rejectExpense, exportCashMovements, exportExpenses } from "@/modules/cash/services/cashService";
import { type CashMovementView, type ExpenseView, type GoldSaleView, type CashSummary, type CashMovementCategory } from "@/modules/cash/types/cash-types";
import { useAuth, useApprovalWorkflow } from "@/common/providers/AuthProvider";
import { canActAtStage, stageByPending } from "@/common/services/approvalWorkflowService";
import { ApiError } from "@/common/services/httpClient";
import { RejectRemarksModalContent } from "@/common/components/modals/RejectRemarksModalContent";
import { useScrollPageSize, STACK_MODE_MAX_WIDTH, useIsSmallScreen } from "@/common/utils/responsive";
import { ScrollSentinel } from "@/common/components/ui/ScrollSentinel";
import { useShowBranch, useShowBranchFilter } from "@/common/hooks/use-branch-switch";
import { singleFlight } from "@/common/utils/singleFlight";
import { Kpi } from "@/modules/cash/components/Kpi";
import { MovementRow } from "@/modules/cash/components/MovementRow";
import { useBankPledgeEntryActions } from "@/modules/loans/components/useBankPledgeEntryActions";
import { ExpenseRow } from "@/modules/cash/components/ExpenseRow";
import { EditEntryModalContent } from "@/modules/cash/components/EditEntryModalContent";
import { GoldSaleRow } from "@/modules/cash/components/GoldSaleRow";
import { TableCols } from "@/common/components/ui/TableCols";

// Stable empty selection for a hidden Branch filter (see useShowBranchFilter).
const NO_BRANCHES: string[] = [];

// Newest-first rows, each with the balance AFTER it. The newest row's balance
// comes from the server (topBalance), so every page shows the ledger's true
// running balance rather than one that restarts from zero on each page.
function withRunningBalance(items: CashMovementView[], topBalance: number): { m: CashMovementView; balance: number }[] {
	let running = topBalance;
	return items.map((m) => {
		const balance = running;
		// Cash in raises the balance, cash out lowers it, so stepping back to the
		// previous (older) row undoes this row's effect.
		running -= m.type === "out" ? -m.amount : m.amount;
		return { m, balance };
	});
}

/* Ported from legacy/app.js's `renderCash()` / `toggleCashLoan()`. Fully
 * backend-backed: cash movements, the expense register, the opening cash
 * balance, and the Expected Cash in Hand figure all come from the Go API
 * (backend/internal/cash) instead of localStorage. */
export function CashPage({ focusExpenseId }: { focusExpenseId?: string } = {}) {
	const { openModal } = useModal();
	const toast = useToast();
	// Recording cash movements and expenses is a create; closing a loan movement is an update.
	// Whatever the role can't do is hidden outright (see Customers.tsx).
	const { can, role, isSystem, selectedBranchId } = useAuth();
	const canExport = can("Ledger_Export", "can_export_ledger");
	// No branch filter in a single-branch business, or while the global
	// branch selector already scopes the page (see useShowBranchFilter).
	const showBranchFilter = useShowBranchFilter();
	const showBranch = useShowBranch();
	const { config: workflow } = useApprovalWorkflow();
	const canCreateCash = can("Cash_Management", "can_create_cash");
	const canUpdateCash = can("Cash_Management", "can_update_cash");
	// Pending expenses (expense approval chain configured) — each waits at one
	// approver role; the last approval posts the cash movement. Enforced
	// server-side by the same role check.
	// A row from before the chain was configurable has no stage — it waits at
	// the first step, the same as the backend reads it.
	const expenseStage = (e: ExpenseView) => stageByPending(workflow, "expense", e.approvalStage || "Pending");
	const [decidingExpenseId, setDecidingExpenseId] = useState<number | null>(null);
	// The summary tiles show one day: today (in the browser's own timezone) unless another date is picked.
	const realToday = localToday();
	const [summaryDate, setSummaryDate] = usePersistedState("cash:summary-date", "");
	const today = summaryDate && summaryDate <= realToday ? summaryDate : realToday;
	const isToday = today === realToday;
	const dayLabel = isToday ? "today" : fmtDate(today);

	const [movements, setMovements] = useState<CashMovementView[]>([]);
	const [expenses, setExpenses] = useState<ExpenseView[]>([]);
	// Category name -> id, for the category-ledger links on expense rows.
	// Rows wait for `idsReady` so a category is never painted as plain text and then swapped for a link chip.
	const { ids: categoryIdByName, ready: idsReady } = useExpenseCategoryIdsState();
	const [goldSales, setGoldSales] = useState<GoldSaleView[]>([]);
	// Table-footer totals from the server — every row matching the current
	// filters, not just the loaded page.
	const [movementSums, setMovementSums] = useState({ debit: 0, credit: 0 });
	// Running balance after the page's newest row, from the server — the whole
	// filtered ledger's net minus the rows on earlier pages.
	const [movementsPageBalance, setMovementsPageBalance] = useState(0);
	// Set only while a type/mode/customer/branch filter hides rows: each row's balance in the whole ledger.
	const [movementsRowBalances, setMovementsRowBalances] = useState<number[] | undefined>();
	const [expenseSum, setExpenseSum] = useState(0);
	const [goldSaleSums, setGoldSaleSums] = useState({ sold: 0, cost: 0, profit: 0 });
	// Back from a drill-down, each table reopens on the page the user left.
	const [movementsPage, setMovementsPage] = useState(() => rememberedLedgerPage("cash-movements") ?? 1);
	const [movementsHasMore, setMovementsHasMore] = useState(false);
	const [movementsTotal, setMovementsTotal] = useState(0);
	// Card mode (<=1100px): Prev/Next gives way to scroll-to-load — the page stays 1 and the
	// size grows. Above 1100px (incl. the stacked 1101-1279px layout) it is a fixed 15.
	const { cards, size: cashPageSize, more } = useScrollPageSize(15, STACK_MODE_MAX_WIDTH);
	const smallScreen = useIsSmallScreen();
	const [expensesPage, setExpensesPage] = useState(() => rememberedLedgerPage("cash-expenses") ?? 1);
	const [expensesHasMore, setExpensesHasMore] = useState(false);
	const [expensesTotal, setExpensesTotal] = useState(0);
	const [goldSalesPage, setGoldSalesPage] = useState(1);
	const [goldSalesHasMore, setGoldSalesHasMore] = useState(false);
	const [goldSalesTotal, setGoldSalesTotal] = useState(0);
	useEffect(() => {
		if (cards) { setMovementsPage(1); setExpensesPage(1); setGoldSalesPage(1); }
	}, [cards]);
	const movementsTotalPages = Math.max(1, Math.ceil(movementsTotal / cashPageSize));
	const expensesTotalPages = Math.max(1, Math.ceil(expensesTotal / cashPageSize));
	const goldSalesTotalPages = Math.max(1, Math.ceil(goldSalesTotal / cashPageSize));
	const [summary, setSummary] = useState<CashSummary | null>(null);
	// Switches the card below between the Cash Movements and Expense Register
	// tables instead of stacking both full tables on the page at once.
	const [activeCashTab, setActiveCashTab] = useState<"movements" | "expenses" | "goldSales">(() => {
		const saved = reloadedLedgerPosition()?.tab;
		if (saved === "movements" || saved === "expenses" || saved === "goldSales") return saved;
		return rememberedLedgerPage("cash-expenses") ? "expenses" : "movements";
	});
	// Keep the live tab/pages so a refresh returns to this exact spot.
	useEffect(() => {
		saveLedgerPosition({ tab: activeCashTab, "cash-movements": movementsPage, "cash-expenses": expensesPage });
	}, [activeCashTab, movementsPage, expensesPage]);
	// Cash Movements' own date-range filter — empty means "no bound", the
	// table's default unfiltered view. Only this table is filtered; the KPI
	// row above and the Expense Register tab are untouched.
	const [movementsFrom, setMovementsFrom] = usePersistedState("cash:from", "");
	const [movementsTo, setMovementsTo] = usePersistedState("cash:to", "");
	const [movementsQ, setMovementsQ] = usePersistedState("cash:q", "");
	const [expensesQ, setExpensesQ] = usePersistedState("cash:expenses-q", "");
	const [goldSalesQ, setGoldSalesQ] = usePersistedState("cash:gold-sales-q", "");
	const [expCategory, setExpCategory] = usePersistedState<string[]>("cash:expenses-categories", []);
	const [expMode, setExpMode] = usePersistedState<string[]>("cash:expenses-modes", []);
	const [expStatus, setExpStatus] = usePersistedState<string[]>("cash:expenses-statuses", []);
	const [expFrom, setExpFrom] = usePersistedState("cash:expenses-from", "");
	const [expTo, setExpTo] = usePersistedState("cash:expenses-to", "");
	const [salesFrom, setSalesFrom] = usePersistedState("cash:gold-sales-from", "");
	const [salesTo, setSalesTo] = usePersistedState("cash:gold-sales-to", "");
	// Arrived from the dashboard's expense approval "Review" (/ledger/<expenseId>): show the
	// Expense Register narrowed to that expense's day, then highlight its row once it has loaded.
	const pendingExpenseFocus = useRef<number | null>(null);
	useEffect(() => {
		const id = Number(focusExpenseId);
		if (!focusExpenseId || !Number.isInteger(id) || id <= 0) return;
		setActiveCashTab("expenses");
		getExpense(id)
			.then((e) => {
				pendingExpenseFocus.current = id;
				setExpCategory([]); setExpMode([]); setExpStatus([]);
				setExpFrom(e.d); setExpTo(e.d);
				setExpensesPage(1);
			})
			.catch(() => { /* not found or outside this branch: the Expense Register opens unfiltered */ });
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [focusExpenseId]);
	const movementsSearch = useDebouncedValue(movementsQ.trim());
	const expensesSearch = useDebouncedValue(expensesQ.trim());
	const goldSalesSearch = useDebouncedValue(goldSalesQ.trim());
	// A new search starts from the first page.
	const searchMounted = useRef(false);
	useEffect(() => {
		if (!searchMounted.current) { searchMounted.current = true; return; }
		setMovementsPage(1); setExpensesPage(1); setGoldSalesPage(1);
	}, [movementsSearch, expensesSearch, goldSalesSearch]);
	// A new expense / gold-sale filter also starts from the first page.
	const filterMounted = useRef(false);
	useEffect(() => {
		if (!filterMounted.current) { filterMounted.current = true; return; }
		setExpensesPage(1); setGoldSalesPage(1);
	}, [expCategory, expMode, expStatus, expFrom, expTo, salesFrom, salesTo]);
	// Loan/Auction/Collection/Expenses — narrows which cash movements show,
	// same Category* buckets backend/internal/cash/repository.go's FindAll
	// filters on server-side (not a client-side re-filter of loaded rows).
	// Now multi-select (the Type filter section allows checking several
	// buckets at once), so this is an array rather than the old single value.
	const [movementsTypes, setMovementsTypes] = usePersistedState<CashMovementCategory[]>("cash:types", []);
	// Branch/Customer sections of the Ledger filter — independent of the KPI
	// row (whose scope is the global branch selection, via the header);
	// these narrow the movement *rows* across however many branches/customers
	// are checked, same server-side filter as movementsTypes.
	const [savedMovementsBranchIds, setMovementsBranchIds] = usePersistedState<string[]>("cash:branches", []);
	// A hidden Branch filter must not keep narrowing rows with a stale saved
	// selection (it would intersect the global branch to an empty page).
	const movementsBranchIds = showBranchFilter ? savedMovementsBranchIds : NO_BRANCHES;
	const [movementsCustomerIds, setMovementsCustomerIds] = usePersistedState<string[]>("cash:customers", []);
	// The Mode section of the Ledger filter: Cash / UPI / Bank Transfer.
	const [movementsModes, setMovementsModes] = usePersistedState<string[]>("cash:modes", []);
	const [movementsCategories, setMovementsCategories] = usePersistedState<string[]>("cash:categories", []);
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
	// A single-branch business has nothing to filter by branch — the category
	// is dropped rather than shown with one option.
	const movementsFilterCategories: FilterCategory[] = [
		...(!showBranchFilter ? [] : [{
			key: "branch", label: "Branch", kind: "static" as const, searchHint: "Searches: branch name",
			options: allBranches.map((b) => ({ value: String(b.id), label: b.name })),
		}]),
		{
			key: "customer", label: "Customer", kind: "async", searchHint: "Searches: customer name, customer code, phone",
			fetchOptions: (search, p) =>
				listCustomersPage(search, p, { branchIds: movementsBranchIds.length ? movementsBranchIds : undefined }, 20).then((res) => ({
					items: res.items.map((c) => ({ value: String(c.id), label: `${c.name} (${c.code})` })),
					hasMore: res.hasMore,
				})),
		},
		{
			key: "type", label: "Type", kind: "static", searchHint: "Searches: transaction type",
			options: [
				{ value: "loan", label: "Loan" },
				{ value: "auction", label: "Auction" },
				{ value: "collection", label: "Collection" },
				{ value: "personal loan", label: "Personal Loan" },
				{ value: "bank pledge", label: "Bank Pledge" },
				{ value: "investment", label: "Investment" },
				{ value: "expenses", label: "Expenses" },
			],
		},
		{
			key: "mode", label: "Mode", kind: "static", searchHint: "Searches: payment mode",
			options: [
				{ value: "Cash", label: "Cash" },
				{ value: "UPI", label: "UPI" },
				{ value: "Bank Transfer", label: "Bank Transfer" },
			],
		},
		{ key: "category", label: "Category", kind: "static", searchHint: "Searches: category name", options: Object.keys(categoryIdByName).sort().map((v) => ({ value: v, label: v })) },
		{ key: "__date", label: "Date", kind: "date" },
	];
	const filterOptions = (values: string[]) => values.map((v) => ({ value: v, label: v }));
	const expensesFilterCategories: FilterCategory[] = [
		{ key: "category", label: "Category", kind: "static", options: filterOptions(Object.keys(categoryIdByName).sort()) },
		{ key: "mode", label: "Mode", kind: "static", options: filterOptions(["Cash", "UPI", "Bank Transfer"]) },
		{ key: "status", label: "Status", kind: "static", options: filterOptions(["Pending", "Approved", "Rejected"]) },
		{ key: "__date", label: "Date", kind: "date" },
	];
	const expensesFilterValue: FilterValue = {
		category: expCategory,
		mode: expMode,
		status: expStatus,
		__dateFrom: expFrom || undefined,
		__dateTo: expTo || undefined,
	};
	const goldSalesFilterCategories: FilterCategory[] = [{ key: "__date", label: "Date", kind: "date" }];
	const goldSalesFilterValue: FilterValue = { __dateFrom: salesFrom || undefined, __dateTo: salesTo || undefined };
	const expenseListFilters = { search: expensesSearch || undefined, category: expCategory.length ? expCategory : undefined, mode: expMode.length ? expMode : undefined, status: expStatus.length ? expStatus : undefined, from: expFrom || undefined, to: expTo || undefined };
	const movementsFilterValue: FilterValue = {
		branch: movementsBranchIds,
		customer: movementsCustomerIds,
		type: movementsTypes,
		mode: movementsModes,
		category: movementsCategories,
		__dateFrom: movementsFrom || undefined,
		__dateTo: movementsTo || undefined,
	};

	/* Guards against a stale response winning: every refresh fires a new
	 * summary request, and only the newest may write. The summary itself is
	 * no longer pinned to a branch here — it used to default to the first
	 * branch in the list, which showed one branch's figures under "All
	 * branches". The X-Branch-Id header (global branch selector) now decides:
	 * whole business when nothing is selected, else that one branch. */
	const summarySeq = useRef(0);

	const refresh = useCallback(() => {
		listCashMovementsPage(movementsPage, cashPageSize, {
			fromDate: movementsFrom || undefined,
			toDate: movementsTo || undefined,
			branchIds: movementsBranchIds.length ? movementsBranchIds : undefined,
			customerIds: movementsCustomerIds.length ? movementsCustomerIds : undefined,
			types: movementsTypes.length ? movementsTypes : undefined,
			modes: movementsModes.length ? movementsModes : undefined,
			categoryNames: movementsCategories.length ? movementsCategories : undefined,
			search: movementsSearch || undefined,
		}).then(({ items, hasMore, total, totalDebit, totalCredit, pageBalance, rowBalances }) => {
			setMovements(items);
			setMovementsPageBalance(pageBalance);
			setMovementsRowBalances(rowBalances);
			setMovementsHasMore(hasMore);
			setMovementsTotal(total);
			setMovementSums({ debit: totalDebit, credit: totalCredit });
		}).catch(() => { setMovements([]); setMovementsHasMore(false); setMovementsTotal(0); });
		listExpensesPage(expensesPage, cashPageSize, expenseListFilters).then(({ items, hasMore, total, totalAmount }) => {
			setExpenses(items);
			setExpensesHasMore(hasMore);
			setExpensesTotal(total);
			setExpenseSum(totalAmount);
		}).catch(() => { setExpenses([]); setExpensesHasMore(false); setExpensesTotal(0); });
		listGoldSalesPage(goldSalesPage, cashPageSize, { search: goldSalesSearch || undefined, fromDate: salesFrom || undefined, toDate: salesTo || undefined }).then(({ items, hasMore, total, totalSold, totalCost, totalProfit }) => {
			setGoldSales(items);
			setGoldSalesHasMore(hasMore);
			setGoldSalesTotal(total);
			setGoldSaleSums({ sold: totalSold, cost: totalCost, profit: totalProfit });
		}).catch(() => { setGoldSales([]); setGoldSalesHasMore(false); setGoldSalesTotal(0); });
		const seq = ++summarySeq.current;
		getCashSummary(undefined, today).then((s) => {
			if (seq !== summarySeq.current) return;
			setSummary(s);
		}).catch(() => {
			if (seq !== summarySeq.current) return;
			setSummary(null);
		});
	}, [today, movementsPage, expensesPage, goldSalesPage, cashPageSize, movementsFrom, movementsTo, movementsBranchIds, movementsCustomerIds, movementsTypes, movementsModes, movementsCategories, movementsSearch, expensesSearch, goldSalesSearch, expCategory, expMode, expStatus, expFrom, expTo, salesFrom, salesTo]);

	useLedgerFocus("cash-movements", activeCashTab === "movements" && movements.length > 0 && idsReady, [movements]);
	useLedgerFocus("cash-expenses", activeCashTab === "expenses" && expenses.length > 0 && idsReady, [expenses]);
	useEffect(() => {
		const id = pendingExpenseFocus.current;
		if (id === null || activeCashTab !== "expenses" || !idsReady || !expenses.some((e) => e.id === id)) return;
		const row = document.querySelector<HTMLElement>(`tr[data-ledger-key="e-${id}"]`);
		if (!row) return;
		pendingExpenseFocus.current = null;
		row.classList.add("ledger-row-focus");
		row.scrollIntoView({ block: "center" });
	}, [expenses, activeCashTab, idsReady]);

	const pledgeActions = useBankPledgeEntryActions(refresh);
	const canEditLedger = can("Loan_Management", "can_edit_ledger_entry");
	useEffect(() => { refresh(); }, [refresh]);

	async function onApproveExpense(e: ExpenseView) {
		setDecidingExpenseId(e.id);
		try {
			await approveExpense(e.id);
			toast(`Expense of ${fmt(e.amt)} approved`);
			refresh();
		} catch (err) {
			toast(err instanceof ApiError ? err.message : "Could not approve the expense — try again");
		} finally {
			setDecidingExpenseId(null);
		}
	}

	function onRejectExpense(e: ExpenseView) {
		openModal(
			<RejectRemarksModalContent
				title={`Reject Expense — ${fmt(e.amt)}`}
				required
				onConfirm={async (remarks) => {
					await rejectExpense(e.id, remarks);
					toast("Expense rejected");
					refresh();
				}}
			/>
		);
	}

	// True running balance: each page's figures continue from the server's
	// balance for its newest row, so the top row of page 1 equals the ledger's net.
	const movementsWithBalance = movementsRowBalances && movementsRowBalances.length === movements.length
		? movements.map((m, i) => ({ m, balance: movementsRowBalances[i] }))
		: withRunningBalance(movements, movementsPageBalance);

	// Both downloads use whatever's currently in the filter state (date
	// range + category for movements) — never the loaded page's row count —
	// matching listCashMovementsPage's own filter params exactly.
	async function downloadMovements() { return singleFlight("cash:download-movements", async () => {
		setDownloadingMovements(true);
		try {
			await exportCashMovements({
				fromDate: movementsFrom || undefined,
				toDate: movementsTo || undefined,
				branchIds: movementsBranchIds.length ? movementsBranchIds : undefined,
				customerIds: movementsCustomerIds.length ? movementsCustomerIds : undefined,
				types: movementsTypes.length ? movementsTypes : undefined,
				modes: movementsModes.length ? movementsModes : undefined,
				categoryNames: movementsCategories.length ? movementsCategories : undefined,
				search: movementsSearch || undefined,
			});
		} catch {
			toast("Could not download cash movements — try again.");
		} finally {
			setDownloadingMovements(false);
		}
	}); }

	async function downloadExpenses() { return singleFlight("cash:download-expenses", async () => {
		setDownloadingExpenses(true);
		try {
			await exportExpenses(expenseListFilters);
		} catch {
			toast("Could not download the expense register — try again.");
		} finally {
			setDownloadingExpenses(false);
		}
	}); }

	return (
		<>
			<div className="page-h">
				{/* .page-h-title (flex:1;min-width:0, app.css) lets this block shrink
				 * and wrap its own subtitle instead of holding its full natural
				 * width and forcing the button cluster below onto its own line —
				 * same pattern as LoanDetail.modules/reminders/pages/CalendarPage.tsx. Without it, the title
				 * + subtitle's natural width plus the 3 buttons tipped `.page-h`
				 * past its wrap threshold on narrower screens well before the
				 * buttons actually ran out of room beside the title. */}
				<div className="page-h-title"><h1>Ledger</h1><p>Daily cash movements, balance in hand and {showBranch ? "branch expenses" : "expenses"}.</p></div>
				{/* .page-h-actions (app.css) rather than flat siblings of `.page-h`
				 * — its own margin-left:auto/justify-content:flex-end keeps all 3
				 * buttons right-aligned as a group even once they wrap to their
				 * own line, instead of a plain sibling wrap starting flush at
				 * `.page-h`'s left edge (which stranded "Record Expense" on its
				 * own line at the far left, disconnected from Take Cash Out/Add
				 * Cash beside the title). */}
				{canCreateCash && (
					<div className="page-h-actions">
						<button className="btn" onClick={() => openModal(<AddEntryModalContent onSaved={refresh} defaultBranchId={selectedBranchId ?? undefined} />)}><Icon name="plus" /> Add Entry</button>
					</div>
				)}
			</div>
			<hr className="gold-rule rule-sm" />

			<div className="cash-kpi-row" style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-start", gap: smallScreen ? 8 : 15, marginBottom: smallScreen?0:20  }}>
				<div className="kpis kpis-money" style={{ marginBottom: 0, maxWidth: 1113 }}>
					<Kpi l={`Opening Cash (${dayLabel})`} v={fmt(summary?.openingCash || 0)} s="carried forward" />
					{/* Backend's `collections` is every cash-in movement for the day —
							Savings top-ups, bank pledges and loan repayments alike, not just
							interest/principal (see cash.SummaryService.GetExpectedCash), so
							show `collectionsBreakdown` under the total rather than leaving the
							reader to guess what the one figure is made of. */}
					<Kpi
						l={`Cash In (${dayLabel})`}
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
						l={`Cash Out (${dayLabel})`}
						v={fmt(summary?.disbursements || 0)}
						parts={[
							["Loan disbursements", summary?.disbursementsBreakdown?.loanDisbursements || 0],
							["Bank releases", summary?.disbursementsBreakdown?.bankReleases || 0],
							["Auction refunds", summary?.disbursementsBreakdown?.auctionRefunds || 0],
							["Gold purchases", summary?.disbursementsBreakdown?.goldPurchases || 0],
							["Withdrawals", summary?.disbursementsBreakdown?.withdrawals || 0],
						]}
					/>
					<Kpi l={`Expenses (${dayLabel})`} v={fmt(summary?.expensesToday || 0)} s={fmt(summary?.cashExpenses || 0) + " cash"} />
					<Kpi
						l="Balance in Hand"
						v={fmt((summary?.cashInHand || 0) + (summary?.bankBalance || 0))}
						cls="ok"
						keepZero
						parts={[
							["Cash in hand", summary?.cashInHand || 0],
							["Bank balance", summary?.bankBalance || 0],
						]}
					/>
				</div>

				{/* Summary date sits top-right, in the space the KPI cards leave above the tabs. */}
				<div className="cash-side">
				<div className="cash-date-filter">
					{!isToday && <button type="button" className="btn plain sm" onClick={() => setSummaryDate("")}>Today</button>}
					<DatePicker value={today} onChange={(v) => setSummaryDate(v === realToday ? "" : v)} max={realToday} />
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
			</div>

			{activeCashTab === "movements" && (
				<div className="card tbl-card tbl-card-fill cash-tbl-card">
					<div className="hd" style={{ flexWrap: "wrap", rowGap: 10 }}>
						<h3>Ledger</h3>
						<div className="sp" />
						<div className="cash-filter-row" style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
							<TableSearch value={movementsQ} onChange={setMovementsQ} placeholder="Search date, ref no, party, bank, amount…" searches="date, ref no, particulars, mode, bank, party, debit, credit" />
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
									setMovementsModes(Array.isArray(next.mode) ? next.mode : []);
									setMovementsCategories(Array.isArray(next.category) ? next.category : []);
									setMovementsPage(1);
								}}
								hideChips
							/>
							{canExport && (
								<button className="btn ghost sm" onClick={downloadMovements} disabled={downloadingMovements} title="Download every row matching the current filters">
									<Icon name="download" /> {downloadingMovements ? "Preparing…" : "Download"}
								</button>
							)}
						</div>
					</div>
					<div className="tbl-wrap tbl-scroll">
						<table className="tbl tbl-center tbl-roomy tbl-stack ledger-nowrap ledger-amt" data-ledger-scope="cash-movements" data-ledger-page={movementsPage}>
							<TableCols widths={[11, 11, 30, 9, null, null, null]} />
							<thead><tr><th>Date</th><th>Ref No</th><th>Particulars</th><th>Mode</th><th className="num">Debit</th><th className="num">Credit</th><th className="num">Balance</th></tr></thead>
							<tbody>
								{!idsReady
									? <tr><td colSpan={7} className="empty">Loading…</td></tr>
									: movements.length
									? movementsWithBalance.map(({ m, balance }) => <MovementRow key={m.id} m={m} balance={balance} categoryIds={categoryIdByName} onChanged={refresh} />)
									: <tr><td colSpan={7} className="empty">No cash movements recorded yet. Use &quot;Add Cash&quot; or &quot;Take Cash Out&quot;.</td></tr>}
							</tbody>
						</table>
					</div>
					<ScrollSentinel enabled={cards && movementsHasMore} onVisible={more} watch={movements.length} />
					<div className="ft ft-static" style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
						{!cards && <button className="btn plain sm" disabled={movementsPage <= 1} onClick={() => setMovementsPage((p) => Math.max(1, p - 1))}>‹ Prev</button>}
						{/* No total-row count comes back from the {items, hasMore}
							* envelope — only whether another page exists — so this shows
							* just the current page rather than a fabricated "of N". */}
						{!cards && <span style={{ fontSize: 12.5 }}>Page {movementsPage} of {movementsTotalPages}</span>}
						{!cards && <button className="btn plain sm" disabled={movementsPage >= movementsTotalPages} onClick={() => setMovementsPage((p) => Math.min(movementsTotalPages, p + 1))}>Next ›</button>}
						<FooterTotals aligned items={[
							{ value: movementSums.debit, color: "var(--red)" },
							{ value: movementSums.credit, color: "var(--green)" },
						]} />
					</div>
				</div>
			)}

			{activeCashTab === "expenses" && (
				<div className="card tbl-card tbl-card-fill cash-tbl-card">
					<div className="hd" style={{ flexWrap: "wrap", rowGap: 10 }}>
						<h3>Expense Register</h3>
						<div className="sp" />
						<TableSearch value={expensesQ} onChange={setExpensesQ} placeholder="Search category, branch, amount…" searches="date, category, payee, amount, mode, branch, status, remarks" />
						<FilterPanel
							categories={expensesFilterCategories}
							value={expensesFilterValue}
							onChange={(next) => {
								setExpCategory(Array.isArray(next.category) ? next.category : []);
								setExpMode(Array.isArray(next.mode) ? next.mode : []);
								setExpStatus(Array.isArray(next.status) ? next.status : []);
								setExpFrom(next.__dateFrom || "");
								setExpTo(next.__dateTo || "");
							}}
							hideChips
						/>
						{canExport && (
							<button className="btn ghost sm" onClick={downloadExpenses} disabled={downloadingExpenses} title="Download every expense row">
								<Icon name="download" /> {downloadingExpenses ? "Preparing…" : "Download"}
							</button>
						)}
						<span style={{ fontSize: 12.5, color: "var(--muted)", marginLeft: 12 }}>Total {fmt(expenseSum)}</span>
					</div>
					<div className="tbl-wrap tbl-scroll">
						<table className="tbl tbl-center tbl-roomy tbl-stack" data-ledger-scope="cash-expenses" data-ledger-page={expensesPage}>
							<TableCols widths={[12, 22, 13, 11, ...(showBranch ? [14] : []), 12, 8, 8]} />
							<thead><tr><th>Date</th><th>Category</th><th className="num">Amount</th><th>Mode</th>{showBranch && <th>Branch</th>}<th>Status</th><th style={{ textAlign: "center" }}>Edit</th><th style={{ textAlign: "center" }}>Receipt</th></tr></thead>
							<tbody>
								{!idsReady
									? <tr><td colSpan={showBranch ? 8 : 7} className="empty">Loading…</td></tr>
									: expenses.length
									? expenses.map((e) => (
										<ExpenseRow
											key={e.id}
											e={e}
											categoryId={categoryIdByName[e.cat.toLowerCase()]}
											onViewReceipt={() => openModal(<ReceiptViewModalContent e={e} />, true)}
											canApprove={canUpdateCash && (canActAtStage({ role, isSystem }, expenseStage(e)) || (isSystem && !expenseStage(e)))}
											awaiting={expenseStage(e)?.label}
											busy={decidingExpenseId === e.id}
											onApprove={() => onApproveExpense(e)}
											onReject={() => onRejectExpense(e)}
											onEdit={() => openModal(<EditEntryModalContent entryId={e.id} viaExpense onSaved={refresh} />)}
											onEditPledge={canEditLedger && e.bankPledgeId && e.bankPledgeLoanId ? () => void pledgeActions.pledge(e.bankPledgeLoanId!, e.bankPledgeId!, "edit") : undefined}
										/>
									))
									: <tr><td colSpan={showBranch ? 8 : 7} className="empty">No expenses recorded yet.</td></tr>}
							</tbody>
						</table>
					</div>
					<ScrollSentinel enabled={cards && expensesHasMore} onVisible={more} watch={expenses.length} />
					<div className="ft ft-static" style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
						{!cards && <button className="btn plain sm" disabled={expensesPage <= 1} onClick={() => setExpensesPage((p) => Math.max(1, p - 1))}>‹ Prev</button>}
						{!cards && <span style={{ fontSize: 12.5 }}>Page {expensesPage} of {expensesTotalPages}</span>}
						{!cards && <button className="btn plain sm" disabled={expensesPage >= expensesTotalPages} onClick={() => setExpensesPage((p) => Math.min(expensesTotalPages, p + 1))}>Next ›</button>}
						<span style={{ fontSize: 12.5, color: "var(--muted)" }}></span>
						<FooterTotals items={[{ label: "Total", value: expenseSum, color: "var(--red)" }]} />
					</div>
				</div>
			)}

			{activeCashTab === "goldSales" && (
				<div className="card tbl-card tbl-card-fill cash-tbl-card">
					<div className="hd" style={{ flexWrap: "wrap", rowGap: 10 }}>
						<h3>Gold Sales</h3>
						<div className="sp" />
						<TableSearch value={goldSalesQ} onChange={setGoldSalesQ} placeholder="Search ornament, bank, amount…" searches="date, ornament type, sold for, cost, mode, bank, branch, remarks" />
						<FilterPanel
							categories={goldSalesFilterCategories}
							value={goldSalesFilterValue}
							onChange={(next) => {
								setSalesFrom(next.__dateFrom || "");
								setSalesTo(next.__dateTo || "");
							}}
							hideChips
						/>
						<span style={{ fontSize: 12.5, color: "var(--muted)" }}>
							Total profit {fmt(goldSales.reduce((s, g) => s + g.profit, 0))}
						</span>          </div>
					<div className="tbl-wrap tbl-scroll">
						<table className="tbl tbl-center tbl-roomy tbl-stack ledger-nowrap">
							<TableCols widths={[10, 14, 11, 11, 11, 9, 11, ...(showBranch ? [10] : []), 13]} />
							<thead><tr><th>Date</th><th>Ornament Type</th><th className="num">Sold For</th><th className="num">Cost</th><th className="num">Profit / Loss</th><th>Mode</th><th>Bank</th>{showBranch && <th>Branch</th>}<th>Remarks</th></tr></thead>
							<tbody>
								{goldSales.length
									? goldSales.map((g) => <GoldSaleRow key={g.id} g={g} />)
									: <tr><td colSpan={showBranch ? 9 : 8} className="empty">No gold sales recorded yet. Use &quot;Add Cash&quot; with the Gold Sale source.</td></tr>}
							</tbody>
						</table>
					</div>
					<ScrollSentinel enabled={cards && goldSalesHasMore} onVisible={more} watch={goldSales.length} />
					<div className="ft ft-static" style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "nowrap" }}>
						{!cards && <button className="btn plain sm" disabled={goldSalesPage <= 1} onClick={() => setGoldSalesPage((p) => Math.max(1, p - 1))}>‹ Prev</button>}
						{!cards && <span style={{ fontSize: 12.5 }}>Page {goldSalesPage} of {goldSalesTotalPages}</span>}
						{!cards && <button className="btn plain sm" disabled={goldSalesPage >= goldSalesTotalPages} onClick={() => setGoldSalesPage((p) => Math.min(goldSalesTotalPages, p + 1))}>Next ›</button>}
						<span
							title="Sold amount automatically books into Cash-in-Hand as a cash-in movement"
							style={{ fontSize: 12.5, color: "var(--muted)", flex: "1 1 0", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
						>
							Sold amount automatically books into Cash-in-Hand as a cash-in movement
						</span>
						<FooterTotals items={[
							{ label: "Total Sold", value: goldSaleSums.sold },
							{ label: "Total Cost", value: goldSaleSums.cost },
							{ label: "Total Profit", value: goldSaleSums.profit, color: goldSaleSums.profit >= 0 ? "var(--green)" : "var(--red)" },
						]} />
					</div>
				</div>
			)}
		</>
	);
}
