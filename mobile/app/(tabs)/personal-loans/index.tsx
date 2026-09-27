import React, { useEffect, useState } from "react";
import { Pressable, View } from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import {
  AccRow,
  AsyncSelect,
  Buffering,
  BtnRow2,
  C,
  Card,
  ChipToggle,
  EmptyText,
  FabCorner,
  Field,
  FieldGrid,
  FilterChipRow,
  FiltersBar,
  FlatHeader,
  Input,
  PillTabs,
  PIcon,
  PrimaryButton,
  RepayItem,
  Screen,
  SearchInput,
  ServerFlatList,
  Sheet,
  StatusChip,
  Txt,
  WarningBanner,
} from "../../../src/components/ui";
import { SheetScrollView } from "../../../src/components/BottomSheetModal";
import { useServerList } from "../../../src/hooks/useServerList";
import { useAuth } from "../../../src/auth/AuthContext";
import { listCustomers } from "../../../src/api/customers";
import { ApiError } from "../../../src/api/client";
import { API_BASE_URL } from "../../../src/api/config";
import { getToken } from "../../../src/auth/tokenStorage";
import {
  createPersonalLoan,
  getPersonalLoan,
  getPersonalLoanSchedulePage,
  listPersonalLoanPaymentsPage,
  listPersonalLoansPage,
  previewRenewal,
  recordPersonalLoanPayment,
  renewPersonalLoan,
  type Frequency,
  type InterestType,
  type PersonalLoan,
  type PersonalLoanInstallment,
  type PersonalLoanPayment,
} from "../../../src/api/personalLoans";
import { dmy, inr, todayISO } from "../../../src/lib/format";
import type { Customer } from "../../../src/types/customer";
import { userMessage } from "../../../src/api/errors";

// Personal Loans — prototype #header-personalloans + #page-personalloans and
// the pl-filter / pl-create / pl-collect / pl-detail / pl-renew sheets.
// Search (PL no., customer name/code) and the frequency filter are backend
// params on GET /personal-loans; rows page in 10 at a time.

const FREQ_FILTERS = ["All", "Daily", "Weekly", "Monthly"] as const;
type FreqFilter = (typeof FREQ_FILTERS)[number];
const FREQS = ["Daily", "Weekly", "Monthly"] as const;
const PAYMENT_METHODS = ["Cash", "UPI", "Bank Transfer"] as const;
const PER: Record<Frequency, string> = { Daily: "day", Weekly: "wk", Monthly: "mo" };

type Filters = { frequency?: Frequency };

const errMsg = (err: unknown, fallback: string) => userMessage(err, fallback);

// Mirrors the web NewPersonalLoanModal's client-side preview of the
// backend's computeInterest — the backend recomputes and is the source of truth.
function computeInterest(principal: number, interestType: InterestType, value: number): number {
  const raw = interestType === "Percentage" ? (principal * value) / 100 : value;
  return Math.round(raw * 100) / 100;
}

export default function PersonalLoansScreen() {
  const { can } = useAuth();
  const canCreate = can("Personal_Loan_Management", "can_create_personal_loan");
  const canUpdate = can("Personal_Loan_Management", "can_update_personal_loan");

  const [freq, setFreq] = useState<FreqFilter>("All");
  const [filterOpen, setFilterOpen] = useState(false);
  const [draftFreq, setDraftFreq] = useState<FreqFilter>("All");

  const [createOpen, setCreateOpen] = useState(false);
  const [detailId, setDetailId] = useState<number | null>(null);
  const [collectLoan, setCollectLoan] = useState<PersonalLoan | null>(null);
  const [renewLoan, setRenewLoan] = useState<PersonalLoan | null>(null);

  const filters: Filters = { frequency: freq === "All" ? undefined : freq };
  const list = useServerList<PersonalLoan, Filters>({ key: ["personalLoans", "list"], filters, fetchPage: (p) => listPersonalLoansPage(p) });

  return (
    <Screen
      header={<FlatHeader title="Personal Loans" subtitle="Non-gold loans & collections" />}
      floating={canCreate ? <FabCorner onPress={() => setCreateOpen(true)} label="Create personal loan" /> : null}
    >
      <ServerFlatList
        list={list}
        items={list.items}
        keyOf={(l) => String(l.id)}
        emptyText="No personal loans match your search."
        header={
          <View style={{ paddingTop: 12 }}>
            <SearchInput value={list.search} onChangeText={list.setSearch} placeholder="Search by loan ID or customer name" style={{ paddingBottom: 8 }} />
            <FiltersBar
              count={freq !== "All" ? 1 : 0}
              summary={freq === "All" ? "All frequencies" : `${freq} collection`}
              onPress={() => {
                setDraftFreq(freq);
                setFilterOpen(true);
              }}
              style={{ marginTop: 0, marginBottom: 10 }}
            />
          </View>
        }
        renderItem={(l, i) => (
          <AccRow
            defaultOpen={i === 0}
            id={l.loanNumber}
            name={l.customer?.name ?? `Customer #${l.customerId}`}
            sub={`${l.frequency} collection`}
            amount={inr(l.outstandingAmount)}
            status={l.status}
            details={[
              { k: "Principal", v: inr(l.principalAmount) },
              { k: "Frequency", v: `${l.frequency} · ${inr(l.installmentAmount)}/${PER[l.frequency] ?? l.frequency}` },
            ]}
            actions={[
              { label: "Collect Payment", disabled: !canUpdate || l.status !== "Active", onPress: () => setCollectLoan(l) },
              { label: "View", primary: true, onPress: () => setDetailId(l.id) },
            ]}
          />
        )}
      />

      <Sheet visible={filterOpen} onClose={() => setFilterOpen(false)} title="Filter Personal Loans" maxHeightPct={55}>
        <Field label="Collection frequency">
          <FilterChipRow options={FREQ_FILTERS} value={draftFreq} onChange={setDraftFreq} />
        </Field>
        <PrimaryButton
          label="Apply Filters"
          onPress={() => {
            setFreq(draftFreq);
            setFilterOpen(false);
          }}
        />
      </Sheet>

      <CreatePersonalLoanSheet
        visible={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={(loan) => {
          setCreateOpen(false);
          setDetailId(loan.id);
        }}
      />
      <PersonalLoanDetailSheet
        loanId={detailId}
        onClose={() => setDetailId(null)}
        onOpenLoan={setDetailId}
        canUpdate={canUpdate}
        onCollect={setCollectLoan}
        onRenew={setRenewLoan}
      />
      <CollectSheet loan={collectLoan} onClose={() => setCollectLoan(null)} />
      <RenewSheet
        loan={renewLoan}
        onClose={() => setRenewLoan(null)}
        onRenewed={(newId) => {
          setRenewLoan(null);
          setDetailId(newId);
        }}
      />
    </Screen>
  );
}

// ---------------------------------------------------------------------------
// Create Personal Loan (prototype #pl-create-modal)
// ---------------------------------------------------------------------------
function CreatePersonalLoanSheet({ visible, onClose, onCreated }: { visible: boolean; onClose: () => void; onCreated: (l: PersonalLoan) => void }) {
  const qc = useQueryClient();
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [principal, setPrincipal] = useState("");
  const [interestType, setInterestType] = useState<InterestType>("Flat");
  const [interestValue, setInterestValue] = useState("");
  const [frequency, setFrequency] = useState<Frequency>("Daily");
  const [tenureCount, setTenureCount] = useState("");
  // Same as the web's "Full Amount" checkbox: withhold the interest upfront
  // (default) or disburse the full principal now.
  const [disburse, setDisburse] = useState<"Withhold interest" | "Full amount">("Withhold interest");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (visible) {
      setCustomer(null);
      setPrincipal("");
      setInterestType("Flat");
      setInterestValue("");
      setFrequency("Daily");
      setTenureCount("");
      setDisburse("Withhold interest");
      setError(null);
    }
  }, [visible]);

  const principalNum = +principal || 0;
  const interestValueNum = +interestValue || 0;
  const tenureNum = +tenureCount || 0;
  const interestAmount = principalNum > 0 ? computeInterest(principalNum, interestType, interestValueNum) : 0;
  // Mirrors backend personalloan CreateLoan: withheld → disburse
  // Principal-Interest, owe Principal; full → disburse Principal, owe
  // Principal+Interest.
  const fullDisbursement = disburse === "Full amount";
  const disbursedAmount = fullDisbursement ? principalNum : Math.round((principalNum - interestAmount) * 100) / 100;
  const obligation = fullDisbursement ? Math.round((principalNum + interestAmount) * 100) / 100 : principalNum;
  const installmentAmount = tenureNum > 0 ? Math.round((obligation / tenureNum) * 100) / 100 : 0;

  const submit = useMutation({
    mutationFn: () =>
      createPersonalLoan({
        branchId: customer!.branchId,
        customerId: customer!.id,
        principalAmount: principalNum,
        interestType,
        interestValue: interestValueNum,
        frequency,
        tenureCount: tenureNum,
        fullDisbursement,
      }),
    onSuccess: (loan) => {
      qc.invalidateQueries({ queryKey: ["personalLoans"] });
      onCreated(loan);
    },
    onError: (err) => setError(errMsg(err, "Could not create the loan — try again.")),
  });

  function validate(): string | null {
    if (!customer) return "Please select a customer.";
    if (!principalNum || principalNum <= 0) return "Please enter the principal amount.";
    if (!tenureNum || tenureNum <= 0) return "Please enter the number of installments.";
    if (interestValueNum < 0) return "Interest value must not be negative.";
    if (interestAmount >= principalNum) return "Interest amount must be less than the principal amount.";
    return null;
  }

  return (
    <Sheet visible={visible} onClose={onClose} title="Create Personal Loan" maxHeightPct={92}>
      <AsyncSelect<Customer>
        label="Customer"
        placeholder="Search existing customer by name, ID or phone"
        queryKey={["customers", "picker"]}
        fetcher={(q) => listCustomers(q || undefined)}
        selectedLabel={customer ? `${customer.name} · ${customer.code ?? ""}` : undefined}
        onClear={() => setCustomer(null)}
        onSelect={setCustomer}
        keyOf={(c) => c.id}
        renderItem={(c) => ({ title: c.name, sub: [c.code, c.phone].filter(Boolean).join(" · ") })}
      />
      <Field label="Principal amount">
        <Input keyboardType="decimal-pad" placeholder="e.g. 15000" value={principal} onChangeText={setPrincipal} />
      </Field>
      <Field label="Number of installments">
        <Input keyboardType="number-pad" placeholder="e.g. 100" value={tenureCount} onChangeText={setTenureCount} />
      </Field>
      <Field label="Interest type">
        <ChipToggle options={["Flat", "Percentage"] as const} value={interestType} onChange={setInterestType} />
      </Field>
      <Field label={interestType === "Flat" ? "Interest value (₹)" : "Interest value (%)"}>
        <Input keyboardType="decimal-pad" placeholder={interestType === "Flat" ? "e.g. 1500" : "e.g. 2"} value={interestValue} onChangeText={setInterestValue} />
      </Field>
      <Field label="Collection frequency">
        <ChipToggle options={FREQS} value={frequency} onChange={setFrequency} />
      </Field>
      <Field label="Disbursement">
        <ChipToggle options={["Withhold interest", "Full amount"] as const} value={disburse} onChange={setDisburse} />
      </Field>
      <Card style={{ marginHorizontal: 0, marginBottom: 14 }}>
        <FieldGrid
          items={[
            { k: "Interest amount", v: inr(interestAmount) },
            { k: "Disbursed to customer", v: inr(Math.max(0, disbursedAmount)) },
            { k: "Installment amount", v: `${inr(installmentAmount)} / ${PER[frequency]}` },
            { k: "Repayment obligation", v: inr(obligation) },
          ]}
        />
      </Card>
      {error ? <Txt style={{ fontSize: 12, color: C.red, marginBottom: 10 }}>{error}</Txt> : null}
      <PrimaryButton
        label="Create & Disburse"
        loading={submit.isPending}
        onPress={() => {
          const v = validate();
          if (v) return setError(v);
          setError(null);
          submit.mutate();
        }}
      />
    </Sheet>
  );
}

// ---------------------------------------------------------------------------
// Detail (prototype #pl-detail-modal): Schedule / Payment History /
// Schedule History, each paged from the server inside the sheet.
// ---------------------------------------------------------------------------
const DETAIL_TABS = ["schedule", "payments", "history"] as const;
type DetailTab = (typeof DETAIL_TABS)[number];

function PersonalLoanDetailSheet({
  loanId,
  onClose,
  onOpenLoan,
  canUpdate,
  onCollect,
  onRenew,
}: {
  loanId: number | null;
  onClose: () => void;
  onOpenLoan: (id: number) => void;
  canUpdate: boolean;
  onCollect: (l: PersonalLoan) => void;
  onRenew: (l: PersonalLoan) => void;
}) {
  const visible = loanId != null;
  const id = loanId ?? 0;
  const [tab, setTab] = useState<DetailTab>("schedule");
  const [bondBusy, setBondBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setTab("schedule");
    setError(null);
  }, [loanId]);

  const loan = useQuery({ queryKey: ["personalLoan", String(id)], queryFn: () => getPersonalLoan(id), enabled: visible });
  const schedule = useServerList<PersonalLoanInstallment>({
    key: ["personalLoanSchedule", id],
    fetchPage: (p) => getPersonalLoanSchedulePage(id, p.limit, p.offset),
    enabled: visible && tab === "schedule",
  });
  const payments = useServerList<PersonalLoanPayment>({
    key: ["personalLoanPayments", id],
    fetchPage: (p) => listPersonalLoanPaymentsPage(id, p.limit, p.offset),
    enabled: visible && tab === "payments",
  });

  // Renewal chain: one hop each way (renewedFromLoanId / renewedToLoanId).
  const olderId = loan.data?.renewedFromLoanId ?? null;
  const newerId = loan.data?.renewedToLoanId ?? null;
  const older = useQuery({ queryKey: ["personalLoan", String(olderId)], queryFn: () => getPersonalLoan(olderId!), enabled: visible && tab === "history" && !!olderId });
  const newer = useQuery({ queryKey: ["personalLoan", String(newerId)], queryFn: () => getPersonalLoan(newerId!), enabled: visible && tab === "history" && !!newerId });

  async function downloadBond() {
    const l = loan.data;
    if (!l || bondBusy) return;
    setBondBusy(true);
    setError(null);
    try {
      const token = await getToken();
      const targetUri = `${FileSystem.cacheDirectory}bond-${l.loanNumber}.pdf`;
      const result = await FileSystem.downloadAsync(`${API_BASE_URL}/personal-loans/${l.id}/bond`, targetUri, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (result.status < 200 || result.status >= 300) throw new ApiError(result.status, "", undefined);
      if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(result.uri, { mimeType: "application/pdf" });
    } catch (e) {
      setError(errMsg(e, "Could not download the bond."));
    } finally {
      setBondBusy(false);
    }
  }

  const l = loan.data;
  const title = l ? `${l.loanNumber} — ${l.customer?.name ?? `Customer #${l.customerId}`}` : "Personal Loan";

  const header = l ? (
    <View style={{ paddingHorizontal: 16, paddingTop: 12 }}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
        <Txt style={{ fontSize: 11.5, color: C.muted, fontWeight: "600" }}>
          Opened {dmy(l.openedDate)} · {l.tenureCount} installments
        </Txt>
        <StatusChip label={l.status} />
      </View>
      <FieldGrid
        style={{ marginBottom: 14 }}
        items={[
          { k: "Principal", v: inr(l.principalAmount) },
          { k: "Interest", v: `${inr(l.interestAmount)} (${l.interestType === "Flat" ? "Flat" : `${l.interestValue}%`})` },
          { k: "Disbursed", v: inr(l.disbursedAmount) },
          { k: "Outstanding", v: inr(l.outstandingAmount), color: C.brandDeep },
          { k: "Frequency", v: `${l.frequency} · ${inr(l.installmentAmount)}/${PER[l.frequency] ?? l.frequency}` },
          { k: "Total paid", v: inr(l.totalPaid), color: C.green },
        ]}
      />
      {l.penalCycleCount > 0 ? (
        <WarningBanner>
          Penal interest applied {l.penalCycleCount} time(s) — {inr(l.totalPenalInterestCharged)} added at {l.penalInterestRate}% p.a.
        </WarningBanner>
      ) : null}
      <PrimaryButton label={bondBusy ? "Downloading…" : "Download Bond"} variant="outline" loading={bondBusy} onPress={downloadBond} style={{ marginBottom: 12 }} />
      {error ? <Txt style={{ fontSize: 12, color: C.red, marginBottom: 10 }}>{error}</Txt> : null}
      <PillTabs
        inSheet
        tabs={DETAIL_TABS}
        value={tab}
        onChange={setTab}
        labels={{ schedule: "Schedule", payments: "Payment History", history: "Schedule History" }}
      />
    </View>
  ) : null;

  const chainRow = (x: PersonalLoan, label: string, first: boolean) => (
    <Pressable
      key={x.id}
      onPress={() => onOpenLoan(x.id)}
      style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 11, borderTopWidth: first ? 0 : 1, borderTopColor: C.line }}
    >
      <View style={{ flex: 1, minWidth: 0 }}>
        <Txt style={{ fontWeight: "700", fontSize: 12.5 }}>{x.loanNumber}</Txt>
        <Txt style={{ fontSize: 11, color: C.muted, marginTop: 1 }}>
          {label} · Opened {dmy(x.openedDate)}
        </Txt>
      </View>
      <PIcon name="chevright" color={C.muted} />
    </Pressable>
  );

  let body: React.ReactNode;
  if (!visible) body = null;
  else if (loan.isLoading) body = <Buffering block />;
  else if (loan.isError || !l) body = <EmptyText>Could not load this loan.</EmptyText>;
  else if (tab === "schedule")
    body = (
      <ServerFlatList
        list={schedule}
        items={schedule.items}
        inSheet
        gutter={16}
        header={header}
        emptyText="No installments."
        keyOf={(s) => String(s.id)}
        renderItem={(s, i) => {
          const missed = s.status !== "Paid" && s.dueDate.slice(0, 10) < todayISO();
          const value = s.status === "Paid" ? `Paid ${inr(s.paidAmount || s.amount)}` : s.status === "PartiallyPaid" ? `Part ${inr(s.paidAmount)} / ${inr(s.amount)}` : missed ? "Missed" : `Due ${inr(s.amount)}`;
          return (
            <RepayItem
              first={i === 0}
              label={`#${s.sequenceNo} · ${dmy(s.dueDate)}`}
              value={value}
              labelColor={missed ? C.red : undefined}
              valueColor={s.status === "Paid" ? C.green : missed ? C.red : s.status === "PartiallyPaid" ? C.amber : C.ink}
            />
          );
        }}
      />
    );
  else if (tab === "payments")
    body = (
      <ServerFlatList
        list={payments}
        items={payments.items}
        inSheet
        gutter={16}
        header={header}
        emptyText="No payments yet."
        keyOf={(p) => String(p.id)}
        renderItem={(p, i) => <RepayItem first={i === 0} label={`${dmy(p.paidOn)} · ${p.method}${p.reference ? ` · ${p.reference}` : ""}`} value={`+${inr(p.amount)}`} />}
      />
    );
  else
    body = (
      <SheetScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 24 }}>
        {header}
        <View style={{ paddingHorizontal: 16 }}>
          {(olderId && older.isLoading) || (newerId && newer.isLoading) ? (
            <Buffering block />
          ) : (
            <>
              {older.data && olderId ? chainRow(older.data, "Renewed into this loan", true) : null}
              <View style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 11, borderTopWidth: older.data && olderId ? 1 : 0, borderTopColor: C.line }}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Txt style={{ fontWeight: "700", fontSize: 12.5 }}>{l.loanNumber} (this loan)</Txt>
                  <Txt style={{ fontSize: 11, color: C.muted, marginTop: 1 }}>Opened {dmy(l.openedDate)}</Txt>
                </View>
                <StatusChip label={l.status} />
              </View>
              {newer.data && newerId ? chainRow(newer.data, "Renewed from this loan", false) : null}
              {!olderId && !newerId ? <Txt style={{ paddingVertical: 12, paddingHorizontal: 2, color: C.muted, fontSize: 12.5 }}>No prior renewals for this loan.</Txt> : null}
            </>
          )}
        </View>
      </SheetScrollView>
    );

  const active = l?.status === "Active";
  return (
    <Sheet visible={visible} onClose={onClose} title={title} maxHeightPct={90} scroll={false}>
      <View style={{ flexShrink: 1 }}>{body}</View>
      {l && canUpdate && active ? (
        <BtnRow2 style={{ paddingHorizontal: 16, paddingTop: 10, paddingBottom: 16 }}>
          <PrimaryButton label="Collect Payment" variant="outline" onPress={() => onCollect(l)} />
          <PrimaryButton label="Renew Loan" onPress={() => onRenew(l)} />
        </BtnRow2>
      ) : null}
    </Sheet>
  );
}

// ---------------------------------------------------------------------------
// Collect Payment (prototype #pl-collect-modal)
// ---------------------------------------------------------------------------
function CollectSheet({ loan, onClose }: { loan: PersonalLoan | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<(typeof PAYMENT_METHODS)[number]>("Cash");
  const [reference, setReference] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (loan) {
      setAmount(String(Math.min(loan.installmentAmount, loan.outstandingAmount) || ""));
      setMethod("Cash");
      setReference("");
      setDescription("");
      setError(null);
    }
  }, [loan]);

  const collect = useMutation({
    mutationFn: () => {
      const amt = Number(amount);
      return recordPersonalLoanPayment(loan!.id, {
        amount: amt,
        cashAmount: method === "Cash" ? amt : 0,
        upiAmount: method === "UPI" ? amt : 0,
        bankTransferAmount: method === "Bank Transfer" ? amt : 0,
        chequeAmount: 0,
        reference: reference || undefined,
        description: description || undefined,
      });
    },
    onSuccess: () => {
      const id = loan!.id;
      qc.invalidateQueries({ queryKey: ["personalLoan", String(id)] });
      qc.invalidateQueries({ queryKey: ["personalLoanSchedule", id] });
      qc.invalidateQueries({ queryKey: ["personalLoanPayments", id] });
      qc.invalidateQueries({ queryKey: ["personalLoans"] });
      onClose();
    },
    onError: (err) => setError(errMsg(err, "Could not record the payment — try again.")),
  });

  return (
    <Sheet visible={!!loan} onClose={onClose} title={`Collect Payment — ${loan?.loanNumber ?? ""}`} maxHeightPct={70}>
      {loan ? <Txt style={{ fontSize: 12, color: C.muted, marginTop: 6, marginBottom: 10 }}>Outstanding balance: {inr(loan.outstandingAmount)}</Txt> : null}
      <Field label="Amount">
        <Input keyboardType="decimal-pad" value={amount} onChangeText={setAmount} placeholder="₹" />
      </Field>
      <Field label="Method">
        <ChipToggle options={PAYMENT_METHODS} value={method} onChange={setMethod} />
      </Field>
      <Field label="Reference">
        <Input placeholder="Optional" value={reference} onChangeText={setReference} />
      </Field>
      <Field label="Description">
        <Input placeholder="Optional" value={description} onChangeText={setDescription} />
      </Field>
      {error ? <Txt style={{ fontSize: 12, color: C.red, marginBottom: 10 }}>{error}</Txt> : null}
      <PrimaryButton label="Confirm Payment" onPress={() => collect.mutate()} loading={collect.isPending} disabled={!amount || Number(amount) <= 0} />
    </Sheet>
  );
}

// ---------------------------------------------------------------------------
// Renew Loan (prototype #pl-renew-modal) with the server renewal preview.
// ---------------------------------------------------------------------------
function RenewSheet({ loan, onClose, onRenewed }: { loan: PersonalLoan | null; onClose: () => void; onRenewed: (newId: number) => void }) {
  const qc = useQueryClient();
  const [principal, setPrincipal] = useState("");
  const [interestType, setInterestType] = useState<InterestType>("Flat");
  const [interestValue, setInterestValue] = useState("");
  const [frequency, setFrequency] = useState<Frequency>("Daily");
  const [tenure, setTenure] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (loan) {
      setPrincipal(String(loan.principalAmount));
      setInterestType(loan.interestType);
      setInterestValue(String(loan.interestValue));
      setFrequency(loan.frequency);
      setTenure(String(loan.tenureCount));
      setError(null);
    }
  }, [loan]);

  const principalNum = +principal || 0;
  const interestValueNum = +interestValue || 0;
  const tenureNum = +tenure || 0;
  const id = loan?.id ?? 0;

  const preview = useQuery({
    queryKey: ["personalLoanRenewPreview", id, principalNum, interestType, interestValueNum, frequency, tenureNum],
    queryFn: () => previewRenewal(id, { principalAmount: principalNum, interestType, interestValue: interestValueNum, frequency, tenureCount: tenureNum || 1 }),
    enabled: !!loan && principalNum > 0,
  });

  const renew = useMutation({
    mutationFn: () => renewPersonalLoan(id, { principalAmount: principalNum, interestType, interestValue: interestValueNum, frequency, tenureCount: tenureNum }),
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: ["personalLoans"] });
      qc.invalidateQueries({ queryKey: ["personalLoan"] });
      onRenewed(result.newLoan.id);
    },
    onError: (err) => setError(errMsg(err, "Could not renew the loan — try again.")),
  });

  return (
    <Sheet visible={!!loan} onClose={onClose} title={`Renew Loan — ${loan?.loanNumber ?? ""}`} maxHeightPct={85}>
      {loan ? <Txt style={{ fontSize: 12, color: C.muted, marginTop: 6, marginBottom: 10 }}>Current outstanding balance: {inr(loan.outstandingAmount)}</Txt> : null}
      <Field label="New principal amount">
        <Input keyboardType="decimal-pad" value={principal} onChangeText={setPrincipal} />
      </Field>
      <Field label="Interest type">
        <ChipToggle options={["Flat", "Percentage"] as const} value={interestType} onChange={setInterestType} />
      </Field>
      <Field label="Interest value">
        <Input keyboardType="decimal-pad" value={interestValue} onChangeText={setInterestValue} />
      </Field>
      <Field label="Collection frequency">
        <ChipToggle options={FREQS} value={frequency} onChange={setFrequency} />
      </Field>
      <Field label="Number of installments">
        <Input keyboardType="number-pad" value={tenure} onChangeText={setTenure} />
      </Field>
      {preview.isFetching && !preview.data ? <Buffering /> : null}
      {preview.data ? (
        <Card style={{ marginHorizontal: 0, marginBottom: 14 }}>
          <FieldGrid
            items={[
              { k: "Rollover (old outstanding)", v: inr(preview.data.rollover) },
              { k: "New interest", v: inr(preview.data.interestAmount) },
              { k: "Cash paid to customer", v: inr(preview.data.disbursedAmount) },
              { k: "New repayment obligation", v: inr(principalNum) },
            ]}
          />
        </Card>
      ) : null}
      {preview.data?.shortfall ? <WarningBanner>New principal is not enough to cover the outstanding balance and interest.</WarningBanner> : null}
      {error ? <Txt style={{ fontSize: 12, color: C.red, marginBottom: 10 }}>{error}</Txt> : null}
      <PrimaryButton label="Confirm Renewal" onPress={() => renew.mutate()} loading={renew.isPending} disabled={!principal || !tenure || !!preview.data?.shortfall} />
    </Sheet>
  );
}
