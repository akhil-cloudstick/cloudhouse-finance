"use client";

import { useEffect, useRef, useState } from "react";
import { useModal } from "@/common/components/ModalProvider";
import { Icon } from "@/common/components/Icon";
import { fmtW } from "@/common/utils/format";
import { StatusChip } from "@/common/components/ui/StatusChip";
import { LockerModalContent } from "@/modules/packets/components/LockerModalContent";
import { LockerDetailModalContent } from "@/modules/packets/components/LockerDetailModalContent";
import { listActiveBranches } from "@/modules/branches/services/branchService";
import { type BranchView } from "@/modules/branches/types/branch-types";
import { listCustomersPage } from "@/modules/customers/services/customerService";
import { useShowBranch, useShowBranchFilter } from "@/common/hooks/use-branch-switch";
import { listLockers } from "@/modules/lockers/services/lockerService";
import { type LockerView } from "@/modules/lockers/types/locker-types";
import { listPacketsPage, getPacketByCode } from "@/modules/packets/services/packetService";
import { type PacketView } from "@/modules/packets/types/packet-types";
import { FilterPanel, type FilterCategory, type FilterValue } from "@/common/components/ui/FilterPanel";
import { usePersistedState } from "@/common/hooks/use-persisted-state";
import { useAuth } from "@/common/providers/AuthProvider";
import { useResponsivePageSize, useScrollPageSize } from "@/common/utils/responsive";
import { ScrollSentinel } from "@/common/components/ui/ScrollSentinel";
import { navigate, routeHref } from "@/common/services/appRoutes";
import { useCanOpenRoute } from "@/common/hooks/use-can-open-route";

// Stable empty selection for a hidden Branch filter (see useShowBranchFilter).
const NO_BRANCHES: string[] = [];

/* Mirrors packet.Status* in backend/internal/packet/model.go. */
const PACKET_STATUS_OPTIONS = [
  { value: "Packet Generated", label: "Packet Generated" },
  { value: "Locker Stored", label: "Locker Stored" },
  { value: "Bank Pledged", label: "Bank Pledged" },
  { value: "Released", label: "Released" },
  { value: "Returned", label: "Returned" },
];

/* Ported from legacy/app.js's `renderPackets()`. Now reads real data from
 * the Go backend (`GET /api/v1/packets`, `GET /api/v1/lockers`) instead of
 * synthesizing packet rows from the loan list — see backend/internal/packet
 * and backend/internal/locker. */
export function PacketsPage() {
  const { openModal } = useModal();
  // Lockers are their own module in the permission catalogue, separate from
  // the packets stored in them — hidden, not disabled, when not granted
  // (see Customers.tsx).
  const { can } = useAuth();
  const canOpen = useCanOpenRoute();
  const showBranch = useShowBranch();
  // A link inside a clickable row: stopping propagation keeps the row's own
  // onClick from firing, but also keeps the click from AppShell's link
  // interceptor — so navigate here (through the permission guard) instead of
  // letting the browser do a full page load. Same rules as LedgerRefLink.
  const cellLink = (to: string) => (e: React.MouseEvent) => {
    e.stopPropagation();
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    navigate(to);
  };
  const canCreateLockers = can("Locker_Management", "can_create_locker");
  const canUpdateLockers = can("Locker_Management", "can_update_locker");

  const basePageSize = useResponsivePageSize(15, 15);
  // Card mode (<=1100px): scroll-to-load replaces Prev/Next on both tables.
  const { cards, size: pageSize, more } = useScrollPageSize(basePageSize);
  const { size: lockerSize, more: moreLockers } = useScrollPageSize(basePageSize);
  const [packets, setPackets] = useState<PacketView[] | null>(null);
  const [lockers, setLockers] = useState<LockerView[]>([]);
  const [error, setError] = useState("");
  const [lookup, setLookup] = useState("");
  const [lookupErr, setLookupErr] = useState("");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [lockerPage, setLockerPage] = useState(1);
  // Card mode shows one table at a time; these tabs switch between them.
  const [cardTab, setCardTab] = useState<"packets" | "lockers">("packets");
  // No branch filter in a single-branch business, or while the global
  // branch selector already scopes the page (see useShowBranchFilter).
  const showBranchFilter = useShowBranchFilter();
  const [statuses, setStatuses] = usePersistedState<string[]>("packets:statuses", []);
  const [savedBranchIds, setBranchIds] = usePersistedState<string[]>("packets:branches", []);
  // A hidden Branch filter must not keep narrowing rows with a stale saved
  // selection (it would intersect the global branch to an empty page).
  const branchIds = showBranchFilter ? savedBranchIds : NO_BRANCHES;
  const [customerIds, setCustomerIds] = usePersistedState<string[]>("packets:customers", []);
  const [savedLockerBranchIds, setLockerBranchIds] = usePersistedState<string[]>("lockers:branches", []);
  const lockerBranchIds = showBranchFilter ? savedLockerBranchIds : NO_BRANCHES;
  const [lockerStatuses, setLockerStatuses] = usePersistedState<string[]>("lockers:statuses", []);
  const [branches, setBranches] = useState<BranchView[]>([]);
  useEffect(() => { listActiveBranches().then(setBranches).catch(() => {}); }, []);
  const branchOptions = branches.map((b) => ({ value: String(b.id), label: b.name }));
  // Every section is multi-select: a packet matches any selected value within
  // a section. Customer is backend-searched (async), like the Loans filter.
  const filterCategories: FilterCategory[] = [
    { key: "status", label: "Status", kind: "static", options: PACKET_STATUS_OPTIONS },
    ...(!showBranchFilter ? [] : [{ key: "branch", label: "Branch", kind: "static" as const, searchHint: "Searches: branch name", options: branchOptions }]),
    {
      key: "customer", label: "Customer", kind: "async" as const, searchHint: "Searches: customer name, customer code, phone",
      fetchOptions: (search: string, p: number) =>
        listCustomersPage(search, p, { branchIds: branchIds.length ? branchIds : undefined }, 20).then((res) => ({
          items: res.items.map((c) => ({ value: String(c.id), label: `${c.name} (${c.code})` })),
          hasMore: res.hasMore,
        })),
    },
  ];
  const filterValue: FilterValue = { status: statuses, branch: branchIds, customer: customerIds };
  // Locker column filter: which branch a locker is in, and whether it still has room.
  const lockerFilterCategories: FilterCategory[] = [
    ...(!showBranchFilter ? [] : [{ key: "branch", label: "Branch", kind: "static" as const, searchHint: "Searches: branch name", options: branchOptions }]),
    { key: "status", label: "Status", kind: "static", options: [
      { value: "active", label: "Has room" },
      { value: "full", label: "Full" },
      { value: "inactive", label: "Inactive" },
    ] },
  ];
  const lockerFilterValue: FilterValue = { branch: lockerBranchIds, status: lockerStatuses };
  const statusKey = statuses.join(",");
  const branchKey = branchIds.join(",");
  const customerKey = customerIds.join(",");
  const lockerFilterKey = lockerBranchIds.join(",") + "|" + lockerStatuses.join(",");
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const lockerTotalPages = Math.max(1, Math.ceil(lockers.length / basePageSize));
  const lockerPageClamped = Math.min(lockerPage, lockerTotalPages);
  const pagedLockers = cards ? lockers.slice(0, lockerSize) : lockers.slice((lockerPageClamped - 1) * basePageSize, lockerPageClamped * basePageSize);

  /* Guards against an out-of-order response winning: switching status
   * quickly can leave an earlier, slower request in flight, and without
   * this its rows would overwrite the newer filter's. Only the newest
   * request may write. Same pattern as Cash.tsx's summarySeq. */
  const loadSeq = useRef(0);

  // Debounced from the same search box `lookup` feeds — typing filters the
  // table (packet code, loan number, OR customer name, see backend's
  // packet.Filter.Q) the same way Loans.tsx's search box does, while Enter
  // still jumps straight to a packet if `lookup` is its exact code (the
  // barcode-scanner flow below).
  const [q, setQ] = useState("");
  useEffect(() => {
    const handle = setTimeout(() => setQ(lookup.trim()), 300);
    return () => clearTimeout(handle);
  }, [lookup]);

  // The locker column is independent of the table: it loads once (and after a
  // locker is added/edited), never on a page/status/search change.
  async function loadLockers() {
    try {
      setLockers(await listLockers({ branchId: lockerBranchIds.map(Number), status: lockerStatuses }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load lockers.");
    }
  }

  async function loadPackets() {
    const seq = ++loadSeq.current;
    try {
      const p = await listPacketsPage(page, { status: statuses, branchId: branchIds.map(Number), customerId: customerIds.map(Number), q: q || undefined }, pageSize);
      if (seq !== loadSeq.current) return;
      setPackets(p.items);
      setTotal(p.total);
      setError("");
    } catch (e) {
      if (seq !== loadSeq.current) return;
      setError(e instanceof Error ? e.message : "Failed to load packets.");
    }
  }

  function load() {
    loadLockers();
    loadPackets();
  }

  useEffect(() => { loadLockers(); }, [lockerFilterKey]);
  useEffect(() => { setLockerPage(1); }, [lockerFilterKey]);
  useEffect(() => { loadPackets(); }, [page, statusKey, branchKey, customerKey, q, pageSize]);
  // A new search term always starts back at page 1 — otherwise a filter
  // typed while sitting on page 3 can land on an empty page.
  useEffect(() => { setPage(1); }, [q]);

  async function onLookup(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key !== "Enter") return;
    const code = lookup.trim().toUpperCase();
    if (!code) return;
    setLookupErr("");
    try {
      const p = await getPacketByCode(code);
      navigate(`packet/${p.code}`);
    } catch {
      // Not an exact packet code — that's fine, the live `q` filter above
      // already narrowed the table to whatever matched; only complain when
      // it found nothing there either.
      if ((packets || []).length === 0) {
        setLookupErr(`No packets match "${lookup.trim()}".`);
      }
    }
  }

  return (
    <>
      <div className="page-h">
        <div><h1>Gold Packets &amp; Lockers</h1><p>Barcode/QR tracked packets · locker allocation &amp; movement</p></div>
        <div className="sp" />
        <div className="search"><Icon name="search" /><input
          className="inp"
          placeholder="Search packet code, loan number, or customer — or scan a code (Enter)"
          title="Searches: packet code, loan number, customer name, customer code, locker code · scan or type an exact packet code and press Enter to open it"
          value={lookup}
          onChange={(e) => { setLookup(e.target.value); setLookupErr(""); }}
          onKeyDown={onLookup}
        /></div>
        {canCreateLockers && <button className="btn" onClick={() => openModal(<LockerModalContent key="new" onSaved={load} />)}><Icon name="plus" /> Add Locker</button>}
      </div>
      {lookupErr && <p style={{ color: "var(--red)", fontSize: 12.5, marginTop: -4, marginBottom: 8 }}>{lookupErr}</p>}
      <hr className="gold-rule" style={{ margin: "4px 0 18px" }} />
      {error && (
        <p style={{ color: "var(--red)", fontSize: 13.5 }}>
          Something went wrong. Please try again later.
        </p>
      )}
      {cards && (
        <div className="tabs" style={{ marginTop: 4, marginBottom: 8 }}>
          <button className={cardTab === "packets" ? "on" : ""} onClick={() => setCardTab("packets")}>Packets</button>
          <button className={cardTab === "lockers" ? "on" : ""} onClick={() => setCardTab("lockers")}>Lockers</button>
        </div>
      )}
      <div className="grid cols21 packets-grid">
        <div className="card tbl-card tbl-card-fill" style={cards && cardTab !== "packets" ? { display: "none" } : undefined}>
          <div className="hd">
            <h3>Packets</h3>
            <div className="sp" />
            <FilterPanel
              categories={filterCategories}
              value={filterValue}
              onChange={(next) => {
                setStatuses(Array.isArray(next.status) ? next.status : []);
                setBranchIds(Array.isArray(next.branch) ? next.branch : []);
                setCustomerIds(Array.isArray(next.customer) ? next.customer : []);
                setPage(1);
              }}
              hideChips
              hideClearAll
            />
          </div>
          <div className="tbl-wrap">
            <table className="tbl tbl-center tbl-cards">
              <thead>
                <tr><th>Packet Code</th><th>Loan</th><th>Customer</th><th className="num">Items</th><th className="num">Weight</th><th>Locker</th><th>Status</th></tr>
              </thead>
              <tbody>
                {packets === null && !error && (
                  <tr><td colSpan={7} style={{ color: "var(--muted)" }}>Loading packets…</td></tr>
                )}
                {packets !== null && packets.length === 0 && (
                  <tr><td colSpan={7} style={{ color: "var(--muted)" }}>No packets yet — packets are created automatically when a loan is opened.</td></tr>
                )}
                {(packets || []).map((p) => {
                  const locker = lockers.find((l) => l.id === p.currentLockerId);
                  // The loan's own outcome overrides the packet's own
                  // (possibly stale) workflow stage once the gold has been
                  // sold — same override PacketDetail.tsx applies.
                  const displayStatus = p.loanStatus === "Auctioned" || p.loanStatus === "Auctioned - Balance Due" ? "Auctioned" : p.status;
                  return (
                    <tr key={p.id} className="click" onClick={() => { navigate(`packet/${p.code}`); }}>
                      <td data-label="Packet Code"><a href={routeHref(`packet/${p.code}`)} className="id" onClick={cellLink(`packet/${p.code}`)}>{p.code}</a></td>
                      <td data-label="Loan">{canOpen("loan") ? <a href={routeHref(`loan/${p.loanNumber}`)} onClick={cellLink(`loan/${p.loanNumber}`)}>{p.loanNumber}</a> : p.loanNumber}</td>
                      <td data-label="Customer">{p.customerName}</td>
                      <td className="num" data-label="Items">{p.itemCount}</td>
                      <td className="num" data-label="Weight">{fmtW(p.totalWeight)}</td>
                      <td data-label="Locker">{locker ? locker.code : "—"}</td>
                      <td data-label="Status"><StatusChip status={displayStatus} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <ScrollSentinel enabled={cards && page < totalPages} onVisible={more} watch={(packets || []).length} />
          <div className="ft ft-scroll-hide" style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <button className="btn plain sm" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>‹ Prev</button>
            <span style={{ fontSize: 12.5 }}>Page {page} of {totalPages}</span>
            <button className="btn plain sm" disabled={page >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))}>Next ›</button>
          </div>
        </div>
        <div className="card tbl-card tbl-card-fill" style={cards && cardTab !== "lockers" ? { display: "none" } : undefined}>
          <div className="hd">
            <h3>Lockers</h3>
            <div className="sp" />
            <FilterPanel
              categories={lockerFilterCategories}
              value={lockerFilterValue}
              onChange={(next) => {
                setLockerBranchIds(Array.isArray(next.branch) ? next.branch : []);
                setLockerStatuses(Array.isArray(next.status) ? next.status : []);
              }}
              hideChips
              hideClearAll
            />
          </div>
          <div className="tbl-wrap">
            <table className="tbl tbl-center lockers-tbl tbl-cards">
              <thead>
                <tr><th>Locker</th>{showBranch && <th>Branch</th>}<th className="num">Packets</th><th>Status</th></tr>
              </thead>
              <tbody>
                {lockers.length === 0 && (
                  <tr><td colSpan={showBranch ? 4 : 3} style={{ color: "var(--muted)" }}>
                    {packets === null && !error ? "Loading lockers…" : "No lockers added yet."}
                  </td></tr>
                )}
                {pagedLockers.map((l) => (
                  <tr key={l.id} className="click" onClick={() => openModal(<LockerDetailModalContent key={l.id} locker={l} canUpdate={canUpdateLockers} onChanged={load} />, true)}>
                    <td data-label="Locker"><span className="id">{l.code}</span></td>
                    {showBranch && <td data-label="Branch">{l.branchName}</td>}
                    <td className="num" data-label="Packets">{l.occupied} / {l.capacity}</td>
                    <td data-label="Status"><span className={`chip ${l.isActive ? "green" : "gray"}`}>{l.isActive ? "Active" : "Inactive"}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ScrollSentinel enabled={cards && lockers.length > lockerSize} onVisible={moreLockers} watch={lockerSize} />
          <div className="ft ft-scroll-hide" style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <button className="btn plain sm" disabled={lockerPageClamped <= 1} onClick={() => setLockerPage(Math.max(1, lockerPageClamped - 1))}>‹ Prev</button>
            <span style={{ fontSize: 12.5 }}>Page {lockerPageClamped} of {lockerTotalPages}</span>
            <button className="btn plain sm" disabled={lockerPageClamped >= lockerTotalPages} onClick={() => setLockerPage(Math.min(lockerTotalPages, lockerPageClamped + 1))}>Next ›</button>
          </div>
        </div>
      </div>
    </>
  );
}
