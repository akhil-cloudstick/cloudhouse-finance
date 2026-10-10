"use client";

import { usePersistedState } from "@/common/hooks/use-persisted-state";
import { useEffect, useState } from "react";
import { useCustomers } from "@/modules/customers/store/CustomersProvider";
import { useLoans } from "@/modules/loans/store/LoansProvider";
import { useModal } from "@/common/components/ModalProvider";
import { StatusChip } from "@/common/components/ui/StatusChip";
import { Icon } from "@/common/components/Icon";
import { RegisterCustomerModalContent } from "@/common/components/modals/RegisterCustomerModalContent";
import { listCustomersPage } from "@/modules/customers/services/customerService";
import { type CustomerView } from "@/modules/customers/types/customer-types";
import { FilterPanel, type FilterCategory, type FilterValue } from "@/common/components/ui/FilterPanel";
import { useAuth } from "@/common/providers/AuthProvider";
import { useResponsivePageSize, useIsSmallScreen } from "@/common/utils/responsive";
import { navigate } from "@/common/services/appRoutes";
import { useShowBranch } from "@/common/hooks/use-branch-switch";

const VERIFICATION_STATUS_OPTIONS = [
  { value: "Verified", label: "Verified" },
  { value: "Pending", label: "Pending" },
  { value: "Failed", label: "Failed" },
  { value: "Name Mismatch", label: "Name Mismatch" },
];

/* Ported from legacy/app.js's `renderCustomers()`. Loads real data from the
 * Go backend (`GET /api/v1/customers`) instead of the localStorage mock
 * store — see the Customer Module stage-1 plan. Loan counts come from the
 * real backend-backed `useLoans()`.
 *
 * The table below is paginated (10/page, one API call per page) via
 * listCustomersPage — kept separate from CustomersProvider's `customers`,
 * which other pages (GlobalSearch, New Loan's picker) still rely on as a
 * single fetch-once-and-refresh full list. `customers.length` from the
 * provider is only used for the header's overview count. */
export function CustomersPage() {
  const { loans } = useLoans();
  const { customers, refresh: refreshAll } = useCustomers();
  const { openModal } = useModal();
  const pageSize = useResponsivePageSize(15, 15);
  const smallScreen = useIsSmallScreen();
  // Action buttons are hidden outright when the role doesn't hold the
  // permission behind them — a disabled-looking control the user can never
  // use is worse than no control at all (house standard §12).
  const { can } = useAuth();
  const showBranch = useShowBranch();
  const canCreateCustomers = can("Customer_Management", "can_create_customer");
  const [q, setQ] = usePersistedState("customers:q", "");
  const [panStatus, setPanStatus] = usePersistedState("customers:pan", "");
  const [aadhaarStatus, setAadhaarStatus] = usePersistedState("customers:aadhaar", "");
  const [page, setPage] = useState(1);
  // One grouped filter: PAN and Aadhaar verification status (single choice each).
  const filterCategories: FilterCategory[] = [
    { key: "pan", label: "PAN Verified", kind: "static", singleSelect: true, options: VERIFICATION_STATUS_OPTIONS },
    { key: "aadhaar", label: "Aadhaar Verified", kind: "static", singleSelect: true, options: VERIFICATION_STATUS_OPTIONS },
  ];
  const filterValue: FilterValue = { pan: panStatus ? [panStatus] : [], aadhaar: aadhaarStatus ? [aadhaarStatus] : [] };
  const [rows, setRows] = useState<CustomerView[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  useEffect(() => { setPage(1); }, [q, panStatus, aadhaarStatus, pageSize]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const handle = setTimeout(() => {
      listCustomersPage(q.trim(), page, { panStatus, aadhaarStatus }, pageSize)
        .then((res) => { if (!cancelled) { setRows(res.items); setHasMore(res.hasMore); setTotal(res.total); setError(""); } })
        .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load customers."); })
        .finally(() => { if (!cancelled) setLoading(false); });
    }, 300);
    return () => { cancelled = true; clearTimeout(handle); };
  }, [q, panStatus, aadhaarStatus, page, pageSize]);

  function refresh() {
    refreshAll();
    // Re-run the current page's query rather than resetting to page 1, so
    // registering/editing a customer doesn't bounce the viewer's place.
    setPage((p) => p);
    listCustomersPage(q.trim(), page, { panStatus, aadhaarStatus })
      .then((res) => { setRows(res.items); setHasMore(res.hasMore); setTotal(res.total); setError(""); })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load customers."));
  }

  return (
    <>
      <div className="page-h">
        <div><h1>Customers &amp; KYC</h1><p>{customers.length} customers · PAN &amp; Aadhaar verification status</p></div>
        <div className="sp" />
        <div className="search"><Icon name="search" /><input className="inp" placeholder="Search name, phone, ID…" title="Searches: customer name, customer code, phone" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        {canCreateCustomers && (
          <button className="btn" onClick={() => openModal(<RegisterCustomerModalContent onSaved={refresh} />, true)}>
            <Icon name="plus" /> Register Customer
          </button>
        )}
      </div>
      <hr className="gold-rule" style={{ margin: "4px 0 10px" }} />
      {error && (
        <p style={{ color: "var(--red)", fontSize: 13.5 }}>
          Something went wrong. Please try again later.
        </p>
      )}
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 12 }}>
        <FilterPanel
          categories={filterCategories}
          value={filterValue}
          onChange={(next) => {
            setPanStatus(Array.isArray(next.pan) ? next.pan[0] || "" : "");
            setAadhaarStatus(Array.isArray(next.aadhaar) ? next.aadhaar[0] || "" : "");
          }}
          hideChips
          hideClearAll
        />
      </div>
      <div className="card tbl-card tbl-card-fill tbl-rounded">
      <div className="tbl-wrap tbl-scroll"><table className="tbl tbl-center col1-left">
        <thead><tr><th>Customer</th><th>Contact</th>{showBranch && <th>Branch</th>}<th>PAN</th><th>Aadhaar</th><th>KYC Status</th><th className="num">Loans</th><th></th></tr></thead>
        <tbody>
          {loading ? (
            <tr><td colSpan={showBranch ? 8 : 7} className="empty">Loading customers…</td></tr>
          ) : rows.length === 0 ? (
            <tr><td colSpan={showBranch ? 8 : 7} className="empty">{error ? "—" : "No customers match your search."}</td></tr>
          ) : rows.map((c) => (
            <tr className="click" key={c.id} onClick={() => { navigate("customer/" + c.id); }}>
              <td><span className="id">{c.code}</span><span className="sub" style={{ fontSize: 13.5, color: "var(--nav)", fontWeight: 500 }}>{c.name}</span></td>
              <td>{c.phone || "—"}<span className="sub">{c.address}</span></td>
              {showBranch && <td>{c.branchName}</td>}
              <td><StatusChip status={c.panStatus} /></td>
              <td><StatusChip status={c.aadhaarStatus} /></td>
              <td><StatusChip status={c.kycStatus} /></td>
              <td className="num">{loans.filter((l) => String(l.customerId) === String(c.id)).length}</td>
              <td style={{ textAlign: "right", color: "var(--brand-deep)" }}>›</td>
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
