"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useDropdownMenu } from "@/product/hooks/useDropdownMenu";
import { useModal } from "@/product/components/Modal";
import { useToast } from "@/product/components/Toast";
import { useAuth } from "@/product/providers/auth-context";
import { ConfirmModalContent } from "@/product/components/modals/ConfirmModal";
import { fmt, fmtW, initials } from "@/product/utils/format";
import { StatusChip } from "@/product/components/ui/StatusChip";
import { LoanRow } from "@/product/pages/loans/components/LoanRow";
import { Icon } from "@/product/components/Icon";
import {
  getCustomer360,
  verifyCustomerPan,
  startAadhaarVerify,
  checkAadhaarVerify,
  hardDeleteCustomer,
  listCustomerLoansPage,
  listCustomerOrnamentsPage,
  listCustomerPaymentsPage,
  listCustomerBankPledgesPage,
  listCustomerAuctionHistoryPage,
  CUSTOMER_SUBTABLE_PAGE_SIZE,
  type Customer360View,
} from "@/product/pages/customers/services/customerService";
import { useResponsivePageSize, useIsSmallScreen } from "@/product/utils/responsive";
import type {
  LoanView,
  CustomerOrnamentRowView,
  CustomerPaymentRowView,
  CustomerBankPledgeRowView,
  CustomerAuctionRowView,
} from "@/product/pages/loans/services/loanService";
import {
  SelectLoanForRequestModalContent,
  RequestExtensionModalContent,
  RequestReleaseModalContent,
} from "@/product/components/modals/RequestExtensionModal";
import { EditCustomerModalContent } from "@/product/components/modals/EditCustomerModal";
import { navigate, routeHref } from "@/product/services/appRoutes";
import { listCashMovementsByCustomer, exportPartyStatementByCustomer, type LedgerRowView } from "@/product/pages/cash/services/cashService";
import { LedgerRefLink } from "@/product/components/ui/LedgerRefLink";
import { FilterPanel, type FilterCategory, type FilterValue } from "@/product/components/ui/FilterPanel";
import { ApiError } from "@/product/services/httpClient";

/* Server-side pager for the 360 view's sub-tables: each of the 5 tables
 * below fetches its own page (limit 10) from its own
 * GET /customers/:id/{...} endpoint (see customerService.ts) rather than
 * slicing rows already pulled in by getCustomer360 — a real network
 * round-trip per page, following the same limit/offset + {items, hasMore}
 * convention as Requests.tsx. `range` is the shared from/to opened-date
 * window; changing it resets the table back to page 1. */
function useSubTablePage<T>(
  fetchPage: (page: number, range?: { from?: string; to?: string }) => Promise<{ items: T[]; hasMore: boolean; total: number }>,
  range: { from?: string; to?: string },
  ready: boolean
) {
  const [items, setItems] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [total, setTotal] = useState(0);
  const from = range.from;
  const to = range.to;

  const refresh = useCallback(() => {
    if (!ready) return;
    setLoading(true);
    fetchPage(page, { from, to })
      .then((res) => {
        setItems(res.items);
        setHasMore(res.hasMore);
        setTotal(res.total);
      })
      .catch(() => {
        setItems([]);
        setHasMore(false);
        setTotal(0);
      })
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchPage, page, from, to, ready]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => setPage(1), [from, to]);

  return { items, loading, page, setPage, hasMore, total };
}

function Pager({ page, total, pageSize, onChange }: { page: number; total: number; pageSize: number; onChange: (p: number) => void }) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <div className="ft ft-static" style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 14px" }}>
      <button className="btn plain" disabled={page <= 1} onClick={() => onChange(Math.max(1, page - 1))}>‹ Prev</button>
      <span style={{ fontSize: 13 }}>Page {page} of {totalPages}</span>
      <button className="btn plain" disabled={page >= totalPages} onClick={() => onChange(Math.min(totalPages, page + 1))}>Next ›</button>
    </div>
  );
}

function ProofLink({ label, url }: { label: string; url: string }) {
  if (!url) return <div className="i"><div className="k">{label}</div><div className="v" style={{ color: "var(--muted)" }}>Not provided</div></div>;
  return (
    <div className="i"><div className="k">{label}</div><div className="v">
      <a href={url} target="_blank" rel="noreferrer">View</a>
    </div></div>
  );
}

/* Ported from legacy/app.js's `renderCustomerDetail(id)`. Now a real
 * Customer 360° view backed by one aggregation call
 * (`GET /api/v1/customers/:id/profile360`) instead of KYC/profile data
 * from `GET /api/v1/customers/:id` plus a client-side filter over the
 * shared loans list — that older approach only ever showed a bare loan
 * table, with no ornament/payment/bank-pledge/auction history in one
 * place. SMS reminder / follow-up history is still omitted — no data
 * source exists anywhere yet. */
export function CustomerDetail({ id }: { id?: string }) {
  const { openModal } = useModal();
  const toast = useToast();
  const { role, can } = useAuth();
  const smallScreen = useIsSmallScreen();
  // Cashier is outside the loan creation/approval flow — the backend
  // already 403s a Cashier's POST /loans, hide the button rather than let
  // them click into a form that can only ever fail. The permission grant
  // has to hold too.
  const canCreateLoans = role !== "Cashier" && can("Loan_Management", "can_create_loan");
  // KYC verification writes back to the customer record, so it's an update;
  // logging an extension/release request against a loan is a loan update.
  // Anything not granted is hidden, not disabled (see Customers.tsx).
  const canUpdateCustomers = can("Customer_Management", "can_update_customer");
  const canUpdateLoans = can("Loan_Management", "can_update_loan");
  const canHardDeleteCustomers = can("Customer_Management", "can_hard_delete_customer");

  const [profile, setProfile] = useState<Customer360View | null>(null);
  const [error, setError] = useState("");
  // Separate loading flags per verification — sharing one flag made the PAN
  // and Aadhaar buttons both show "Verifying…"/"Starting…" whenever either
  // one was clicked, even though they're independent calls.
  const [verifyingPan, setVerifyingPan] = useState(false);
  const [startingAadhaar, setStartingAadhaar] = useState(false);
  // DigiLocker Aadhaar verify is a redirect flow — "started" means the
  // customer's been sent the DigiLocker login URL and we're waiting for
  // them to complete it on their own device, so a "Check Status" button
  // replaces "Send Verification Link" until they confirm or we give up.
  const [aadhaarStarted, setAadhaarStarted] = useState(false);
  const [checkingAadhaar, setCheckingAadhaar] = useState(false);
  // Opened-date window for the whole profile. Empty = unbounded on that
  // side; both are handed to the backend, which filters the loans and
  // recomputes the relationship totals over the narrowed set — nothing here
  // is filtered client-side.
  // Opened-date filter for the 5 non-Ledger tables (Loan History, Pledged
  // Ornaments, Payment History, Bank Pledges, Auction History) — rendered as
  // a FilterPanel in the table card's own header (same spot/pattern as the
  // Ledger tab's filter) rather than a standalone row above the whole 360
  // view, so it reads as belonging to "this table" instead of the page.
  const [openedDateFilter, setOpenedDateFilter] = useState<FilterValue>({});
  const openedDateCategories: FilterCategory[] = [{ key: "__date", label: "Date", kind: "date" }];
  const from = openedDateFilter.__dateFrom || "";
  const to = openedDateFilter.__dateTo || "";
  const [reloading, setReloading] = useState(false);

  useEffect(() => {
    if (!id) return;
    setError("");
    setReloading(true);
    getCustomer360(id, { from, to })
      .then(setProfile)
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load customer."))
      .finally(() => setReloading(false));
  }, [id, from, to]);

  const subtablePageSize = useResponsivePageSize(15, 15);
  const range = { from, to };
  const listLoans = useCallback((page: number, r?: { from?: string; to?: string }) => listCustomerLoansPage(id || "", page, r, subtablePageSize), [id, subtablePageSize]);
  const listOrnaments = useCallback((page: number, r?: { from?: string; to?: string }) => listCustomerOrnamentsPage(id || "", page, r, subtablePageSize), [id, subtablePageSize]);
  const listPayments = useCallback((page: number, r?: { from?: string; to?: string }) => listCustomerPaymentsPage(id || "", page, r, subtablePageSize), [id, subtablePageSize]);
  const listBankPledges = useCallback((page: number, r?: { from?: string; to?: string }) => listCustomerBankPledgesPage(id || "", page, r, subtablePageSize), [id, subtablePageSize]);
  const listAuctionHistory = useCallback((page: number, r?: { from?: string; to?: string }) => listCustomerAuctionHistoryPage(id || "", page, r, subtablePageSize), [id, subtablePageSize]);
  // Every CashMovement tagged to this customer (PartyCustomerID) — same
  // underlying query as the standalone Party Transactions page
  // (PartyLedger.tsx), reached here instead via this customer's own 360
  // view. listCashMovementsByCustomer's {items,total,totals} envelope is
  // adapted to useSubTablePage's {items,hasMore,total} contract.
  const numericCustomerId = Number(id);

  // Ledger tab's own filters — a Loan picker (scroll-paginated, backend-
  // driven via listCustomerLoansPage) plus a Date range, kept separate from
  // the shared 360-view `from`/`to` above since the ledger can be filtered
  // independently of the rest of the profile.
  const [ledgerFilters, setLedgerFilters] = useState<FilterValue>({});
  const ledgerLoanFilters = Array.isArray(ledgerFilters.loan) ? ledgerFilters.loan : []; // multi-select — any of these loans
  const ledgerFrom = ledgerFilters.__dateFrom;
  const ledgerTo = ledgerFilters.__dateTo;
  const ledgerCategories: FilterCategory[] = [
    {
      key: "loan",
      label: "Loan",
      kind: "async",
      fetchOptions: (search, page) =>
        listCustomerLoansPage(id || "", page, undefined, 20).then((res) => ({
          items: res.items
            .filter((l) => !search || l.loanNumber.toLowerCase().includes(search.toLowerCase()))
            .map((l) => ({ value: l.loanNumber, label: l.loanNumber })),
          hasMore: res.hasMore,
        })),
    },
    { key: "__date", label: "Date", kind: "date" },
  ];
  const listTransactions = useCallback(
    (page: number) =>
      listCashMovementsByCustomer(numericCustomerId, page, { fromDate: ledgerFrom, toDate: ledgerTo, loanNumbers: ledgerLoanFilters }, subtablePageSize)
        .then((res) => ({
          items: res.items,
          total: res.total,
          hasMore: page * subtablePageSize < res.total,
        })),
    [numericCustomerId, subtablePageSize, ledgerFrom, ledgerTo, JSON.stringify(ledgerLoanFilters)]
  );

  const [ledgerExporting, setLedgerExporting] = useState(false);
  async function onExportLedger() {
    setLedgerExporting(true);
    try {
      await exportPartyStatementByCustomer(numericCustomerId, { fromDate: ledgerFrom, toDate: ledgerTo, loanNumbers: ledgerLoanFilters });
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Could not export the ledger.");
    } finally {
      setLedgerExporting(false);
    }
  }

  const [activeTable, setActiveTable] = useState(0);
  const TABLE_TABS = ["Loan History", "Pledged Ornaments", "Payment History", "Bank Pledges", "Auction History", "Ledger"];
  // One icon per tab, same order as TABLE_TABS — shown on the rail so each
  // stop says which table it selects.
  const TABLE_TAB_ICONS = ["list", "scale", "coin", "bank", "gavel", "chart"];
  // Lets a mouse-wheel or trackpad scroll over the tabs section switch tabs.
  // wheelLock debounces rapid scroll events from a single physical gesture.
  const wheelLock = useRef(false);
  const railRef = useRef<HTMLDivElement>(null);
  const rowRef = useRef<HTMLDivElement>(null);
  const activeTableRef = useRef(activeTable);
  activeTableRef.current = activeTable;

  // A plain React onWheel prop can never actually stop the page from
  // scrolling here: React attaches its synthetic wheel listener at the root
  // as passive (for scroll-performance reasons), and a passive listener's
  // preventDefault() is silently ignored by the browser. A real,
  // imperatively-attached DOM listener with {passive:false} is used to
  // prevent default page scrolling while switching tabs and allow normal page
  // scrolling when hitting the first or last tab boundaries.
  useEffect(() => {
    const row = rowRef.current;
    if (!row) return;
    function onWheel(e: WheelEvent) {
      const absY = Math.abs(e.deltaY);
      const absX = Math.abs(e.deltaX);
      if (absY < 5 && absX < 5) return;

      const dir = absY >= absX ? (e.deltaY > 0 ? 1 : -1) : (e.deltaX > 0 ? 1 : -1);
      const currentTab = activeTableRef.current;
      const nextTab = currentTab + dir;

      // At boundary? (e.g. Tab 0 scrolling up or last tab scrolling down)
      // Allow natural page scrolling
      if (nextTab < 0 || nextTab >= TABLE_TABS.length) {
        return;
      }

      // Inside tab bounds: prevent page scroll jump and switch tabs
      e.preventDefault();
      if (wheelLock.current) return;

      setActiveTable(nextTab);
      wheelLock.current = true;
      setTimeout(() => {
        wheelLock.current = false;
      }, 250);
    }
    row.addEventListener("wheel", onWheel, { passive: false });
    return () => row.removeEventListener("wheel", onWheel);
  });

  // Edit Customer / Request Extension-Release / New Loan / Delete Customer
  // used to be 4 separate header buttons — collapsed into one "Actions"
  // dropdown the same way LoanDetail.tsx's "Documents"/"Loan Actions" menus
  // are, since the header outgrew the space next to the customer name on
  // anything but a very wide screen.
  const {
    open: actionsMenuOpen,
    setOpen: setActionsMenuOpen,
    menuRef: actionsMenuRef,
    triggerRef: actionsMenuTriggerRef,
    onKeyDown: onActionsMenuKeyDown,
  } = useDropdownMenu<HTMLDivElement>();

  const loanPager = useSubTablePage<LoanView>(listLoans, range, !!id);
  const ornamentPager = useSubTablePage<CustomerOrnamentRowView>(listOrnaments, range, !!id);
  const paymentPager = useSubTablePage<CustomerPaymentRowView>(listPayments, range, !!id);
  const bankPledgePager = useSubTablePage<CustomerBankPledgeRowView>(listBankPledges, range, !!id);
  const auctionPager = useSubTablePage<CustomerAuctionRowView>(listAuctionHistory, range, !!id);
  const transactionPager = useSubTablePage<LedgerRowView>(listTransactions, { from: ledgerFrom, to: ledgerTo }, !!id);
  useEffect(() => { transactionPager.setPage(1); }, [JSON.stringify(ledgerLoanFilters)]); // eslint-disable-line react-hooks/exhaustive-deps

  // profile.loans still backs the "Request Extension / Release" picker
  // below — that's a full-set picker, not a paginated table, so it keeps
  // reading straight off getCustomer360's response.
  const cLoans = profile?.loans || [];

  // A range change keeps the previously loaded profile on screen (dimmed
  // via `reloading`) so the page doesn't blank out between fetches.
  if (error && !profile) return <div className="empty">Customer not found — {error}</div>;
  // `page-fade-in` on both the loading placeholder and the loaded content
  // below smooths the swap between them — without it, switching into a
  // customer's page from elsewhere (e.g. the dashboard) hard-cut from the
  // page's header/sidebar (already on screen) to this bare loading line,
  // then hard-cut again to the full hero once the fetch resolved. Now both
  // states fade in the same way, so the hero doesn't feel like a separate,
  // late-arriving element next to a header that "loaded" first.
  if (!profile) return <div className="empty page-fade-in">Loading customer…</div>;

  const c = profile.customer;

  async function verifyPan() {
    if (!id) return;
    setVerifyingPan(true);
    try {
      const result = await verifyCustomerPan(id);
      setProfile((p) => (p ? { ...p, customer: result.customer } : p));
      const status = result.customer.panStatus;
      if (status === "Verified") {
        toast(`PAN verified — Setu returned "${result.matchedName}". ${result.message}`);
      } else if (status === "Name Mismatch") {
        toast(`PAN is valid but registered to a different name — Setu returned "${result.matchedName}", which doesn't match this customer's name. Please review before proceeding.`);
      } else {
        toast(`PAN verification failed — ${result.message}`);
      }
    } catch (e) {
      toast(e instanceof Error ? e.message : "PAN verification failed.");
    } finally {
      setVerifyingPan(false);
    }
  }

  async function sendAadhaarVerificationLink() {
    if (!id) return;
    setStartingAadhaar(true);
    try {
      const redirectUrl = `${window.location.origin}/digilocker-callback`;
      const started = await startAadhaarVerify(id, redirectUrl);
      window.open(started.url, "_blank", "noopener,noreferrer");
      setAadhaarStarted(true);
      toast("DigiLocker login opened in a new tab — ask the customer to complete Aadhaar + OTP login there, then click \"Check Status\" here.");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not start Aadhaar verification.");
    } finally {
      setStartingAadhaar(false);
    }
  }

  async function checkAadhaarStatus() {
    if (!id) return;
    setCheckingAadhaar(true);
    try {
      const result = await checkAadhaarVerify(id);
      if (result.status !== "authenticated" || !result.customer) {
        toast("Customer hasn't completed DigiLocker login yet — ask them to finish it in the tab that opened, then check again.");
        return;
      }
      setProfile((p) => (p ? { ...p, customer: result.customer! } : p));
      setAadhaarStarted(false);
      const status = result.customer.aadhaarStatus;
      if (status === "Verified") {
        toast(`Aadhaar verified via DigiLocker — matched name "${result.matchedName}".`);
      } else if (status === "Name Mismatch") {
        toast(`Aadhaar verified but registered name "${result.matchedName}" doesn't match this customer's name. Please review before proceeding.`);
      }
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not check Aadhaar verification status.");
    } finally {
      setCheckingAadhaar(false);
    }
  }

  function openEditCustomer() {
    openModal(
      <EditCustomerModalContent
        key={c.id}
        customer={c}
        onSaved={() => {
          if (!id) return;
          getCustomer360(id, { from, to }).then(setProfile).catch(() => { });
        }}
      />,
      true
    );
  }

  function openRequestPicker() {
    openModal(
      <SelectLoanForRequestModalContent
        loans={cLoans}
        onPicked={(pickedLoan: LoanView, type: "Extension" | "Release") => {
          if (type === "Extension") {
            openModal(<RequestExtensionModalContent loan={pickedLoan} onSaved={() => { }} />);
          } else {
            openModal(<RequestReleaseModalContent loan={pickedLoan} onSaved={() => { }} />);
          }
        }}
      />
    );
  }

  return (
    <div className="page-fade-in">
      <div className="page-h">
        <div className="dhead">
          <div className="big-av">{initials(c.name)}</div>
          <div><h1 style={{ fontSize: 26 }}>{c.name}</h1><p>{c.code} · {c.branchName} branch</p></div>
        </div>
        <div className="sp" />
        {(canUpdateCustomers || canHardDeleteCustomers) && (
          <div className="docs-dd" ref={actionsMenuRef} onKeyDown={onActionsMenuKeyDown}>
            <button
              ref={actionsMenuTriggerRef}
              className="btn ghost"
              onClick={() => setActionsMenuOpen((v) => !v)}
              aria-haspopup="menu"
              aria-expanded={actionsMenuOpen}
            >
              <Icon name="gear" /> Actions <Icon name="chevronDown" className="docs-dd-chev" />
            </button>
            {actionsMenuOpen && (
              <div className="docs-dd-menu" role="menu">
                {canUpdateCustomers && (
                  <a href="#" title="Edit Customer" onClick={(e) => { e.preventDefault(); setActionsMenuOpen(false); openEditCustomer(); }}>
                    <Icon name="edit" /><span className="tx">Edit Customer</span>
                  </a>
                )}
                {canHardDeleteCustomers && (
                  <a
                    href="#"
                    title="Delete Customer Permanently"
                    className="danger"
                    onClick={(e) => {
                      e.preventDefault();
                      setActionsMenuOpen(false);
                      const activeLoans = cLoans.filter((l) => l.status !== "Closed" && l.status !== "Rejected" && l.status !== "Auctioned");
                      const hasActiveLoans = activeLoans.length > 0 || (profile?.activeLoanCount ?? 0) > 0;
                      const activeLoanListStr = activeLoans.map((l) => l.loanNumber || l.id).filter(Boolean).join(", ");

                      openModal(
                        <ConfirmModalContent
                          title="Delete Customer Permanently"
                          confirmLabel="Delete Permanently"
                          busyLabel="Deleting…"
                          disabled={hasActiveLoans}
                          message={
                            <>
                              This permanently deletes <strong>{c.name}</strong> ({c.code}). This cannot be undone.
                            </>
                          }
                          onConfirm={async () => {
                            if (!id || hasActiveLoans) return;
                            await hardDeleteCustomer(id);
                            toast("Customer deleted permanently");
                            navigate("customers");
                          }}
                        >
                          {hasActiveLoans && (
                            <div
                              style={{
                                marginTop: 14,
                                padding: "12px 14px",
                                background: "rgba(239, 68, 68, 0.08)",
                                border: "1px solid var(--red)",
                                borderRadius: 6,
                                color: "var(--red)",
                                fontSize: 13,
                                lineHeight: 1.5,
                              }}
                            >
                              <div style={{ fontWeight: 600, display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                                <Icon name="warning" /> Active Loans Warning
                              </div>
                              Cannot delete this customer — {activeLoanListStr ? <>the following loan(s) are still active: <strong>{activeLoanListStr}</strong></> : <>this customer has active loan(s)</>}. Active loans must be closed or deleted first.
                            </div>
                          )}
                        </ConfirmModalContent>
                      );
                    }}
                  >
                    <Icon name="trash" /><span className="tx">Delete Customer Permanently</span>
                  </a>
                )}
              </div>
            )}
          </div>
        )}
        {canUpdateLoans && <button className="btn ghost" onClick={openRequestPicker}><Icon name="unlock" /> Extension / Release</button>}
        {canCreateLoans && <a className="btn" href="#newloan"><Icon name="plus" /> New Loan</a>}
        {/* Edit Customer + Delete Customer collapsed into one "Actions"
         * dropdown — same pattern as LoanDetail.tsx's "Documents"/"Loan
         * Actions" menus. Delete stays the ONLY delete action offered here —
         * no separate "soft delete" alternative next to it. Gated by its own
         * permission ("can hard delete customer"), independent of ordinary
         * update/delete rights. */}
        
      </div>
      {/* Small-screen margin override (matches Loans.tsx's own hr override)
       * — without it this rule was reading as missing on small/short
       * (useIsSmallScreen) windows, sitting too close to the header above
       * to read as its own divider line. */}
      <hr className="gold-rule" style={{ margin: smallScreen ? "4px 0 6px" : "4px 0 10px" }} />
      {error && (
        <div style={{ marginBottom: 12, fontSize: 12.5, color: "var(--red)" }}>{error}</div>
      )}
      {/* cust-360 pins the left card column to a fixed width so it stays put
          when the tab switches between tables of different column counts, and
          makes the tables fit their column instead of scrolling sideways. */}
      <div className="grid cols12 cust-360" style={{ alignItems: "stretch", ...(reloading ? { opacity: 0.6 } : {}) }}>
        <div className="grid">
          {/* KYC & Verification, Identity & KYC Documents, Nominee Information and
              Overall Loan Details were 4 separate cards stacked in this column —
              merged into one card with a divider + sub-heading per section so the
              column reads as one profile panel instead of four short ones. */}
          <div className="card gtop"><div className="hd"><h3>Customer Profile</h3></div>
            <div className="bd cust-profile">
              <div className="kv">
                {/* Label and chip inline (one line), matching KYC's own
                 * pattern below — the masked value and any verify action
                 * move to their own line underneath, rather than all three
                 * (label / value / chip) competing to fit on one line the
                 * way this used to render. */}
                <div className="i">
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}><div className="k">PAN</div><StatusChip status={c.panStatus} /></div>
                  <div className="v" style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    <span>{c.pan || "—"}</span>
                    {canUpdateCustomers && c.pan && c.panStatus !== "Verified" && (
                      <button className="btn ghost sm" style={{ padding: "2px 8px" }} onClick={verifyPan} disabled={verifyingPan}>
                        {verifyingPan ? "Verifying…" : "Verify PAN"}
                      </button>
                    )}
                  </div>
                </div>
                <div className="i">
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}><div className="k">Aadhaar</div><StatusChip status={c.aadhaarStatus} /></div>
                  <div className="v" style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    <span>{c.aadhaarLast4 ? "XXXX-XXXX-" + c.aadhaarLast4 : "—"}</span>
                    {canUpdateCustomers && c.aadhaarStatus !== "Verified" && !aadhaarStarted && (
                      <button className="btn ghost sm" style={{ padding: "2px 8px" }} onClick={sendAadhaarVerificationLink} disabled={startingAadhaar}>
                        {startingAadhaar ? "Starting…" : "Verify via DigiLocker"}
                      </button>
                    )}
                    {canUpdateCustomers && c.aadhaarStatus !== "Verified" && aadhaarStarted && (
                      <button className="btn ghost sm" style={{ padding: "2px 8px" }} onClick={checkAadhaarStatus} disabled={checkingAadhaar}>
                        {checkingAadhaar ? "Checking…" : "Check Status"}
                      </button>
                    )}
                  </div>
                </div>
                {/* Label and chip inline (one line) rather than the usual
                 * stacked .k-above-.v — with no accompanying value text to
                 * flow beside, KYC's chip alone under its label read as two
                 * disconnected lines instead of one field. */}
                <div className="i"><div style={{ display: "flex", alignItems: "center", gap: 8 }}><div className="k">KYC</div><StatusChip status={c.kycStatus} /></div></div>
                {/* Forced onto one line regardless of the card's own width
                 * (gridColumn:"1 / -1" takes the whole row instead of
                 * competing for one of .kv's auto-fill columns) — at a
                 * narrow card width .kv's own minmax(150px,1fr) columns
                 * collapse to a single column, so Date of Birth and Phone
                 * would otherwise stack one per line like everything else
                 * here. */}
                <div className="i" style={{ gridColumn: "1 / -1", display: "flex", gap: 24 }}>
                  <div style={{ flex: 1, minWidth: 0 }}><div className="k">Date of Birth</div><div className="v">{c.dob || "—"}</div></div>
                  <div style={{ flex: 1, minWidth: 0 }}><div className="k">Phone</div><div className="v">{c.phone || "—"}</div></div>
                </div>
                <div className="i"><div className="k">Address</div><div className="v">{c.address || "—"}</div></div>
              </div>

              <h4 className="cust-profile-h4">Identity &amp; KYC Documents</h4>
              <div className="kv">
                <ProofLink label="Photograph" url={c.photoUrl} />
                <ProofLink label="Identity Proof" url={c.identityProofUrl} />
                <ProofLink label="Address Proof" url={c.addressProofUrl} />
                <ProofLink label="Additional Document" url={c.kycDocumentUrl} />
              </div>

              {(c.nomineeName || c.nomineeRelation || c.nomineePhone) && (
                <>
                  <h4 className="cust-profile-h4">Nominee Information</h4>
                  <div className="kv">
                    {/* Name and Relation share one flex-wrap row, with
                     * Relation+Phone bundled as a single atomic item within
                     * it (their own inner flex row) — a short name leaves
                     * room for Name and Relation to sit on the same line;
                     * once the name is long enough to fill the row, the
                     * Relation+Phone pair wraps down together onto the next
                     * line instead of Relation stranding alone away from
                     * the Phone it belongs beside. */}
                    <div className="i" style={{ gridColumn: "1 / -1" }}>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 24 }}>
                        <div style={{ flex: "1 1 auto", minWidth: 100 }}><div className="k">Name</div><div className="v">{c.nomineeName || "—"}</div></div>
                        <div style={{ display: "flex", gap: 24, flex: "1 1 auto" }}>
                          <div style={{ flex: 1, minWidth: 0 }}><div className="k">Relation</div><div className="v">{c.nomineeRelation || "—"}</div></div>
                          <div style={{ flex: 1, minWidth: 0 }}><div className="k">Phone</div><div className="v">{c.nomineePhone || "—"}</div></div>
                        </div>
                      </div>
                    </div>
                  </div>
                </>
              )}

              <h4 className="cust-profile-h4">Overall Loan Details</h4>
              <div className="kv">
                <div className="i"><div className="k">Total Disbursed</div><div className="v">{fmt(profile.totalDisbursed)}</div></div>
                {/* Outstanding and Total Paid read as one pair (what's left
                 * vs. what's already come in) — kept on one line the same
                 * way as the others here, rather than splitting across two
                 * rows at this card's narrow width. */}
                <div className="i" style={{ gridColumn: "1 / -1", display: "flex", gap: 24 }}>
                  <div style={{ flex: 1, minWidth: 0 }}><div className="k">Outstanding</div><div className="v">{fmt(profile.totalOutstanding)}</div></div>
                  <div style={{ flex: 1, minWidth: 0 }}><div className="k">Total Paid</div><div className="v">{fmt(profile.totalPaid)}</div></div>
                </div>
                {/* Active/Closed read as one loan-status summary — kept on
                 * one line the same way as the pairs above, rather than
                 * splitting across two rows at this card's narrow width. */}
                <div className="i" style={{ gridColumn: "1 / -1", display: "flex", gap: 24 }}>
                  <div style={{ flex: 1, minWidth: 0 }}><div className="k">Active Loans</div><div className="v">{profile.activeLoanCount}</div></div>
                  <div style={{ flex: 1, minWidth: 0 }}><div className="k">Closed Loans</div><div className="v">{profile.closedLoanCount}</div></div>
                </div>
              </div>
            </div>
          </div>
        </div>
        <div ref={rowRef} className="cust-360-tabrow" style={{ display: "flex", gap: 16, alignItems: "stretch", height: "100%" }}>
          {/* The rail selects the table below. Each stop carries the icon for
            its own table (loans / ornaments / payments / bank / auction) so
            the rail reads without hovering for the tooltip. onWheel lives on
            this whole flex row (rail + table card) to enable smooth scrolling
            tab switching. */}
          <div className="tab-rail" ref={railRef}>
            <div className="tab-rail-line" />
            {TABLE_TABS.map((label, i) => (
              <button
                key={label}
                type="button"
                title={label}
                aria-label={label}
                aria-current={activeTable === i}
                className={"tab-rail-dot" + (activeTable === i ? " on" : "")}
                onClick={() => setActiveTable(i)}
              >
                <Icon name={TABLE_TAB_ICONS[i]} />
              </button>
            ))}
          </div>

          <div className="card tbl-card tbl-card-fill">
            <div className="hd" style={{ flexWrap: "wrap", rowGap: 10 }}>
              <h3>{TABLE_TABS[activeTable]}</h3>
              {activeTable === 5 ? (
                <>
                  <div className="sp" />
                  <FilterPanel categories={ledgerCategories} value={ledgerFilters} onChange={setLedgerFilters} hideChips />
                  <button className="btn ghost sm" disabled={ledgerExporting} onClick={onExportLedger}>
                    {ledgerExporting ? "Exporting…" : "Download"}
                  </button>
                </>
              ) : (
                <>
                  <div className="sp" />
                  {reloading && <span style={{ fontSize: 12.5, color: "var(--muted)" }}>Loading…</span>}
                  <FilterPanel categories={openedDateCategories} value={openedDateFilter} onChange={setOpenedDateFilter} hideChips />
                </>
              )}
            </div>

            {/* All 6 panels stay mounted and are only shown/hidden via
              * `hidden` — a conditional `{activeTable === i && <div>...}`
              * used to unmount/remount the whole table (rows, pager, DOM)
              * on every tab click, which read as the page reloading even
              * though no data was ever refetched. `hidden` keeps each
              * panel's DOM and the tab-slide-up entrance animation intact,
              * without re-running any of the fetches above. */}
            <div hidden={activeTable !== 0} className={activeTable === 0 ? "tab-slide-up" : undefined}>
                <div className="tbl-wrap tbl-wrap-auto"><table className="tbl tbl-center">
                  <thead><tr><th>Loan</th><th>Scheme</th><th className="th-opened-due">Opened / <span className="th-due-part">Due</span></th><th className="num">Principal</th><th className="num">Outstanding</th><th>Pledge</th><th>Status</th></tr></thead>
                  <tbody>
                    {loanPager.items.length === 0 ? (
                      <tr><td colSpan={7} className="empty compact">No loans yet.</td></tr>
                    ) : loanPager.items.map((l) => <LoanRow loan={l} key={l.id} />)}
                  </tbody>
                </table></div>
                <Pager page={loanPager.page} total={loanPager.total} pageSize={subtablePageSize} onChange={loanPager.setPage} />
              </div>

            <div hidden={activeTable !== 1} className={activeTable === 1 ? "tab-slide-up" : undefined}>
                <div className="tbl-wrap tbl-wrap-auto"><table className="tbl tbl-center">
                  <thead><tr><th>Loan</th><th>Ornament</th><th>Purity</th><th className="num">Net (g)</th><th className="num">Gold Value</th></tr></thead>
                  <tbody>
                    {ornamentPager.items.length === 0 ? (
                      <tr><td colSpan={5} className="empty compact">No pledged ornaments yet.</td></tr>
                    ) : ornamentPager.items.map((o) => (
                      <tr key={o.loanId + "-" + o.id}>
                        <td><a href={routeHref(`loan/${o.loanNumber}`)}>{o.loanNumber}</a></td>
                        <td>{o.name}</td>
                        <td><span className="chip brand">{o.purity}</span></td>
                        <td className="num">{fmtW(o.netWeight)}</td>
                        <td className="num">{fmt(o.goldValue)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table></div>
                <Pager page={ornamentPager.page} total={ornamentPager.total} pageSize={subtablePageSize} onChange={ornamentPager.setPage} />
              </div>

            <div hidden={activeTable !== 2} className={activeTable === 2 ? "tab-slide-up" : undefined}>
                <div className="tbl-wrap tbl-wrap-auto"><table className="tbl tbl-center">
                  <thead><tr><th>Loan</th><th>Date</th><th>Type</th><th className="num">Amount</th><th>Method</th></tr></thead>
                  <tbody>
                    {paymentPager.items.length === 0 ? (
                      <tr><td colSpan={5} className="empty compact">No payments recorded yet.</td></tr>
                    ) : paymentPager.items.map((p) => (
                      <tr key={p.loanId + "-" + p.id}>
                        <td><a href={routeHref(`loan/${p.loanNumber}`)}>{p.loanNumber}</a></td>
                        <td>{p.paidOn}</td>
                        <td>{p.type}</td>
                        <td className="num">{fmt(p.amount)}</td>
                        <td>{p.method || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table></div>
                <Pager page={paymentPager.page} total={paymentPager.total} pageSize={subtablePageSize} onChange={paymentPager.setPage} />
              </div>

            <div hidden={activeTable !== 3} className={activeTable === 3 ? "tab-slide-up" : undefined}>
                <div className="tbl-wrap tbl-wrap-auto"><table className="tbl tbl-center">
                  <thead><tr><th>Loan</th><th>Bank</th><th className="num">Amount</th><th>Pledged On</th><th>Status</th></tr></thead>
                  <tbody>
                    {bankPledgePager.items.length === 0 ? (
                      <tr><td colSpan={5} className="empty compact">No bank pledges yet.</td></tr>
                    ) : bankPledgePager.items.map((p) => (
                      <tr key={p.loanId + "-" + p.id}>
                        <td><a href={routeHref(`loan/${p.loanNumber}`)}>{p.loanNumber}</a></td>
                        <td>{p.bankName}</td>
                        <td className="num">{fmt(p.pledgedAmount)}</td>
                        <td>{p.pledgeDate}</td>
                        <td><StatusChip status={p.isReleased ? "Released" : "Bank Pledged"} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table></div>
                <Pager page={bankPledgePager.page} total={bankPledgePager.total} pageSize={subtablePageSize} onChange={bankPledgePager.setPage} />
              </div>

            <div hidden={activeTable !== 4} className={activeTable === 4 ? "tab-slide-up" : undefined}>
                <div className="tbl-wrap tbl-wrap-auto"><table className="tbl tbl-center">
                  <thead><tr><th>Loan</th><th>Stage</th><th>Auction Date</th><th className="num">Sale Amount</th><th className="num th-surplus-shortfall">Surplus / <span className="th-shortfall-part">Shortfall</span></th></tr></thead>
                  <tbody>
                    {auctionPager.items.length === 0 ? (
                      <tr><td colSpan={5} className="empty compact">No auction records yet.</td></tr>
                    ) : auctionPager.items.map((a) => (
                      <tr key={a.id}>
                        <td><a href={routeHref(`loan/${a.loanNumber}`)}>{a.loanNumber}</a></td>
                        <td><StatusChip status={a.stage} /></td>
                        <td>{a.auctionDate || "—"}</td>
                        <td className="num">{a.saleAmount ? fmt(a.saleAmount) : "—"}</td>
                        <td className="num" style={{ color: a.surplusShortfall >= 0 ? "var(--green)" : "var(--red)" }}>{a.saleAmount ? fmt(Math.abs(a.surplusShortfall)) : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table></div>
                <Pager page={auctionPager.page} total={auctionPager.total} pageSize={subtablePageSize} onChange={auctionPager.setPage} />
              </div>

            <div hidden={activeTable !== 5} className={activeTable === 5 ? "tab-slide-up" : undefined}>
                <div className="tbl-wrap tbl-wrap-auto"><table className="tbl tbl-center">
                  <thead><tr><th>Date</th><th>Particulars</th><th>Method</th><th>Reference</th><th className="num">Debit</th><th className="num">Credit</th><th className="num">Balance</th></tr></thead>
                  <tbody>
                    {transactionPager.items.length === 0 ? (
                      <tr><td colSpan={7} className="empty compact">No ledger entries recorded yet.</td></tr>
                    ) : transactionPager.items.map((r) => (
                      <tr key={r.id}>
                        <td>{r.d}</td>
                        <td>
                          {r.description || r.type}
                          {r.bankId ? (
                            <div style={{ marginTop: 4 }}>
                              <LedgerRefLink kind="bank" id={r.bankId} label={r.bankName || "Bank"} />
                            </div>
                          ) : null}
                        </td>
                        <td>{r.method || "—"}</td>
                        <td className="ledger-ref" title={r.reference || undefined}>{r.reference || "—"}</td>
                        <td className="num" style={{ color: r.debitOrCredit === "debit" ? "var(--red)" : undefined }}>{r.debitOrCredit === "debit" ? fmt(r.amount) : "—"}</td>
                        <td className="num" style={{ color: r.debitOrCredit === "credit" ? "var(--green)" : undefined }}>{r.debitOrCredit === "credit" ? fmt(r.amount) : "—"}</td>
                        <td className="num">{fmt(r.runningBalance)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table></div>
                <Pager page={transactionPager.page} total={transactionPager.total} pageSize={subtablePageSize} onChange={transactionPager.setPage} />
              </div>
          </div>
        </div>
      </div>
    </div>
  );
}
