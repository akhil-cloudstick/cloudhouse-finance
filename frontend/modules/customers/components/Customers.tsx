"use client";

import { useEffect, useState } from "react";
import { useData } from "@/common/DataProvider";
import { useCustomers } from "@/modules/customers/store/CustomersProvider";
import { useModal } from "@/common/components/Modal";
import { StatusChip } from "@/common/components/ui/StatusChip";
import { Icon } from "@/common/components/Icon";
import { RegisterCustomerModalContent } from "@/common/components/modals/RegisterCustomerModal";
import { listCustomersPage, type CustomerView } from "@/modules/customers/services/customerService";

/* Ported from legacy/app.js's `renderCustomers()`. Loads real data from the
 * Go backend (`GET /api/v1/customers`) instead of the localStorage mock
 * store — see the Customer Module stage-1 plan. Loan counts still come
 * from the mock `db.loans` (the Loan module itself is out of scope here).
 *
 * The table below is paginated (10/page, one API call per page) via
 * listCustomersPage — kept separate from CustomersProvider's `customers`,
 * which other pages (GlobalSearch, New Loan's picker) still rely on as a
 * single fetch-once-and-refresh full list. `customers.length` from the
 * provider is only used for the header's overview count. */
export function Customers() {
  const { db } = useData();
  const { customers, refresh: refreshAll } = useCustomers();
  const { openModal } = useModal();
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<CustomerView[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => { setPage(1); }, [q]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const handle = setTimeout(() => {
      listCustomersPage(q.trim(), page)
        .then((res) => { if (!cancelled) { setRows(res.items); setHasMore(res.hasMore); setError(""); } })
        .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load customers."); })
        .finally(() => { if (!cancelled) setLoading(false); });
    }, 300);
    return () => { cancelled = true; clearTimeout(handle); };
  }, [q, page]);

  function refresh() {
    refreshAll();
    // Re-run the current page's query rather than resetting to page 1, so
    // registering/editing a customer doesn't bounce the viewer's place.
    setPage((p) => p);
    listCustomersPage(q.trim(), page)
      .then((res) => { setRows(res.items); setHasMore(res.hasMore); setError(""); })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load customers."));
  }

  const totalPages = hasMore ? page + 1 : page;

  return (
    <>
      <div className="page-h">
        <div><h1>Customers &amp; KYC</h1><p>{customers.length} customers · PAN &amp; Aadhaar verification status</p></div>
        <div className="sp" />
        <div className="search"><Icon name="search" /><input className="inp" placeholder="Search name, phone, ID…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <button className="btn" onClick={() => openModal(<RegisterCustomerModalContent onSaved={refresh} />)}>
          <Icon name="plus" /> Register Customer
        </button>
      </div>
      <hr className="gold-rule" />
      {error && (
        <p style={{ color: "var(--red)", fontSize: 13.5 }}>
          Could not reach the server — {error}
          <button className="btn plain sm" style={{ marginLeft: 8 }} onClick={refresh}>Retry</button>
        </p>
      )}
      <div className="card"><div className="tbl-wrap tbl-scroll"><table className="tbl tbl-center">
        <thead><tr><th>Customer</th><th>Contact</th><th>Branch</th><th>PAN</th><th>Aadhaar</th><th>KYC Status</th><th className="num">Loans</th><th></th></tr></thead>
        <tbody>
          {loading ? (
            <tr><td colSpan={8} className="empty">Loading customers…</td></tr>
          ) : rows.length === 0 ? (
            <tr><td colSpan={8} className="empty">{error ? "—" : "No customers match your search."}</td></tr>
          ) : rows.map((c) => (
            <tr className="click" key={c.id} onClick={() => { location.hash = "customer/" + c.id; }}>
              <td><span className="id">{c.code}</span><span className="sub" style={{ fontSize: 13.5, color: "var(--charcoal)", fontWeight: 500 }}>{c.name}</span></td>
              <td>{c.phone}<span className="sub">{c.address}</span></td>
              <td>{c.branchName}</td>
              <td><StatusChip status={c.panStatus} /></td>
              <td><StatusChip status={c.aadhaarStatus} /></td>
              <td><StatusChip status={c.kycStatus} /></td>
              <td className="num">{db.loans.filter((l) => l.cust === c.id).length}</td>
              <td style={{ textAlign: "right", color: "var(--gold-deep)" }}>›</td>
            </tr>
          ))}
        </tbody>
      </table></div>
      <div className="ft" style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <button className="btn plain sm" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>‹ Prev</button>
        <span style={{ fontSize: 12.5 }}>Page {page} of {totalPages}</span>
        <button className="btn plain sm" disabled={page >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))}>Next ›</button>
      </div>
      </div>
    </>
  );
}
