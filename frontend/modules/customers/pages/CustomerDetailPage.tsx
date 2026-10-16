"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useDropdownMenu } from "@/common/hooks/use-dropdown-menu";
import { useModal } from "@/common/components/ModalProvider";
import { useToast } from "@/common/components/ToastProvider";
import { useAuth } from "@/common/providers/AuthProvider";
import { ConfirmModalContent } from "@/common/components/modals/ConfirmModalContent";
import { fmt, fmtW, initials, fmtDate } from "@/common/utils/format";
import { StatusChip } from "@/common/components/ui/StatusChip";
import { LoanRow } from "@/modules/loans/components/LoanRow";
import { Icon } from "@/common/components/Icon";
import { getCustomer360, verifyCustomerPan, startAadhaarVerify, checkAadhaarVerify, hardDeleteCustomer, listCustomerLoansPage, listCustomerOrnamentsPage, listCustomerPaymentsPage, listCustomerBankPledgesPage, listCustomerAuctionHistoryPage } from "@/modules/customers/services/customerService";
import { type Customer360View } from "@/modules/customers/types/customer-types";
import { useResponsivePageSize, useIsSmallScreen } from "@/common/utils/responsive";
import type { LoanView, CustomerOrnamentRowView, CustomerPaymentRowView, CustomerBankPledgeRowView, CustomerAuctionRowView } from "@/modules/loans/types/loan-types";
import { RequestExtensionModalContent } from "@/common/components/modals/RequestExtensionModalContent";
import { SelectLoanForRequestModalContent } from "@/common/components/modals/SelectLoanForRequestModalContent";
import { RequestReleaseModalContent } from "@/common/components/modals/RequestReleaseModalContent";
import { EditCustomerModalContent } from "@/modules/customers/components/EditCustomerModalContent";
import { navigate, routeHref } from "@/common/services/appRoutes";
import { useCanOpenRoute } from "@/common/hooks/use-can-open-route";
import { listCashMovementsByCustomer, exportPartyStatementByCustomer, MODE_LEDGER_ROUTE } from "@/modules/cash/services/cashService";
import { type LedgerRowView } from "@/modules/cash/types/cash-types";
import { LedgerRefLink } from "@/common/components/LedgerRefLink";
import { LedgerEntryActions } from "@/modules/cash/components/LedgerEntryActions";
import { FilterPanel, type FilterCategory, type FilterValue } from "@/common/components/ui/FilterPanel";
import { ApiError } from "@/common/services/httpClient";
import { singleFlight } from "@/common/utils/singleFlight";
import { useShowBranch } from "@/common/hooks/use-branch-switch";
import { Pager } from "@/modules/customers/components/Pager";
import { ProofLink } from "@/modules/customers/components/ProofLink";
import { useSubTablePage } from "@/modules/customers/hooks/use-sub-table-page";

type CustomerDetailPageProps = { id?: string };

/* Ported from legacy/app.js's `renderCustomerDetail(id)`. Now a real
 * Customer 360° view backed by one aggregation call
 * (`GET /api/v1/customers/:id/profile360`) instead of KYC/profile data
 * from `GET /api/v1/customers/:id` plus a client-side filter over the
 * shared loans list — that older approach only ever showed a bare loan
 * table, with no ornament/payment/bank-pledge/auction history in one
 * place. SMS reminder / follow-up history is still omitted — no data
 * source exists anywhere yet. */
export function CustomerDetailPage({ id }: CustomerDetailPageProps) {
  const { openModal } = useModal();
  const showBranch = useShowBranch();
  const toast = useToast();
  const { can } = useAuth();
  const canExport = can("Ledger_Export", "can_export_ledger");
  const smallScreen = useIsSmallScreen();
  // Hidden rather than shown as a form that can only fail with a 403.
  const canCreateLoans = can("Loan_Management", "can_create_loan");
  // Loan numbers link to the loan only for a role that can open it.
  const canOpen = useCanOpenRoute();
  const canViewLoans = canOpen("loan");
  const canViewAuctions = canOpen("auctions");
  // The Ledger tab reads cash movements — only fetched with cash view.
  const canViewCash = can("Cash_Management", "can_view_cash_module");
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
      searchHint: "Searches: loan number",
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
  async function onExportLedger() { return singleFlight("customer:ledger-export", async () => {
    setLedgerExporting(true);
    try {
      await exportPartyStatementByCustomer(numericCustomerId, { fromDate: ledgerFrom, toDate: ledgerTo, loanNumbers: ledgerLoanFilters });
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Could not export the ledger.");
    } finally {
      setLedgerExporting(false);
    }
  }); }

  const [activeTable, setActiveTable] = useState(0);
  const TABLE_TABS = ["Loan History", "Pledged Ornaments", "Payment History", "Bank Pledges", "Auction History", "Ledger"];
  // One icon per tab, same order as TABLE_TABS — shown on the rail so each
  // stop says which table it selects.
  const TABLE_TAB_ICONS = ["list", "scale", "coin", "bank", "gavel", "chart"];
  // Tables are switched only by clicking the rail buttons — the mouse wheel /
  // trackpad no longer changes tab (it scrolls the table or page as usual).
  const railRef = useRef<HTMLDivElement>(null);
  const rowRef = useRef<HTMLDivElement>(null);

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
  // Auction history needs "can view auction module" — not fetched without it.
  const auctionPager = useSubTablePage<CustomerAuctionRowView>(listAuctionHistory, range, !!id && canViewAuctions);
  const transactionPager = useSubTablePage<LedgerRowView>(listTransactions, { from: ledgerFrom, to: ledgerTo }, !!id && canViewCash);
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
        toast("PAN verification failed — Name does not match.");
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
      } else if (status === "Failed") {
        const reasons = result.failureReasons?.length ? result.failureReasons.join("; ") : "details do not match the customer profile";
        toast(`Aadhaar verification failed — ${reasons}.`);
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
    <div className="page-fade-in page-fill">
      <div className="page-h">
        <div className="dhead">
          <div className="big-av">{initials(c.name)}</div>
          <div><h1 style={{ fontSize: 26 }}>{c.name}</h1><p>{c.code}{showBranch && <> · {c.branchName} branch</>}</p></div>
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
                      const activeLoanRefs = activeLoans.map((l) => l.loanNumber || l.id).filter(Boolean);

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
                              Cannot delete this customer — {activeLoanRefs.length > 0 ? (
                                <>
                                  the following loan(s) are still active:{" "}
                                  {activeLoanRefs.map((ref, i) => (
                                    <span key={ref}>
                                      {i > 0 && ", "}
                                      {canViewLoans ? (
                                        <a href={routeHref(`loan/${ref}`)} target="_blank" rel="noopener noreferrer" style={{ color: "inherit", fontWeight: 700, textDecoration: "underline" }}>{ref}</a>
                                      ) : (
                                        <strong>{ref}</strong>
                                      )}
                                    </span>
                                  ))}
                                </>
                              ) : <>this customer has active loan(s)</>}. Active loans must be closed or deleted first.
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
        {canCreateLoans && <a className="btn" href={routeHref("newloan", c.id)}><Icon name="plus" /> New Loan</a>}
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
                    {canUpdateCustomers && c.aadhaarLast4 && c.aadhaarStatus !== "Verified" && !aadhaarStarted && (
                      <button className="btn ghost sm" style={{ padding: "2px 8px" }} onClick={sendAadhaarVerificationLink} disabled={startingAadhaar}>
                        {startingAadhaar ? "Starting…" : "Verify Aadhaar"}
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
                  <div style={{ flex: 1, minWidth: 0 }}><div className="k">Date of Birth</div><div className="v">{fmtDate(c.dob)}</div></div>
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
            the rail reads without hovering for the tooltip. (No wheel handler:
            tabs change by click only.) */}
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
                  <FilterPanel categories={ledgerCategories} value={ledgerFilters} onChange={setLedgerFilters} hideChips hideClearAll />
                  {canExport && (
                    <button className="btn ghost sm" disabled={ledgerExporting} onClick={onExportLedger}>
                      <Icon name="download" /> {ledgerExporting ? "Exporting…" : "Download"}
                    </button>
                  )}
                </>
              ) : (
                <>
                  <div className="sp" />
                  {reloading && <span style={{ fontSize: 12.5, color: "var(--muted)" }}>Loading…</span>}
                  <FilterPanel categories={openedDateCategories} value={openedDateFilter} onChange={setOpenedDateFilter} hideChips hideClearAll />
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
                <div className="tbl-wrap tbl-wrap-auto"><table className="tbl tbl-center tbl-cards">
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
                <div className="tbl-wrap tbl-wrap-auto"><table className="tbl tbl-center tbl-cards">
                  <thead><tr><th>Loan</th><th>Ornament</th><th>Purity</th><th className="num">Net (g)</th><th className="num">Gold Value</th></tr></thead>
                  <tbody>
                    {ornamentPager.items.length === 0 ? (
                      <tr><td colSpan={5} className="empty compact">No pledged ornaments yet.</td></tr>
                    ) : ornamentPager.items.map((o) => (
                      <tr key={o.loanId + "-" + o.id}>
                        <td data-label="Loan">{canViewLoans ? <a href={routeHref(`loan/${o.loanNumber}`)}>{o.loanNumber}</a> : o.loanNumber}</td>
                        <td data-label="Ornament">{o.name}</td>
                        <td data-label="Purity"><span className="chip brand">{o.purity}</span></td>
                        <td data-label="Net (g)" className="num">{fmtW(o.netWeight)}</td>
                        <td data-label="Gold Value" className="num">{fmt(o.goldValue)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table></div>
                <Pager page={ornamentPager.page} total={ornamentPager.total} pageSize={subtablePageSize} onChange={ornamentPager.setPage} />
              </div>

            <div hidden={activeTable !== 2} className={activeTable === 2 ? "tab-slide-up" : undefined}>
                <div className="tbl-wrap tbl-wrap-auto"><table className="tbl tbl-center tbl-cards">
                  <thead><tr><th>Loan</th><th>Date</th><th>Type</th><th className="num">Amount</th><th>Method</th></tr></thead>
                  <tbody>
                    {paymentPager.items.length === 0 ? (
                      <tr><td colSpan={5} className="empty compact">No payments recorded yet.</td></tr>
                    ) : paymentPager.items.map((p) => (
                      <tr key={p.loanId + "-" + p.id}>
                        <td data-label="Loan">{canViewLoans ? <a href={routeHref(`loan/${p.loanNumber}`)}>{p.loanNumber}</a> : p.loanNumber}</td>
                        <td data-label="Date" className="td-date">{fmtDate(p.paidOn)}</td>
                        <td data-label="Type">{p.type}</td>
                        <td data-label="Amount" className="num">{fmt(p.amount)}</td>
                        <td data-label="Method">{p.method || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table></div>
                <Pager page={paymentPager.page} total={paymentPager.total} pageSize={subtablePageSize} onChange={paymentPager.setPage} />
              </div>

            <div hidden={activeTable !== 3} className={activeTable === 3 ? "tab-slide-up" : undefined}>
                <div className="tbl-wrap tbl-wrap-auto"><table className="tbl tbl-center tbl-cards">
                  <thead><tr><th>Loan</th><th>Bank</th><th className="num">Amount</th><th>Pledged On</th><th>Status</th></tr></thead>
                  <tbody>
                    {bankPledgePager.items.length === 0 ? (
                      <tr><td colSpan={5} className="empty compact">No bank pledges yet.</td></tr>
                    ) : bankPledgePager.items.map((p) => (
                      <tr key={p.loanId + "-" + p.id}>
                        <td data-label="Loan">{canViewLoans ? <a href={routeHref(`loan/${p.loanNumber}`)}>{p.loanNumber}</a> : p.loanNumber}</td>
                        <td data-label="Bank">{p.bankName}</td>
                        <td data-label="Amount" className="num">{fmt(p.pledgedAmount)}</td>
                        <td data-label="Pledged On" className="td-date">{fmtDate(p.pledgeDate)}</td>
                        <td data-label="Status"><StatusChip status={p.isReleased ? "Released" : "Bank Pledged"} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table></div>
                <Pager page={bankPledgePager.page} total={bankPledgePager.total} pageSize={subtablePageSize} onChange={bankPledgePager.setPage} />
              </div>

            <div hidden={activeTable !== 4} className={activeTable === 4 ? "tab-slide-up" : undefined}>
                <div className="tbl-wrap tbl-wrap-auto"><table className="tbl tbl-center tbl-cards">
                  <thead><tr><th>Loan</th><th>Stage</th><th>Auction Date</th><th className="num">Sale Amount</th><th className="num th-surplus-shortfall">Surplus / <span className="th-shortfall-part">Shortfall</span></th></tr></thead>
                  <tbody>
                    {!canViewAuctions ? (
                      <tr><td colSpan={5} className="empty compact">You don't have permission to view auction history.</td></tr>
                    ) : auctionPager.items.length === 0 ? (
                      <tr><td colSpan={5} className="empty compact">No auction records yet.</td></tr>
                    ) : auctionPager.items.map((a) => (
                      <tr key={a.id}>
                        <td data-label="Loan">{canViewLoans ? <a href={routeHref(`loan/${a.loanNumber}`)}>{a.loanNumber}</a> : a.loanNumber}</td>
                        <td data-label="Stage"><StatusChip status={a.stage} /></td>
                        <td data-label="Auction Date" className="td-date">{fmtDate(a.auctionDate)}</td>
                        <td data-label="Sale Amount" className="num">{a.saleAmount ? fmt(a.saleAmount) : "—"}</td>
                        <td data-label="Surplus / Shortfall" className="num" style={{ color: a.surplusShortfall >= 0 ? "var(--green)" : "var(--red)" }}>{a.saleAmount ? fmt(Math.abs(a.surplusShortfall)) : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table></div>
                <Pager page={auctionPager.page} total={auctionPager.total} pageSize={subtablePageSize} onChange={auctionPager.setPage} />
              </div>

            <div hidden={activeTable !== 5} className={activeTable === 5 ? "tab-slide-up" : undefined}>
                <div className="tbl-wrap tbl-wrap-auto"><table className="tbl tbl-center tbl-cards">
                  <thead><tr><th>Date</th><th>Ref No</th><th>Particulars</th><th>Method</th><th className="num">Debit</th><th className="num">Credit</th><th className="num">Balance</th></tr></thead>
                  <tbody>
                    {!canViewCash ? (
                      <tr><td colSpan={7} className="empty compact">You don't have permission to view the ledger.</td></tr>
                    ) : transactionPager.items.length === 0 ? (
                      <tr><td colSpan={7} className="empty compact">No ledger entries recorded yet.</td></tr>
                    ) : transactionPager.items.map((r, i) => {
                      // Same reference detection as PartyLedger: the loan /
                      // investment / personal-loan number is either the row's
                      // reference or trails its description ("… — LN-00048").
                      const refOf = (re: RegExp, tail: RegExp) =>
                        (r.reference && r.reference.match(re)?.[0]) || r.description.match(tail)?.[1] || null;
                      const loanRef = refOf(/^LN-\d+/i, /—\s*(LN-\S+)\s*$/i);
                      const invRef = refOf(/^INV-\d+/i, /—\s*(INV-\S+)\s*$/i);
                      const plRef = refOf(/^PL-\d+/i, /—\s*(PL-\S+)\s*$/i);
                      return (
                      // A split payment yields one row per method, all sharing
                      // the movement's id — so the id alone isn't unique.
                      <tr key={`${r.type}-${r.id}-${r.method}-${i}`}>
                        <td data-label="Date" className="td-date">{fmtDate(r.d)}</td>
                        <td data-label="Ref No" className="ledger-ref" title={r.reference || undefined}>
                          {loanRef ? <LedgerRefLink kind="loan" id={loanRef} label={r.reference || loanRef} />
                            : invRef ? <LedgerRefLink kind="investment" id={invRef} label={invRef} />
                            : plRef ? <LedgerRefLink kind="personalloan" id={plRef} label={plRef} />
                            : r.bankId ? <LedgerRefLink kind="bank" id={r.bankId} label={r.bankName || r.reference || "Bank"} />
                            : r.reference || "—"}
                        </td>
                        <td data-label="Particulars" className="td-particulars">
                          {r.description || r.type}
                          {r.bankId ? (
                            <div style={{ marginTop: 4 }}>
                              <LedgerRefLink kind="bank" id={r.bankId} label={r.bankName || "Bank"} />
                            </div>
                          ) : null}
                        </td>
                        <td data-label="Method">
                          {!r.method ? "—"
                            : MODE_LEDGER_ROUTE[r.method] ? <a href={routeHref(MODE_LEDGER_ROUTE[r.method])}>{r.method}</a>
                            : r.method}
                        </td>
                        <td data-label="Debit" className="num" style={{ color: r.debitOrCredit === "debit" ? "var(--red)" : undefined }}>{r.debitOrCredit === "debit" ? fmt(r.amount) : "—"}</td>
                        <td data-label="Credit" className="num" style={{ color: r.debitOrCredit === "credit" ? "var(--green)" : undefined }}>{r.debitOrCredit === "credit" ? fmt(r.amount) : "—"}</td>
                        <td data-label="Balance" className="num">{fmt(r.runningBalance)}<LedgerEntryActions entryId={r.entryId} row={r} editable={r.editable} onChanged={transactionPager.refresh} /></td>
                      </tr>
                      );
                    })}
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
