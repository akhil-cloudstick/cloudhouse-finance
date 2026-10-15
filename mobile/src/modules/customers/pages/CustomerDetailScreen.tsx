import React, { useEffect, useState } from "react";
import { LayoutAnimation, Linking, Pressable, StyleSheet, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AccRow,
  Avatar,
  Buffering,
  C,
  Card,
  ChipToggle,
  ConfirmSheet,
  Field,
  Sheet,
  SheetListItem,
  DetailRow,
  EmptyText,
  FlatHeader,
  GroupedFilter,
  KycBadge,
  PIcon,
  FabMenu,
  PillTabs,
  PrimaryButton,
  Screen,
  SearchInput,
  SectionTitle,
  ServerFlatList,
  Txt,
  emptyGroupedFilter,
  gfDate,
  type GFSection,
  type GroupedFilterValue,
  openPage,
  useShell,
  toast,
} from "@/common/components/ui";
import { CustomerFormSheet } from "@/modules/customers/components/CustomerFormSheet";
import { useServerList, type ServerList, type ServerPage } from "@/common/hooks/use-server-list";
import { useRefetchOnFocus, useResetOnBlur } from "@/common/hooks/use-refetch-on-focus";
import {
  checkAadhaarVerify,
  getCustomer,
  getCustomerLoanTotals,
  hardDeleteCustomer,
  startAadhaarVerify,
  verifyCustomerPan,
  listCustomerAuctionHistoryPage,
  listCustomerBankPledgesPage,
  listCustomerOrnamentsPage,
  listCustomerPaymentsPage,
} from "@/modules/customers/services/customerService";
import { listLoansPage } from "@/modules/loans/services/loanService";
import { LOAN_STATUS_OPTIONS, loanFilterParams } from "@/modules/loans/components/LoanFilterSheet";
import { BillLink, useLedgerList } from "@/common/components/LedgerList";
import { ApiError } from "@/common/services/httpClient";
import { useAuth } from "@/common/providers/AuthProvider";
import { useCanOpen } from "@/common/config/routePermissions";
import { dmy, inr } from "@/common/utils/format";
import type { FabMenuAction } from "@/common/components/ui";
import type { Customer } from "@/modules/customers/types/customer-types";
import type { CustomerAuctionRow, CustomerBankPledgeRow, CustomerOrnamentRow, CustomerPaymentRow, Loan } from "@/modules/loans/types/loan-types";

// Customer detail — prototype #header-customerdesc + #page-customerdesc:
// expandable header card, nominee card, then pill tabs (Loans / Ornaments /
// Payments / Bank Pledges / Auctions / Ledger). Each tab is its own
// server-paged list with its own search box (server `q` on the customer
// sub-endpoints; loans via GET /loans?customerId=&q=). Ledger has no search
// box — it's the same Date/Ref No/Particulars/Debit/Credit/Balance shape as
// the web CustomerDetail.tsx's Ledger tab, backed by the same
// GET /cash-movements/transactions/customer/:id endpoint.

const TABS = ["Loans", "Ornaments", "Payments", "Bank Pledges", "Auctions", "Ledger"] as const;
type Tab = (typeof TABS)[number];

const hasDate = (v?: string | null) => !!v && !v.startsWith("0001");

function ageFromDob(dob: string): number {
  const birth = new Date(+dob.slice(0, 4), +dob.slice(5, 7) - 1, +dob.slice(8, 10));
  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  if (today.getMonth() < birth.getMonth() || (today.getMonth() === birth.getMonth() && today.getDate() < birth.getDate())) age -= 1;
  return age;
}

const maskPan = (pan: string) => (pan.length >= 5 ? `${pan.slice(0, 2)}${"×".repeat(pan.length - 5)}${pan.slice(-3)}` : pan);
const isVerified = (s?: string) => (s ?? "").toLowerCase() === "verified";

type StatusBadgeProps = { status?: string };

function StatusBadge({ status }: StatusBadgeProps) {
  if (!status) return null;
  return <KycBadge verified={isVerified(status)} label={status} />;
}

type CustomerActionsProps = { c: Customer; onEdit: () => void; onRequest?: () => void };

/** Customer actions — one corner menu, like Bank Pledges, instead of stacked buttons. */
function CustomerActions({ c, onEdit, onRequest }: CustomerActionsProps) {
  const canUpdate = useAuth().can("Customer_Management", "can_update_customer");
  const canHardDelete = useAuth().can("Customer_Management", "can_hard_delete_customer");
  const canCreateLoan = useAuth().can("Loan_Management", "can_create_loan");
  const shell = useShell();
  const qc = useQueryClient();
  const router = useRouter();
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  // DigiLocker is a redirect flow: once the login link is opened, the item flips to "Check status".
  const [aadhaarStarted, setAadhaarStarted] = useState(false);

  // PAN verification through the KYC provider — the customer's PAN status updates in place.
  const verifyPan = useMutation({
    mutationFn: () => verifyCustomerPan(c.id),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["customer", String(c.id)] });
      const status = r.customer.panStatus;
      if (status === "Verified") toast.success("PAN verified", r.message);
      else if (status === "Name Mismatch") toast.error("PAN verification failed", "The name does not match.");
      else toast.error("PAN verification failed", r.message);
    },
    onError: (e) => toast.error("PAN verification failed", e instanceof ApiError ? e.message : "Try again."),
  });

  // Aadhaar verification through DigiLocker — the customer completes Aadhaar + OTP in the browser, then staff check the result.
  const startAadhaar = useMutation({
    mutationFn: () => startAadhaarVerify(c.id, "cloudhouse://esign-callback"),
    onSuccess: (r) => {
      setAadhaarStarted(true);
      if (r.url) Linking.openURL(r.url).catch(() => toast.error("Could not open DigiLocker", "Try again."));
      toast.success("DigiLocker opened", "Complete Aadhaar + OTP login, then check the status here.");
    },
    onError: (e) => toast.error("Aadhaar verification failed", e instanceof ApiError ? e.message : "Try again."),
  });
  const checkAadhaar = useMutation({
    mutationFn: () => checkAadhaarVerify(c.id),
    onSuccess: (r) => {
      if (!r.customer) return toast.error("Not completed yet", "Finish the DigiLocker login, then check again.");
      setAadhaarStarted(false);
      qc.invalidateQueries({ queryKey: ["customer", String(c.id)] });
      if (r.customer.aadhaarStatus === "Verified") toast.success("Aadhaar verified", r.matchedName ? `Matched name "${r.matchedName}".` : undefined);
      else toast.error("Aadhaar verification failed", (r.failureReasons ?? []).join(", ") || "The details do not match.");
    },
    onError: (e) => toast.error("Could not check Aadhaar status", e instanceof ApiError ? e.message : "Try again."),
  });

  // Permanent delete — the server refuses while any loan is still open and names the loans.
  const hardDelete = useMutation({
    mutationFn: () => hardDeleteCustomer(c.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["customers"] });
      toast.success("Customer deleted permanently");
      router.back();
    },
    onError: (e) => setDeleteError(e instanceof ApiError ? e.message : "Could not delete the customer — try again."),
  });


  const showPan = canUpdate && !!c.pan && c.panStatus !== "Verified";
  const showAadhaar = canUpdate && !!c.aadhaarLast4 && c.aadhaarStatus !== "Verified";
  const actions: FabMenuAction[] = [
    ...(canUpdate ? [{ label: "Edit Customer", icon: "edit", onPress: onEdit }] : []),
    ...(onRequest ? [{ label: "Extension / Release", icon: "calendar", onPress: onRequest }] : []),
    ...(canCreateLoan ? [{ label: "New Loan", icon: "plus", onPress: () => shell.openNewLoanFor(c) }] : []),
    ...(showPan ? [{ label: verifyPan.isPending ? "Verifying PAN…" : "Verify PAN", icon: "shield", onPress: () => verifyPan.mutate() }] : []),
    ...(showAadhaar
      ? [aadhaarStarted
          ? { label: checkAadhaar.isPending ? "Checking…" : "Check Aadhaar Status", icon: "shield", onPress: () => checkAadhaar.mutate() }
          : { label: startAadhaar.isPending ? "Starting…" : "Verify Aadhaar", icon: "shield", onPress: () => startAadhaar.mutate() }]
      : []),
    ...(canHardDelete ? [{ label: "Delete Customer", icon: "alert", onPress: () => { setDeleteError(null); setDeleteOpen(true); } }] : []),
  ];
  return (
    <>
      {actions.length ? <FabMenu label="Customer actions" actions={actions} /> : null}
      <ConfirmSheet
        visible={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        title="Delete Customer Permanently"
        danger
        message={`Permanently delete ${c.name} and every record tied to them — loans, payments, ornaments and reminders? This cannot be undone. It is refused while any of their loans is still open.`}
        confirmLabel="Delete Permanently"
        loading={hardDelete.isPending}
        error={deleteError}
        onConfirm={() => hardDelete.mutate()}
      />
    </>
  );
}

type HeaderCardProps = { c: Customer };

/** .cust-header-card — collapsible identity card. */
function HeaderCard({ c }: HeaderCardProps) {
  const [open, setOpen] = useState(true);


  return (
    <View style={s.hc}>
      <Pressable
        style={s.hcCollapsed}
        onPress={() => {
          LayoutAnimation.configureNext(LayoutAnimation.create(250, "easeInEaseOut", "opacity"));
          setOpen((o) => !o);
        }}
      >
        <Avatar name={c.name} size={44} radius={13} fontSize={15} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Txt style={s.hcName} numberOfLines={1}>
            {c.name}
          </Txt>
          <Txt style={s.hcSub} numberOfLines={1}>
            {[c.code, c.phone].filter(Boolean).join(" · ")}
          </Txt>
        </View>
        <View style={open ? { transform: [{ rotate: "180deg" }] } : null}>
          <PIcon name="chevdown" color={C.muted} />
        </View>
      </Pressable>
      {open ? (
        <View style={s.hcExpand}>
          <DetailRow first k="Date of birth" v={hasDate(c.dob) ? `${dmy(c.dob)} · ${ageFromDob(c.dob)} yrs` : "—"} />
          <DetailRow k="Address" v={c.address || "—"} />
          <DetailRow k="Branch" v={c.branch?.name || "—"} />
          <DetailRow
            k="PAN"
            v={
              c.pan ? (
                <View style={s.inline}>
                  <Txt style={s.v}>{maskPan(c.pan)}</Txt>
                  <StatusBadge status={c.panStatus} />
                </View>
              ) : (
                "—"
              )
            }
          />
          <DetailRow
            k="Aadhaar"
            v={
              c.aadhaarLast4 ? (
                <View style={{ alignItems: "flex-end" }}>
                  <View style={s.inline}>
                    <Txt style={s.v}>{`×××× ×××× ${c.aadhaarLast4}`}</Txt>
                    <StatusBadge status={c.aadhaarStatus} />
                  </View>
                </View>
              ) : (
                "—"
              )
            }
          />
          <DetailRow k="KYC status" v={c.kycStatus ? <StatusBadge status={c.kycStatus} /> : "—"} />
        </View>
      ) : null}
    </View>
  );
}

// Each tab's own filter (a GroupedFilter above its search): a Date range everywhere, plus Status on Loans.
type TabFilters = { from?: string; to?: string; status?: string; servicing?: string };
const DATE_SECTION: GFSection = { kind: "date", key: "date", label: "Date" };
const LOAN_SECTIONS: GFSection[] = [{ kind: "static", key: "status", label: "Status", options: LOAN_STATUS_OPTIONS.map((s) => ({ value: s, label: s })) }, DATE_SECTION];
const dateParams = (fv: GroupedFilterValue): TabFilters => ({ from: gfDate(fv, "date").from || undefined, to: gfDate(fv, "date").to || undefined });

// What the persistent list needs from the active tab.
type TabView = {
  list: ServerList<any>;
  controls: React.ReactElement;
  emptyText: string;
  keyOf: (t: any, i: number) => string;
  renderItem: (t: any, i: number) => React.ReactElement;
};

// Fetched tab pages stay fresh this long, so switching back shows them at once without a refetch.
const TAB_STALE = 60_000;

type TabListOptions<T> = {
  /** Prefixes row keys so two tabs' ids never collide in the shared list. */
  name: string;
  queryKey: unknown[];
  fetchPage: (p: TabFilters & { q?: string; limit: number; offset: number }) => Promise<ServerPage<T>>;
  /** Filter sections (default: Date) and how their value becomes request params. */
  sections?: GFSection[];
  toParams?: (fv: GroupedFilterValue) => TabFilters;
  enabled: boolean;
  placeholder: string;
  emptyText: string;
  keyOf: (t: T) => string;
  renderItem: (t: T, i: number) => React.ReactElement;
};

/** One tab's server-paged data + its own filter and search. Every tab's hook
 * lives in the screen at all times (a tab that isn't enabled yet just sits
 * idle), so the shared list swaps between already-cached tabs instantly. */
function useTabList<T>({ name, queryKey, fetchPage, sections = [DATE_SECTION], toParams = dateParams, enabled, placeholder, emptyText, keyOf, renderItem }: TabListOptions<T>): TabView {
  const [fv, setFv] = useState<GroupedFilterValue>(emptyGroupedFilter());
  const list = useServerList<T, TabFilters>({ key: queryKey, fetchPage, filters: toParams(fv), enabled, staleTime: TAB_STALE });
  const controls = (
    <>
      <View style={{ paddingHorizontal: 18, paddingTop: 12, paddingBottom: 16 }}>
        <GroupedFilter title="Filter" sections={sections} value={fv} onChange={setFv} />
      </View>
      <SearchInput value={list.search} onChangeText={list.setSearch} placeholder={placeholder} style={{ paddingBottom: 16 }} />
    </>
  );
  return { list, controls, emptyText: list.search ? "Nothing matches your search." : emptyText, keyOf: (t: T) => `${name}-${keyOf(t)}`, renderItem };
}

type LoanRequestPickerProps = { customerId: number; visible: boolean; onClose: () => void };

/** Extension / Release for one of this customer's open loans — pick which, then it opens on that loan (web's picker). */
function LoanRequestPicker({ customerId, visible, onClose }: LoanRequestPickerProps) {
  const [kind, setKind] = useState<"extend" | "release">("extend");
  const loans = useQuery({
    queryKey: ["customer-open-loans", customerId],
    queryFn: () => listLoansPage({ customerId, limit: 50, offset: 0 }),
    enabled: visible,
  });
  const open = (loans.data?.items ?? []).filter((l) => !/closed|rejected|released/i.test(l.status ?? ""));
  return (
    <Sheet visible={visible} onClose={onClose} title="Extension / Release" maxHeightPct={75}>
      <Field label="Request">
        <ChipToggle options={["extend", "release"] as const} labels={{ extend: "Extension", release: "Release" }} value={kind} onChange={setKind} />
      </Field>
      {loans.isLoading ? (
        <Buffering block />
      ) : open.length === 0 ? (
        <EmptyText>No open loans for this customer.</EmptyText>
      ) : (
        open.map((l, i) => (
          <SheetListItem
            key={l.id}
            first={i === 0}
            icon={kind === "extend" ? "calendar" : "coin"}
            title={l.loanNumber}
            sub={`${l.status} · ${inr(l.principalAmount)}`}
            onPress={() => {
              onClose();
              openPage(`/loans/${l.id}?action=${kind}`);
            }}
          />
        ))
      )}
    </Sheet>
  );
}

export default function CustomerDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const customerId = Number(id);
  // Switching tabs leaves the page where it is (no jump to the tab bar) — the tabs are only tappable while on screen anyway.
  const [tab, setTab] = useState<Tab>("Loans");
  const [editOpen, setEditOpen] = useState(false);
  const [requestOpen, setRequestOpen] = useState(false);
  // Once the open tab has loaded, the other tabs are fetched in the background so switching is instant.
  const [warm, setWarm] = useState(false);
  const canUpdateLoan = useAuth().can("Loan_Management", "can_update_loan");

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["customer", id],
    queryFn: () => getCustomer(customerId),
    enabled: !!id,
  });
  useRefetchOnFocus(refetch);
  // The customer's overall loan totals (web's "Overall Loan Details").
  const totals = useQuery({ queryKey: ["customer-totals", id], queryFn: () => getCustomerLoanTotals(customerId), enabled: !!id, retry: false });
  useResetOnBlur(() => setEditOpen(false));

  const viewLoan = (loanId: number) => openPage(`/loans/${loanId}`);
  const canOpen = useCanOpen();
  const canViewLoans = canOpen("/loans");
  // The Auctions tab needs "can view auction module".
  const visibleTabs: readonly Tab[] = canOpen("/auctions") ? TABS : TABS.filter((t) => t !== "Auctions");
  const on = (t: Tab) => !!id && (tab === t || (warm && visibleTabs.includes(t)));

  const loans = useTabList<Loan>({
    name: "loan",
    queryKey: ["loans", "customer", customerId],
    fetchPage: (p) => listLoansPage({ ...p, customerId }),
    sections: LOAN_SECTIONS,
    toParams: loanFilterParams,
    enabled: on("Loans"),
    placeholder: "Search by loan ID or scheme",
    emptyText: "No loans for this customer.",
    keyOf: (l) => String(l.id),
    renderItem: (l, i) => (
      <AccRow
        defaultOpen={i === 0}
        id={l.loanNumber}
        name={l.scheme?.name ?? "Loan"}
        sub={l.status ? `${l.status} loan` : undefined}
        amount={inr(l.outstandingAmount)}
        status={l.status}
        details={[
          { k: "Principal", v: inr(l.principalAmount) },
          { k: "Opened", v: dmy(l.openedDate) },
          { k: "Due", v: dmy(l.dueDate) },
        ]}
        actions={canViewLoans ? [{ label: "View Loan", primary: true, onPress: () => viewLoan(l.id) }] : undefined}
      />
    ),
  });
  const ornaments = useTabList<CustomerOrnamentRow>({
    name: "ornament",
    queryKey: ["customerOrnaments", customerId],
    fetchPage: (p) => listCustomerOrnamentsPage(customerId, p.limit, p.offset, p.q, p),
    enabled: on("Ornaments"),
    placeholder: "Search by ornament or loan ID",
    emptyText: "No ornaments for this customer.",
    keyOf: (o) => String(o.id),
    renderItem: (o) => (
      <AccRow
        id={o.name}
        idColor={C.brandDeep}
        name={o.loanNumber}
        sub={o.purity}
        amount={inr(o.goldValue)}
        status={o.releasedAt ? "Released" : undefined}
        details={[
          { k: "Net weight", v: `${+Number(o.netWeight ?? 0).toFixed(2)} g` },
          { k: "Gold value", v: inr(o.goldValue) },
          ...(o.quantity > 1 ? [{ k: "Quantity", v: String(o.quantity) }] : []),
        ]}
        actions={canViewLoans ? [{ label: "View Loan", onPress: () => viewLoan(o.loanId) }] : undefined}
      />
    ),
  });
  const payments = useTabList<CustomerPaymentRow>({
    name: "payment",
    queryKey: ["customerPayments", customerId],
    fetchPage: (p) => listCustomerPaymentsPage(customerId, p.limit, p.offset, p.q, p),
    enabled: on("Payments"),
    placeholder: "Search by loan ID or payment type",
    emptyText: "No payments for this customer.",
    keyOf: (p) => String(p.id),
    renderItem: (p) => (
      <AccRow
        id={p.loanNumber}
        idColor={C.brandDeep}
        name={p.type}
        sub={dmy(p.paidOn)}
        amount={inr(p.amount)}
        details={[
          { k: "Paid on", v: dmy(p.paidOn) },
          { k: "Method", v: p.method || "—" },
          ...(p.reference ? [{ k: "Reference", v: p.reference }] : []),
        ]}
        actions={canViewLoans ? [{ label: "View Loan", onPress: () => viewLoan(p.loanId) }] : undefined}
      />
    ),
  });
  const pledges = useTabList<CustomerBankPledgeRow>({
    name: "pledge",
    queryKey: ["customerBankPledges", customerId],
    fetchPage: (p) => listCustomerBankPledgesPage(customerId, p.limit, p.offset, p.q, p),
    enabled: on("Bank Pledges"),
    placeholder: "Search by loan ID or bank",
    emptyText: "No bank pledges for this customer.",
    keyOf: (b) => String(b.id),
    renderItem: (b) => (
      <AccRow
        id={b.loanNumber}
        idColor={C.brandDeep}
        name={b.bankName}
        sub={dmy(b.pledgeDate)}
        amount={inr(b.pledgedAmount)}
        status={b.status}
        details={[
          { k: "Pledge date", v: dmy(b.pledgeDate) },
          { k: "Status", v: b.status },
          ...(b.referenceNumber ? [{ k: "Reference", v: b.referenceNumber }] : []),
          ...(hasDate(b.releaseDate) ? [{ k: "Released on", v: dmy(b.releaseDate) }] : []),
        ]}
        actions={canViewLoans ? [{ label: "View Loan", onPress: () => viewLoan(b.loanId) }] : undefined}
      />
    ),
  });
  const auctions = useTabList<CustomerAuctionRow>({
    name: "auction",
    queryKey: ["customerAuctions", customerId],
    fetchPage: (p) => listCustomerAuctionHistoryPage(customerId, p.limit, p.offset, p.q, p),
    enabled: on("Auctions"),
    placeholder: "Search by loan ID or stage",
    emptyText: "No auction cases for this customer.",
    keyOf: (a) => String(a.id),
    renderItem: (a) => {
      const surplus = a.surplusShortfall ?? 0;
      return (
        <AccRow
          id={a.loanNumber}
          idColor={C.brandDeep}
          name={a.stage}
          sub={hasDate(a.auctionDate) ? dmy(a.auctionDate) : undefined}
          amount={a.saleAmount ? inr(a.saleAmount) : undefined}
          details={[
            { k: "Auction date", v: hasDate(a.auctionDate) ? dmy(a.auctionDate) : "—" },
            {
              k: surplus >= 0 ? "Surplus" : "Shortfall",
              v: a.saleAmount ? inr(Math.abs(surplus)) : "—",
              color: a.saleAmount ? (surplus >= 0 ? C.green : C.red) : undefined,
            },
          ]}
          actions={canViewLoans ? [{ label: "View Loan", onPress: () => viewLoan(a.loanId) }] : undefined}
        />
      );
    },
  });
  // Ledger — same Date/Ref No/Particulars/Debit/Credit/Balance shape as the web Ledger tab; kept (30s) instead of dropped on every visit.
  const ledger = useLedgerList({ kind: "customer", ledgerRef: String(customerId), enabled: on("Ledger"), fresh: false });
  const ledgerView: TabView = { list: ledger.list, controls: ledger.controls, emptyText: ledger.emptyText, keyOf: ledger.keyOf, renderItem: ledger.renderItem };

  const view: TabView = { Loans: loans, Ornaments: ornaments, Payments: payments, "Bank Pledges": pledges, Auctions: auctions, Ledger: ledgerView }[tab];
  const ready = !view.list.isLoading;
  useEffect(() => {
    if (!ready || warm) return;
    const t = setTimeout(() => setWarm(true), 400);
    return () => clearTimeout(t);
  }, [ready, warm]);

  const header = (
    <FlatHeader
      back
      title={data?.name ?? "Customer"}
      subtitle={data ? [data.code, data.phone].filter(Boolean).join(" · ") : undefined}
    />
  );

  if (isLoading || !data) {
    return (
      <Screen header={header}>{isError ? <EmptyText>Could not load this customer.</EmptyText> : <Buffering block />}</Screen>
    );
  }

  const top = (
    <>
      <HeaderCard c={data} />
      {data.nomineeName || data.nomineeRelation || data.nomineePhone ? (
        <Card style={{ marginBottom: 14 }}>
          <SectionTitle flush>Nominee</SectionTitle>
          <DetailRow first k="Name" v={data.nomineeName || "—"} />
          <DetailRow k="Relation" v={data.nomineeRelation || "—"} />
          <DetailRow k="Mobile" v={data.nomineePhone || "—"} />
        </Card>
      ) : null}
      <Card style={{ marginBottom: 14 }}>
        <SectionTitle flush>Identity &amp; KYC documents</SectionTitle>
        {(
          [
            ["Photograph", data.photoUrl],
            ["Identity proof", data.identityProofUrl],
            ["Address proof", data.addressProofUrl],
            ["Additional document", data.kycDocumentUrl],
          ] as const
        ).map(([label, url], i) => (
          <DetailRow key={label} first={i === 0} k={label} v={url ? <BillLink path={url} title={label} icon /> : "—"} />
        ))}
      </Card>
      {totals.data ? (
        <Card style={{ marginBottom: 14 }}>
          <SectionTitle flush>Overall loan details</SectionTitle>
          <DetailRow first k="Total disbursed" v={inr(totals.data.totalDisbursed)} />
          <DetailRow k="Outstanding" v={inr(totals.data.totalOutstanding)} />
          <DetailRow k="Total paid" v={inr(totals.data.totalPaid)} />
          <DetailRow k="Active loans" v={String(totals.data.activeLoanCount)} />
          <DetailRow k="Closed loans" v={String(totals.data.closedLoanCount)} />
        </Card>
      ) : null}
      <PillTabs tabs={visibleTabs} value={tab} onChange={setTab} />
    </>
  );

  return (
    <Screen header={header} floating={<CustomerActions c={data} onEdit={() => setEditOpen(true)} onRequest={canUpdateLoan ? () => setRequestOpen(true) : undefined} />}>
      {/* One list for every tab: the header (identity card, KYC, totals, tab bar) never remounts; only the rows and filter swap. */}
      <ServerFlatList
        list={view.list}
        items={view.list.items}
        keyOf={view.keyOf}
        emptyText={view.emptyText}
        header={
          <>
            {top}
            {view.controls}
          </>
        }
        renderItem={view.renderItem}
      />

      <CustomerFormSheet visible={editOpen} onClose={() => setEditOpen(false)} customer={data} />
      <LoanRequestPicker customerId={customerId} visible={requestOpen} onClose={() => setRequestOpen(false)} />
    </Screen>
  );
}

const s = StyleSheet.create({
  hc: { marginVertical: 14, marginHorizontal: 18, backgroundColor: C.card, borderWidth: 1, borderColor: C.line, borderRadius: 18, overflow: "hidden" },
  hcCollapsed: { flexDirection: "row", alignItems: "center", gap: 12, padding: 16 },
  hcName: { fontWeight: "700", fontSize: 15 },
  hcSub: { fontSize: 12, color: C.muted, marginTop: 2 },
  hcExpand: { paddingHorizontal: 16, paddingBottom: 16, borderTopWidth: 1, borderTopColor: C.line, marginTop: 2 },
  inline: { flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap", justifyContent: "flex-end" },
  v: { fontSize: 12.5, fontWeight: "700", textAlign: "right" },
});
