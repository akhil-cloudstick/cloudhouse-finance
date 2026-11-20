"use client";

import { useEffect, useState } from "react";
import { useModal } from "@/common/components/ModalProvider";
import { Icon } from "@/common/components/Icon";
import { useAuth } from "@/common/providers/AuthProvider";
import { BankModalContent } from "@/modules/banks/components/BankModalContent";
import { BankTable } from "@/modules/banks/components/BankTable";
import { TableSearch } from "@/common/components/ui/TableSearch";
import { FilterPanel, type FilterCategory, type FilterValue } from "@/common/components/ui/FilterPanel";
import { useShowBranch } from "@/common/hooks/use-branch-switch";
import { listActiveBranches } from "@/modules/branches/services/branchService";
import type { BranchView } from "@/modules/branches/types/branch-types";
import { usePersistedState } from "@/common/hooks/use-persisted-state";
import { balanceColor, fmtBalance } from "@/modules/banks/utils/bankBalance";

/* Centralized bank management — mirrors Branches.tsx exactly (simple CRUD
 * table). Unlike Branches, deleting a bank really deletes it (hard delete,
 * guarded by a reference count) rather than deactivating it — see backend
 * Service.Delete's doc comment — so a bank still referenced by history is
 * blocked with a warning naming how many transactions/pledges are linked,
 * pointing staff at "Merge" instead.
 *
 * Paginated server-side via listBanksPage (GET /banks?limit=&offset=) —
 * same {items, hasMore, total} envelope as Loans.tsx's listLoansPage. */
export function BanksPage() {
	const { openModal } = useModal();
	const { can } = useAuth();
	const canCreate = can("Bank_Management", "can_create_bank");
	const [reloadKey, setReloadKey] = useState(0);
	const [q, setQ] = usePersistedState("banks:q", "");
	const [branchFilter, setBranchFilter] = usePersistedState("banks:branch", "");
	const showBranch = useShowBranch();
	const [branches, setBranches] = useState<BranchView[]>([]);
	useEffect(() => { listActiveBranches().then(setBranches).catch(() => {}); }, []);
	// Banks have no status or type, so the lender's own (business) branch is the only filter.
	const filterCategories: FilterCategory[] = showBranch && branches.length
		? [{ key: "branch", label: "Branch", kind: "static", options: branches.map((b) => ({ value: String(b.id), label: b.name })) }]
		: [];
	// Several branches are kept comma-joined, the form the API takes them in.
	const filterValue: FilterValue = { branch: branchFilter ? branchFilter.split(",") : [] };
	const reload = () => setReloadKey((k) => k + 1);
	// Net balance across every listed bank — the server's `totalBalance` from
	// the same GET /banks response the table renders, so it always equals the
	// sum of the Balance column (scoped by the global branch selection). Null
	// (card hidden) until the list has loaded.
	const [bankBalance, setBankBalance] = useState<number | null>(null);

	return (
		<>
			<div className="page-h">
				<div><h1>Bank Management</h1><p>Add, edit and manage the banks used for re-pledging gold, split payments and the Party Transactions ledger</p></div>
				<div className="sp" />
				<TableSearch value={q} onChange={setQ} placeholder="Search banks…" searches="bank name, bank branch, IFSC, account no., phone, business branch" />
				{canCreate && <button className="btn" onClick={() => openModal(<BankModalContent onSaved={reload} />)}><Icon name="plus" /> Add Bank</button>}
			</div>
			<hr className="gold-rule" />
			{/* The net balance card and the filter share one row: card on the left, filter on the right. */}
			<div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginBottom: 10 }}>
				{bankBalance !== null ? (
					<div className="kpis" style={{ margin: 0 }}>
						<div className="kpi"><div className="l">Net Bank Balance</div><div className="v" style={{ color: balanceColor(bankBalance) }}>{fmtBalance(bankBalance)}</div></div>
					</div>
				) : <span />}
				{filterCategories.length > 0 && (
					<FilterPanel
						categories={filterCategories}
						value={filterValue}
						onChange={(next) => setBranchFilter(Array.isArray(next.branch) ? next.branch.join(",") : "")}
						hideChips
					/>
				)}
			</div>
			<BankTable q={q} branchId={branchFilter} reloadKey={reloadKey} afterChange={reload} onTotalBalance={setBankBalance} />
		</>
	);
}
