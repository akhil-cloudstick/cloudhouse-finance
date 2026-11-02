"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "@/common/components/Icon";
import { useModal } from "@/common/components/ModalProvider";
import { ApiError } from "@/common/services/httpClient";
import { navigate } from "@/common/services/appRoutes";
import { fmt, fmtDate } from "@/common/utils/format";
import { StatusChip } from "@/common/components/ui/StatusChip";
import { FilterPanel, type FilterCategory, type FilterValue } from "@/common/components/ui/FilterPanel";
import { getCustomer, listCustomersPage } from "@/modules/customers/services/customerService";
import { type CustomerView } from "@/modules/customers/types/customer-types";
import { listInvestmentsPage } from "@/modules/investments/services/investmentService";
import { type BackendInvestment } from "@/modules/investments/types/investment-types";

const PAGE_SIZE = 10;

type InvestorInvestmentsProps = { customerId: string; from: string; to: string };

/* One investor's investments, shown when their row is opened. The date filter narrows these by start date. */
function InvestorInvestments({ customerId, from, to }: InvestorInvestmentsProps) {
  const { closeModal } = useModal();
  const [items, setItems] = useState<BackendInvestment[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let live = true;
    listInvestmentsPage({ page: 1, customerId: Number(customerId), from: from || undefined, to: to || undefined, pageSize: 50 })
      .then((res) => { if (live) setItems(res?.items || []); })
      .catch((e) => { if (live) setError(e instanceof ApiError ? e.message : "Could not load investments."); });
    return () => { live = false; };
  }, [customerId, from, to]);

  if (error) return <div className="notice">{error}</div>;
  return (
    <table className="tbl tbl-center" style={{ margin: "4px 0 8px" }}>
      <thead><tr><th>Investment</th><th>Plan</th><th className="num">Principal</th><th>Start</th><th>Maturity</th><th>Status</th></tr></thead>
      <tbody>
        {items === null ? (
          <tr><td colSpan={6} className="empty compact">Loading…</td></tr>
        ) : items.length === 0 ? (
          <tr><td colSpan={6} className="empty compact">{from || to ? "No investments in this date range." : "No investments yet."}</td></tr>
        ) : items.map((i) => (
          <tr key={i.id} className="click" onClick={() => { closeModal(); navigate("investment/" + (i.investmentNumber || i.id)); }}>
            <td><span className="id">{i.investmentNumber}</span></td>
            <td>{i.plan?.name || "—"}</td>
            <td className="num">{fmt(i.principalAmount)}</td>
            <td>{fmtDate(i.startDate)}</td>
            <td>{fmtDate(i.maturityDate)}</td>
            <td><StatusChip status={i.status} /></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/* Every investor, each opening to the investments they hold. Filtered by investor name and by the investments'
 * start date; more investors load as the list is scrolled. */
export function InvestorsModalContent() {
  const { closeModal } = useModal();
  const [investorIds, setInvestorIds] = useState<string[]>([]);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [investors, setInvestors] = useState<CustomerView[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const investorKey = investorIds.join(",");
  // Loading until the request for the current filter + page has answered.
  const reqKey = `${investorKey}|${page}`;
  const [loadedKey, setLoadedKey] = useState("");
  const loading = loadedKey !== reqKey;

  const filterCategories: FilterCategory[] = [
    {
      key: "investor", label: "Investor", kind: "async", searchHint: "Searches: investor name, code, phone",
      fetchOptions: (search: string, p: number) =>
        listCustomersPage(search, p, { customerType: "Investor" }, 20).then((res) => ({ items: res.items.map((c) => ({ value: c.id, label: `${c.name} (${c.code})` })), hasMore: res.hasMore })),
    },
    { key: "__date", label: "Start date", kind: "date" },
  ];
  const filterValue: FilterValue = { investor: investorIds, __dateFrom: from || undefined, __dateTo: to || undefined };

  // Picked investors are loaded by id; otherwise investors are paged, each page added to the list.
  useEffect(() => {
    let live = true;
    const load = investorIds.length
      ? Promise.all(investorIds.map((id) => getCustomer(id))).then((items) => ({ items, hasMore: false }))
      : listCustomersPage("", page, { customerType: "Investor" }, PAGE_SIZE);
    load
      .then((res) => {
        if (!live) return;
        setInvestors((cur) => (page === 1 || investorIds.length ? res.items : [...cur, ...res.items]));
        setHasMore(res.hasMore);
        setError("");
      })
      .catch((e) => { if (live) setError(e instanceof ApiError ? e.message : "Could not load investors."); })
      .finally(() => { if (live) setLoadedKey(reqKey); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- investorIds is tracked by its joined key
  }, [investorKey, page]);

  function onWrapScroll() {
    const el = wrapRef.current;
    if (hasMore && !loading && el && el.scrollHeight - el.scrollTop - el.clientHeight < 48) setPage((p) => p + 1);
  }

  return (
    <>
      <div className="hd"><h3>Investors</h3><button className="x" onClick={closeModal}>×</button></div>
      <div className="bd">
        <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 10 }}>
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
        <div className="tbl-wrap tbl-wrap-auto tbl-scroll-paged" ref={wrapRef} onScroll={onWrapScroll}><table className="tbl">
          <thead><tr><th>Investor</th><th>Phone</th><th>Branch</th><th style={{ width: 40 }}></th></tr></thead>
          <tbody>
            {loading && investors.length === 0 ? (
              <tr><td colSpan={4} className="empty compact">Loading…</td></tr>
            ) : investors.length === 0 ? (
              <tr><td colSpan={4} className="empty compact">No investors yet.</td></tr>
            ) : investors.map((c) => (
              <InvestorRows key={c.id} investor={c} open={openId === c.id} onToggle={() => setOpenId(openId === c.id ? null : c.id)} from={from} to={to} />
            ))}
          </tbody>
        </table></div>
      </div>
    </>
  );
}

type InvestorRowsProps = { investor: CustomerView; open: boolean; onToggle: () => void; from: string; to: string };

function InvestorRows({ investor, open, onToggle, from, to }: InvestorRowsProps) {
  return (
    <>
      <tr className="click" onClick={onToggle} aria-expanded={open}>
        <td><span className="id">{investor.code}</span><span className="sub">{investor.name}</span></td>
        <td>{investor.phone || "—"}</td>
        <td>{investor.branchName || "—"}</td>
        <td><Icon name="chevronDown" style={{ transform: open ? "rotate(180deg)" : undefined, transition: "transform .15s" }} /></td>
      </tr>
      {open && (
        <tr><td colSpan={4} style={{ background: "var(--brand-faint)" }}>
          <InvestorInvestments customerId={investor.id} from={from} to={to} />
        </td></tr>
      )}
    </>
  );
}
