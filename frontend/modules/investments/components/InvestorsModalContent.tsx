"use client";

import { TableCols } from "@/common/components/ui/TableCols";
import { useEffect, useRef, useState } from "react";
import { Icon } from "@/common/components/Icon";
import { useModal } from "@/common/components/ModalProvider";
import { ApiError } from "@/common/services/httpClient";
import { navigate } from "@/common/services/appRoutes";
import { fmt, fmtDate } from "@/common/utils/format";
import { StatusChip } from "@/common/components/ui/StatusChip";
import { FilterPanel, type FilterCategory, type FilterValue } from "@/common/components/ui/FilterPanel";
import { getInvestor, listInvestorsPage, hardDeleteInvestor } from "@/modules/investments/services/investorService";
import { listInvestmentsForCustomer } from "@/modules/investments/services/investmentService";
import { DeleteWithBlockersModalContent, type DeleteBlocker } from "@/common/components/modals/DeleteWithBlockersModalContent";
import { routeHref } from "@/common/services/appRoutes";
import { useToast } from "@/common/components/ToastProvider";
import { type CustomerView } from "@/modules/customers/types/customer-types";
import { listInvestmentsPage } from "@/modules/investments/services/investmentService";
import { type BackendInvestment } from "@/modules/investments/types/investment-types";
import { CreateInvestorModalContent } from "@/modules/investments/components/CreateInvestorModalContent";
import { useAuth } from "@/common/providers/AuthProvider";

const PAGE_SIZE = 10;

type InvestorInvestmentsProps = { customerId: string; from: string; to: string };

/* One investor's investments, shown when their row is opened. The date filter narrows these by start date. */
function InvestorInvestments({ customerId, from, to }: InvestorInvestmentsProps) {
	const { closeModal } = useModal();
	const [items, setItems] = useState<BackendInvestment[] | null>(null);
	const [error, setError] = useState("");
	const [page, setPage] = useState(1);
	const [hasMore, setHasMore] = useState(false);
	const [loadingMore, setLoadingMore] = useState(false);
	const wrapRef = useRef<HTMLDivElement>(null);

	// A new investor or date range starts again from the first 10.
	useEffect(() => { setPage(1); setItems(null); }, [customerId, from, to]);

	useEffect(() => {
		let live = true;
		setLoadingMore(true);
		listInvestmentsPage({ page, customerId: Number.isFinite(Number(customerId)) && Number(customerId) > 0 ? Number(customerId) : customerId, from: from || undefined, to: to || undefined, pageSize: PAGE_SIZE })
			.then((res) => {
				if (!live) return;
				setItems((cur) => (page === 1 ? res?.items || [] : [...(cur || []), ...(res?.items || [])]));
				setHasMore(!!res?.hasMore);
			})
			.catch((e) => { if (live) setError(e instanceof ApiError ? e.message : "Could not load investments."); })
			.finally(() => { if (live) setLoadingMore(false); });
		return () => { live = false; };
	}, [customerId, from, to, page]);

	// The next 10 load as this list is scrolled to its end; a batch too short to overflow keeps loading.
	function onScroll() {
		const el = wrapRef.current;
		if (hasMore && !loadingMore && el && el.scrollHeight - el.scrollTop - el.clientHeight < 32) setPage((p) => p + 1);
	}
	useEffect(() => {
		const el = wrapRef.current;
		if (hasMore && !loadingMore && el && el.scrollHeight <= el.clientHeight) setPage((p) => p + 1);
	}, [items, hasMore, loadingMore]);

	if (error) return <div className="notice">{error}</div>;
	return (
		<div ref={wrapRef} onScroll={onScroll} className="inv-scroll" style={{ maxHeight: 240, overflowY: "auto" }}>
		<table className="tbl tbl-center tbl-cards-sm tbl-compact" style={{ margin: "4px 0 8px" }}>
			<TableCols widths={[18, 20, 14, 16, 16, 16]} />
			<thead><tr><th>Investment</th><th>Plan</th><th className="num">Principal</th><th>Start</th><th>Maturity</th><th>Status</th></tr></thead>
			<tbody>
				{items === null ? (
					<tr><td colSpan={6} className="empty compact">Loading…</td></tr>
				) : items.length === 0 ? (
					<tr><td colSpan={6} className="empty compact">{from || to ? "No investments in this date range." : "No investments yet."}</td></tr>
				) : items.map((i) => (
					<tr key={i.id} className="click" onClick={() => { closeModal(); navigate("investment/" + (i.investmentNumber || i.id)); }}>
						<td data-label="Investment"><span className="id">{i.investmentNumber}</span></td>
						<td data-label="Plan">{i.plan?.name || "—"}</td>
						<td className="num" data-label="Principal">{fmt(i.principalAmount)}</td>
						<td data-label="Start">{fmtDate(i.startDate)}</td>
						<td data-label="Maturity">{fmtDate(i.maturityDate)}</td>
						<td data-label="Status"><StatusChip status={i.status} /></td>
					</tr>
				))}
			</tbody>
		</table>
		</div>
	);
}

/* Every investor, each opening to the investments they hold. Filtered by investor name and by the investments'
 * start date; more investors load as the list is scrolled. */
export function InvestorsModalContent() {
	const { closeModal, openChildModal } = useModal();
  const toast = useToast();
  const { can } = useAuth();
  // Investors are managed with the investment permissions (they are their own records, not customers).
  const canCreateInvestor = can("Investment_Management", "can_create_investment");
  const canEditInvestor = can("Investment_Management", "can_update_investment");
  const canDeleteInvestor = can("Investment_Management", "can_delete_investment");
  const [reloadTick, setReloadTick] = useState(0);
	const [investorIds, setInvestorIds] = useState<string[]>([]);
	const [from, setFrom] = useState("");
	const [to, setTo] = useState("");
	const [investors, setInvestors] = useState<CustomerView[]>([]);
	const [page, setPage] = useState(1);
	const [hasMore, setHasMore] = useState(false);
	const [total, setTotal] = useState(0);
	const [error, setError] = useState("");
	const [openId, setOpenId] = useState<string | null>(null);
	const investorKey = investorIds.join(",");
	// Loading until the request for the current filter + page has answered.
	const reqKey = `${investorKey}|${page}`;
	const [loadedKey, setLoadedKey] = useState("");
	const loading = loadedKey !== reqKey;

	const filterCategories: FilterCategory[] = [
		{
			key: "investor", label: "Investor", kind: "async", searchHint: "Searches: investor name, code, phone",
			fetchOptions: (search: string, p: number) =>
        listInvestorsPage(search, p, undefined, 20).then((res) => ({ items: res.items.map((c) => ({ value: c.id, label: `${c.name} (${c.code})` })), hasMore: res.hasMore })),
		},
		{ key: "__date", label: "Start date", kind: "date" },
	];
	const filterValue: FilterValue = { investor: investorIds, __dateFrom: from || undefined, __dateTo: to || undefined };

	// Picked investors are loaded by id; otherwise investors are paged, each page added to the list.
	useEffect(() => {
		let live = true;
		const load = investorIds.length
      ? Promise.all(investorIds.map((id) => getInvestor(id))).then((items) => ({ items, hasMore: false, total: items.length }))
      : listInvestorsPage("", page, undefined, PAGE_SIZE);
		load
			.then((res) => {
				if (!live) return;
				setInvestors(res.items);
				setHasMore(res.hasMore);
				setTotal(res.total);
				setError("");
			})
			.catch((e) => { if (live) setError(e instanceof ApiError ? e.message : "Could not load investors."); })
			.finally(() => { if (live) setLoadedKey(reqKey); });
		return () => { live = false; };
		// eslint-disable-next-line react-hooks/exhaustive-deps -- investorIds is tracked by its joined key
  }, [investorKey, page, reloadTick]);

	const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
	function goTo(p: number) { setOpenId(null); setPage(p); }

	return (
		<>
			<div className="hd"><h3>Investors</h3><button className="x" onClick={closeModal}>×</button></div>
			<div className="bd">
				<div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 10, marginBottom: 10 }}>
          {canCreateInvestor && <button className="btn sm" onClick={() => openChildModal(<CreateInvestorModalContent onCreated={() => { closeModal(); setReloadTick((n) => n + 1); }} />)}>+ New Investor</button>}
					<FilterPanel
						categories={filterCategories}
						value={filterValue}
						onChange={(next) => {
							setInvestorIds(Array.isArray(next.investor) ? next.investor : []);
							setFrom(next.__dateFrom || "");
							setTo(next.__dateTo || "");
							setPage(1);
							setOpenId(null);
						}}
					/>
				</div>
				{error && <div className="notice">{error}</div>}
				<div className="tbl-wrap tbl-wrap-auto tbl-scroll-paged"><table className="tbl tbl-cards-sm tbl-compact">
          <TableCols widths={[38, 24, 22, 16]} />
          <thead><tr><th>Investor</th><th>Phone</th><th>Branch</th><th></th></tr></thead>
					<tbody>
						{loading && investors.length === 0 ? (
							<tr><td colSpan={4} className="empty compact">Loading…</td></tr>
						) : investors.length === 0 ? (
							<tr><td colSpan={4} className="empty compact">No investors yet.</td></tr>
						) : investors.map((c) => (
              <InvestorRows
                key={c.id}
                investor={c}
                open={openId === c.id}
                onToggle={() => setOpenId(openId === c.id ? null : c.id)}
                from={from}
                to={to}
                onEdit={canEditInvestor ? () => openChildModal(<CreateInvestorModalContent edit={c} onCreated={() => { closeModal(); toast("Investor updated"); setReloadTick((n) => n + 1); }} />) : undefined}
                onDelete={canDeleteInvestor ? () => {
                  // Investments still held block the delete; they are listed as links and the list refreshes by itself.
                  const loadBlockers = async (): Promise<DeleteBlocker[]> =>
                    (await listInvestmentsForCustomer(Number(c.id))).map((i) => ({
                      key: String(i.id), kind: "Investment", ref: i.investmentNumber, status: i.status, href: routeHref("investment", String(i.id)),
                    }));
                  openChildModal(
                    <DeleteWithBlockersModalContent
                      title="Delete Investor Permanently"
                      name={c.name}
                      code={c.code}
                      loadBlockers={loadBlockers}
                      blockedHint="Close and delete these investments first (they open in a new tab), then come back — this updates by itself."
                      onDelete={async () => {
                        await hardDeleteInvestor(c.id);
                        toast("Investor deleted permanently");
                        setOpenId(null);
                        setReloadTick((n) => n + 1);
                      }}
                    />
                  );
                } : undefined}
              />
						))}
					</tbody>
				</table></div>
				<div style={{ display: "flex", alignItems: "center", justifyContent: "center", flexWrap: "wrap", gap: 10, marginTop: 10 }}>
					<button className="btn plain sm" disabled={page <= 1 || loading} onClick={() => goTo(page - 1)}>‹ Prev</button>
					<span style={{ fontSize: 12.5 }}>Page {page} of {totalPages}</span>
					<span style={{ fontSize: 12.5, color: "var(--muted)" }}>· {total.toLocaleString("en-IN")} {total === 1 ? "investor" : "investors"}</span>
					<button className="btn plain sm" disabled={!hasMore || loading} onClick={() => goTo(page + 1)}>Next ›</button>
				</div>
			</div>
		</>
	);
}

type InvestorRowsProps = { investor: CustomerView; open: boolean; onToggle: () => void; from: string; to: string; onEdit?: () => void; onDelete?: () => void };

function InvestorRows({ investor, open, onToggle, from, to, onEdit, onDelete }: InvestorRowsProps) {
	return (
		<>
			<tr className="click" onClick={onToggle} aria-expanded={open}>
				<td><span className="id">{investor.code}</span><span className="sub">{investor.name}</span></td>
				<td data-label="Phone">{investor.phone || "—"}</td>
				<td data-label="Branch">{investor.branchName || "—"}</td>
        <td className="td-chev" style={{ whiteSpace: "nowrap" }}>
          <div style={{ display: "inline-flex", alignItems: "center", gap: 6, justifyContent: "flex-end" }}>
            {onEdit && <button type="button" title="Edit investor" aria-label="Edit investor" onClick={(e) => { e.stopPropagation(); onEdit(); }} style={{ border: 0, background: "none", cursor: "pointer", padding: 4, color: "var(--muted)", display: "inline-flex", alignItems: "center" }}><Icon name="edit" /></button>}
            {onDelete && <button type="button" title="Delete investor" aria-label="Delete investor" onClick={(e) => { e.stopPropagation(); onDelete(); }} style={{ border: 0, background: "none", cursor: "pointer", padding: 4, color: "var(--red)", display: "inline-flex", alignItems: "center" }}><Icon name="trash" /></button>}
            <Icon name="chevronDown" style={{ transform: open ? "rotate(180deg)" : undefined, transition: "transform .15s", verticalAlign: "middle" }} />
          </div>
        </td>
			</tr>
			{open && (
				<tr><td colSpan={4} style={{ background: "var(--brand-faint)" }}>
					<InvestorInvestments customerId={investor.id} from={from} to={to} />
				</td></tr>
			)}
		</>
	);
}
