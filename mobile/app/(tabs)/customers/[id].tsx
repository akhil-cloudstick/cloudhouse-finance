import React, { useState } from "react";
import { LayoutAnimation, Pressable, StyleSheet, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import {
  AccRow,
  Avatar,
  Buffering,
  C,
  Card,
  DateField,
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
  type AccDetail,
} from "../../../src/components/ui";
import { CustomerFormSheet } from "../../../src/components/staff/CustomerFormSheet";
import { useServerList, type ServerPage } from "../../../src/hooks/useServerList";
import { useRefetchOnFocus, useResetOnBlur } from "../../../src/hooks/useRefetchOnFocus";
import {
  getCustomer,
  getCustomerAadhaarFull,
  listCustomerAuctionHistoryPage,
  listCustomerBankPledgesPage,
  listCustomerOrnamentsPage,
  listCustomerPaymentsPage,
} from "../../../src/api/customers";
import { listLoansPage } from "../../../src/api/loans";
import { listCashMovementsByCustomer } from "../../../src/api/cash";
import { ApiError } from "../../../src/api/client";
import { dmy, inr } from "../../../src/lib/format";
import type { Customer } from "../../../src/types/customer";
import type { CustomerAuctionRow, CustomerBankPledgeRow, CustomerOrnamentRow, CustomerPaymentRow, Loan } from "../../../src/types/loan";
import type { CashMovement } from "../../../src/types/cash";

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

function StatusBadge({ status }: { status?: string }) {
  if (!status) return null;
  return <KycBadge verified={isVerified(status)} label={status} />;
}

/** .cust-header-card — collapsible identity card. */
function HeaderCard({ c, onEdit }: { c: Customer; onEdit: () => void }) {
  const [open, setOpen] = useState(true);
  const [aadhaarFull, setAadhaarFull] = useState<string | null>(null);
  const [revealing, setRevealing] = useState(false);
  const [revealError, setRevealError] = useState<string | null>(null);

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
                  <Pressable onPress={reveal} hitSlop={6} disabled={revealing} style={{ marginTop: 4 }}>
                    <Txt style={s.reveal}>{revealing ? "Loading…" : aadhaarFull ? "Hide" : "Show full"}</Txt>
                  </Pressable>
                  {revealError ? <Txt style={{ fontSize: 11, color: C.red, marginTop: 2 }}>{revealError}</Txt> : null}
                </View>
              ) : (
                "—"
              )
            }
          />
          <DetailRow k="KYC status" v={c.kycStatus ? <StatusBadge status={c.kycStatus} /> : "—"} />
          <PrimaryButton label="Edit Customer" onPress={onEdit} style={{ marginTop: 12 }} />
        </View>
      ) : null}
    </View>
  );
}

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
}: {
  queryKey: unknown[];
  fetchPage: (p: { q?: string; limit: number; offset: number }) => Promise<ServerPage<T>>;
  top: React.ReactElement;
  placeholder: string;
  emptyText: string;
  keyOf: (t: T) => string;
  renderItem: (t: T, i: number) => React.ReactElement;
}) {
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

/** Ledger tab — same Date/Ref No/Particulars/Debit/Credit/Balance shape as
 * the web CustomerDetail.tsx's Ledger tab, rendered with the same
 * AccGroup/AccRow accordion style as LoanLedger.tsx for visual consistency.
 * Only a Date filter (no search box — cash movements don't have a loan-
 * number-style free-text field to search). */
function LedgerTabList({ customerId, top }: { customerId: number; top: React.ReactElement }) {
  const [fromDate, setFromDate] = useState<string | undefined>();
  const [toDate, setToDate] = useState<string | undefined>();
  const list = useServerList<CashMovement>({
    key: ["customerLedger", customerId, fromDate, toDate],
    fetchPage: (p) =>
      listCashMovementsByCustomer(customerId, { limit: p.limit, offset: p.offset, fromDate, toDate }).then((r) => ({
        items: r.items,
        hasMore: p.offset + p.limit < r.total,
        total: r.total,
      })),
    fresh: true,
  });

  // Running balance accumulates oldest-first regardless of the list's own
  // newest-first display order — same convention as the web Ledger tab
  // (a debit, e.g. a loan disbursement, increases the balance; a credit,
  // e.g. a payment received, reduces it).
  const chronological = [...(list.items ?? [])].reverse();
  let running = 0;
  const balanceById = new Map<number, number>();
  for (const m of chronological) {
    running += m.type === "out" ? m.amount : -m.amount;
    balanceById.set(m.id, running);
  }

  return (
    <ServerFlatList
      list={list}
      items={list.items}
      keyOf={(m) => String(m.id)}
      emptyText="No ledger entries yet."
      header={
        <>
          {top}
          <View style={{ flexDirection: "row", gap: 10, paddingHorizontal: 18, paddingTop: 12 }}>
            <View style={{ flex: 1 }}>
              <DateField label="From" value={fromDate} onChange={setFromDate} max={toDate} clearable />
            </View>
            <View style={{ flex: 1 }}>
              <DateField label="To" value={toDate} onChange={setToDate} min={fromDate} clearable />
            </View>
          </View>
        </>
      }
      renderItem={(m, i) => {
        const isDebit = m.type === "out";
        const details: AccDetail[] = [
          { k: "Date", v: dmy(m.occurredOn) },
          { k: "Ref No", v: m.transactionGroupId ?? String(m.id) },
          { k: "Particulars", v: m.purpose || m.source || "—" },
          { k: "Debit", v: isDebit ? inr(m.amount) : "—", color: isDebit ? C.red : C.muted },
          { k: "Credit", v: isDebit ? "—" : inr(m.amount), color: isDebit ? C.muted : C.green },
          { k: "Balance", v: inr(balanceById.get(m.id) ?? 0), color: C.brandDeep },
        ];
        return (
          <AccRow
            defaultOpen={i === 0}
            id={dmy(m.occurredOn)}
            name={m.purpose || m.source || "—"}
            sub={m.transactionGroupId ?? String(m.id)}
            amount={isDebit ? `−${inr(m.amount)}` : `+${inr(m.amount)}`}
            amountColor={isDebit ? C.red : C.green}
            status={isDebit ? "Debit" : "Credit"}
            statusTone={isDebit ? "overdue" : "active"}
            details={details}
          />
        );
      }}
    />
  );
}

export default function CustomerDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const customerId = Number(id);
  const [tab, setTab] = useState<Tab>("Loans");
  const [editOpen, setEditOpen] = useState(false);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["customer", id],
    queryFn: () => getCustomer(customerId),
    enabled: !!id,
  });
  useRefetchOnFocus(refetch);
  useResetOnBlur(() => setEditOpen(false));

  const viewLoan = (loanId: number) => openPage(`/loans/${loanId}`);

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
      <HeaderCard c={data} onEdit={() => setEditOpen(true)} />
      {data.nomineeName || data.nomineeRelation || data.nomineePhone ? (
        <Card style={{ marginBottom: 14 }}>
          <SectionTitle flush>Nominee</SectionTitle>
          <DetailRow first k="Name" v={data.nomineeName || "—"} />
          <DetailRow k="Relation" v={data.nomineeRelation || "—"} />
          <DetailRow k="Mobile" v={data.nomineePhone || "—"} />
        </Card>
      ) : null}
      <PillTabs tabs={TABS} value={tab} onChange={setTab} />
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
              actions={[{ label: "View Loan", primary: true, onPress: () => viewLoan(l.id) }]}
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
              actions={[{ label: "View Loan", onPress: () => viewLoan(o.loanId) }]}
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
              actions={[{ label: "View Loan", onPress: () => viewLoan(p.loanId) }]}
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
              actions={[{ label: "View Loan", onPress: () => viewLoan(b.loanId) }]}
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
                actions={[{ label: "View Loan", onPress: () => viewLoan(a.loanId) }]}
              />
            );
          }}
        />
      )}

      <CustomerFormSheet visible={editOpen} onClose={() => setEditOpen(false)} customer={data} />
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
