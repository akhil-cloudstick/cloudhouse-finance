"use client";

import { ScrollSentinel } from "@/common/components/ui/ScrollSentinel";
import { usePersistedState, usePersistedPage, useResetPageOnChange } from "@/common/hooks/use-persisted-state";
import { useEffect, useState } from "react";
import { useCustomers } from "@/modules/customers/store/CustomersProvider";
import { useModal } from "@/common/components/ModalProvider";
import { StatusChip } from "@/common/components/ui/StatusChip";
import { Icon } from "@/common/components/Icon";
import { RegisterCustomerModalContent } from "@/common/components/modals/RegisterCustomerModalContent";
import { listCustomersPage } from "@/modules/customers/services/customerService";
import { type CustomerView } from "@/modules/customers/types/customer-types";
import { FilterPanel, type FilterCategory, type FilterValue } from "@/common/components/ui/FilterPanel";
import { useAuth } from "@/common/providers/AuthProvider";
import { useResponsivePageSize, useScrollPageSize, useIsSmallScreen } from "@/common/utils/responsive";
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
 * store — see the Customer Module stage-1 plan. Loan counts come with each
 * page (`loanCount`, one grouped server query).
 *
 * The table below is paginated (one API call per page) via listCustomersPage;
 * the header's overview count is the server total of an unfiltered query. */
export function CustomersPage() {
  const { version, refresh: refreshAll } = useCustomers();
  // Header count: all customers, independent of the search/filters below.
  const [allCount, setAllCount] = useState(0);
  useEffect(() => {
    listCustomersPage("", 1, { customerType: "Borrower" }, 1)
      .then((res) => setAllCount(res.total))
      .catch(() => setAllCount(0));
  }, [version]);
  const { openModal } = useModal();
  const basePageSize = useResponsivePageSize(15, 15);
  const { cards, size: pageSize, more } = useScrollPageSize(basePageSize);
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
  const [page, setPage] = usePersistedPage("customers");
  // One grouped filter: PAN and Aadhaar verification status (single choice each).
  const filterCategories: FilterCategory[] = [
    { key: "pan", label: "PAN Verified", kind: "static", options: VERIFICATION_STATUS_OPTIONS },
    { key: "aadhaar", label: "Aadhaar Verified", kind: "static", options: VERIFICATION_STATUS_OPTIONS },
  ];
  const filterValue: FilterValue = { pan: panStatus ? panStatus.split(",") : [], aadhaar: aadhaarStatus ? aadhaarStatus.split(",") : [] };
  const [rows, setRows] = useState<CustomerView[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  useResetPageOnChange(setPage, [q, panStatus, aadhaarStatus, pageSize]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const handle = setTimeout(() => {
      listCustomersPage(q.trim(), page, { panStatus, aadhaarStatus, customerType: "Borrower" }, pageSize)
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
    listCustomersPage(q.trim(), page, { panStatus, aadhaarStatus, customerType: "Borrower" })
      .then((res) => { setRows(res.items); setHasMore(res.hasMore); setTotal(res.total); setError(""); })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load customers."));
  }

  return (
    <>
      <div className="page-h">
        <div><h1>Customers &amp; KYC</h1><p>{allCount} customers · PAN &amp; Aadhaar verification status</p></div>
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
            setPanStatus(Array.isArray(next.pan) ? next.pan.join(",") : "");
            setAadhaarStatus(Array.isArray(next.aadhaar) ? next.aadhaar.join(",") : "");
          }}
          hideChips
          hideClearAll
        />
      </div>
      <div className="card tbl-card tbl-card-fill tbl-rounded">
      <div className="tbl-wrap tbl-scroll"><table className="tbl tbl-center col1-left tbl-cards">
        <thead><tr><th>Customer</th><th>Contact</th>{showBranch && <th>Branch</th>}<th>PAN</th><th>Aadhaar</th><th>KYC Status</th><th className="num">Loans</th><th></th></tr></thead>
        <tbody>
          {loading && !(cards && rows.length > 0) ? (
            <tr><td colSpan={showBranch ? 8 : 7} className="empty">Loading customers…</td></tr>
          ) : rows.length === 0 ? (
            <tr><td colSpan={showBranch ? 8 : 7} className="empty">{error ? "—" : "No customers match your search."}</td></tr>
          ) : rows.map((c) => (
            <tr className="click" key={c.id} onClick={() => { navigate("customer/" + (c.code || c.id)); }}>
              <td data-label="Customer"><span className="id">{c.code}</span><span className="sub" style={{ fontSize: 13.5, color: "var(--nav)", fontWeight: 500 }}>{c.name}</span></td>
              <td data-label="Contact">{c.phone || "—"}<span className="sub">{c.address}</span></td>
              {showBranch && <td data-label="Branch">{c.branchName}</td>}
              <td data-label="PAN"><StatusChip status={c.panStatus} /></td>
              <td data-label="Aadhaar"><StatusChip status={c.aadhaarStatus} /></td>
              <td data-label="KYC Status"><StatusChip status={c.kycStatus} /></td>
              <td className="num" data-label="Loans">{c.loanCount ?? 0}</td>
              <td className="td-chev" style={{ textAlign: "right", color: "var(--brand-deep)" }}>›</td>
            </tr>
          ))}
        </tbody>
      </table></div>
      <ScrollSentinel enabled={cards && (hasMore)} onVisible={more} watch={rows.length} />
      <div className="ft ft-scroll-hide" style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <button className="btn plain sm" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>‹ Prev</button>
        <span style={{ fontSize: 12.5 }}>Page {page} of {totalPages}</span>
        <span style={{ fontSize: 12.5, color: "var(--muted)" }}>· {total.toLocaleString("en-IN")} {total === 1 ? "result" : "results"}</span>
        <button className="btn plain sm" disabled={page >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))}>Next ›</button>
      </div>
      </div>
    </>
  );
}
