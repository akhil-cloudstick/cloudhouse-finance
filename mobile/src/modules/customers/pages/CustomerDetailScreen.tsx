import React, { useState } from "react";
import { LayoutAnimation, Pressable, StyleSheet, View } from "react-native";
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
  KycBadge,
  PIcon,
  PillTabs,
  PrimaryButton,
  Screen,
  SearchInput,
  SectionTitle,
  ServerFlatList,
  Txt,
  openPage,
  useShell,
  toast,
} from "@/common/components/ui";
import { CustomerFormSheet } from "@/modules/customers/components/CustomerFormSheet";
import { useServerList, type ServerPage } from "@/common/hooks/use-server-list";
import { useRefetchOnFocus, useResetOnBlur } from "@/common/hooks/use-refetch-on-focus";
import {
  getCustomer,
  getCustomerAadhaarFull,
  getCustomerLoanTotals,
  hardDeleteCustomer,
  verifyCustomerPan,
  listCustomerAuctionHistoryPage,
  listCustomerBankPledgesPage,
  listCustomerOrnamentsPage,
  listCustomerPaymentsPage,
} from "@/modules/customers/services/customerService";
import { listLoansPage } from "@/modules/loans/services/loanService";
import { BillLink, LedgerList } from "@/common/components/LedgerList";
import { ApiError } from "@/common/services/httpClient";
import { useAuth } from "@/common/providers/AuthProvider";
import { useCanOpen } from "@/common/config/routePermissions";
import { dmy, inr } from "@/common/utils/format";
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
const fmtAadhaar = (a: string) => a.replace(/\D/g, "").replace(/(\d{4})(?=\d)/g, "$1 ");
const isVerified = (s?: string) => (s ?? "").toLowerCase() === "verified";

type StatusBadgeProps = { status?: string };

function StatusBadge({ status }: StatusBadgeProps) {
  if (!status) return null;
  return <KycBadge verified={isVerified(status)} label={status} />;
}

type HeaderCardProps = { c: Customer; onEdit: () => void; onRequest?: () => void };

/** .cust-header-card — collapsible identity card. */
function HeaderCard({ c, onEdit, onRequest }: HeaderCardProps) {
  const [open, setOpen] = useState(true);
  const [aadhaarFull, setAadhaarFull] = useState<string | null>(null);
  const [revealing, setRevealing] = useState(false);
  const [revealError, setRevealError] = useState<string | null>(null);
  const canUpdate = useAuth().can("Customer_Management", "can_update_customer");
  const canHardDelete = useAuth().can("Customer_Management", "can_hard_delete_customer");
  const canCreateLoan = useAuth().can("Loan_Management", "can_create_loan");
  const shell = useShell();
  const qc = useQueryClient();
  const router = useRouter();
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

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

  async function reveal() {
    if (aadhaarFull) return setAadhaarFull(null);
    setRevealing(true);
    setRevealError(null);
    try {
      const r = await getCustomerAadhaarFull(c.id);
      setAadhaarFull(r.aadhaar);
    } catch (e) {
      setRevealError(e instanceof ApiError ? e.message : "Couldn't load Aadhaar.");
    } finally {
      setRevealing(false);
    }
  }

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
                    <Txt style={s.v}>{aadhaarFull ? fmtAadhaar(aadhaarFull) : `×××× ×××× ${c.aadhaarLast4}`}</Txt>
                    <StatusBadge status={c.aadhaarStatus} />
                  </View>
                  {canUpdate ? (
                    <Pressable onPress={reveal} hitSlop={6} disabled={revealing} style={{ marginTop: 4 }}>
                      <Txt style={s.reveal}>{revealing ? "Loading…" : aadhaarFull ? "Hide" : "Show full"}</Txt>
                    </Pressable>
                  ) : null}
                  {revealError ? <Txt style={{ fontSize: 11, color: C.red, marginTop: 2 }}>{revealError}</Txt> : null}
                </View>
              ) : (
                "—"
              )
            }
          />
          <DetailRow k="KYC status" v={c.kycStatus ? <StatusBadge status={c.kycStatus} /> : "—"} />
          {canUpdate ? <PrimaryButton label="Edit Customer" onPress={onEdit} style={{ marginTop: 12 }} /> : null}
          {onRequest ? <PrimaryButton label="Extension / Release" variant="outline" onPress={onRequest} style={{ marginTop: 10 }} /> : null}
          {canCreateLoan ? <PrimaryButton label="New Loan" variant="outline" onPress={() => shell.openNewLoanFor(c)} style={{ marginTop: 10 }} /> : null}
          {canUpdate && c.pan && c.panStatus !== "Verified" ? (
            <PrimaryButton label={verifyPan.isPending ? "Verifying…" : "Verify PAN"} variant="outline" onPress={() => verifyPan.mutate()} loading={verifyPan.isPending} style={{ marginTop: 10 }} />
          ) : null}
          {canHardDelete ? (
            <PrimaryButton label="Delete Customer Permanently" variant="danger" onPress={() => { setDeleteError(null); setDeleteOpen(true); }} style={{ marginTop: 10 }} />
          ) : null}
        </View>
      ) : null}
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
    </View>
  );
}

type TabListProps<T> = {
  queryKey: unknown[];
  fetchPage: (p: { q?: string; limit: number; offset: number }) => Promise<ServerPage<T>>;
  top: React.ReactElement;
  placeholder: string;
  emptyText: string;
  keyOf: (t: T) => string;
  renderItem: (t: T, i: number) => React.ReactElement;
};

/** One tab's server-paged list with its own search. Mounted only while its
 * tab is active, so inactive tabs never fetch. */
function TabList<T>({
  queryKey,
  fetchPage,
  top,
  placeholder,
  emptyText,
  keyOf,
  renderItem,
}: TabListProps<T>) {
  // Cached rows show straight away; the mount refetch updates them quietly.
  const list = useServerList<T>({ key: queryKey, fetchPage });
  return (
    <ServerFlatList
      list={list}
      items={list.items}
      keyOf={keyOf}
      emptyText={list.search ? "Nothing matches your search." : emptyText}
      header={
        <>
          {top}
          <SearchInput value={list.search} onChangeText={list.setSearch} placeholder={placeholder} style={{ paddingTop: 12 }} />
        </>
      }
      renderItem={renderItem}
    />
  );
}

type LedgerTabListProps = { customerId: number; top: React.ReactElement };

/** Ledger tab — same Date/Ref No/Particulars/Debit/Credit/Balance shape as
 * the web CustomerDetail.tsx's Ledger tab, rendered with the same
 * AccGroup/AccRow accordion style as LoanLedger.tsx for visual consistency.
 * Only a Date filter (no search box — cash movements don't have a loan-
 * number-style free-text field to search). */
function LedgerTabList({ customerId, top }: LedgerTabListProps) {
  return <LedgerList kind="customer" ledgerRef={String(customerId)} top={top} />;
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
  const [tab, setTab] = useState<Tab>("Loans");
  const [editOpen, setEditOpen] = useState(false);
  const [requestOpen, setRequestOpen] = useState(false);
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
  const visibleTabs = canOpen("/auctions") ? TABS : TABS.filter((t) => t !== "Auctions");

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
      <HeaderCard c={data} onEdit={() => setEditOpen(true)} onRequest={canUpdateLoan ? () => setRequestOpen(true) : undefined} />
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
          <DetailRow key={label} first={i === 0} k={label} v={url ? <BillLink path={url} label="View" /> : "—"} />
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
    <Screen header={header}>
      {tab === "Loans" ? (
        <TabList<Loan>
          key="loans"
          queryKey={["loans", "customer", customerId]}
          fetchPage={(p) => listLoansPage({ ...p, customerId })}
          top={top}
          placeholder="Search by loan ID or scheme"
          emptyText="No loans for this customer."
          keyOf={(l) => String(l.id)}
          renderItem={(l, i) => (
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
          )}
        />
      ) : tab === "Ornaments" ? (
        <TabList<CustomerOrnamentRow>
          key="ornaments"
          queryKey={["customerOrnaments", customerId]}
          fetchPage={(p) => listCustomerOrnamentsPage(customerId, p.limit, p.offset, p.q)}
          top={top}
          placeholder="Search by ornament or loan ID"
          emptyText="No ornaments for this customer."
          keyOf={(o) => String(o.id)}
          renderItem={(o) => (
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
          )}
        />
      ) : tab === "Payments" ? (
        <TabList<CustomerPaymentRow>
          key="payments"
          queryKey={["customerPayments", customerId]}
          fetchPage={(p) => listCustomerPaymentsPage(customerId, p.limit, p.offset, p.q)}
          top={top}
          placeholder="Search by loan ID or payment type"
          emptyText="No payments for this customer."
          keyOf={(p) => String(p.id)}
          renderItem={(p) => (
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
          )}
        />
      ) : tab === "Bank Pledges" ? (
        <TabList<CustomerBankPledgeRow>
          key="pledges"
          queryKey={["customerBankPledges", customerId]}
          fetchPage={(p) => listCustomerBankPledgesPage(customerId, p.limit, p.offset, p.q)}
          top={top}
          placeholder="Search by loan ID or bank"
          emptyText="No bank pledges for this customer."
          keyOf={(b) => String(b.id)}
          renderItem={(b) => (
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
          )}
        />
      ) : tab === "Ledger" ? (
        <LedgerTabList key="ledger" customerId={customerId} top={top} />
      ) : (
        <TabList<CustomerAuctionRow>
          key="auctions"
          queryKey={["customerAuctions", customerId]}
          fetchPage={(p) => listCustomerAuctionHistoryPage(customerId, p.limit, p.offset, p.q)}
          top={top}
          placeholder="Search by loan ID or stage"
          emptyText="No auction cases for this customer."
          keyOf={(a) => String(a.id)}
          renderItem={(a) => {
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
          }}
        />
      )}

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
  reveal: { fontSize: 11, fontWeight: "700", color: C.brandDeep },
});
