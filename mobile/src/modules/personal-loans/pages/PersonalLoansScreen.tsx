import { SplitPaymentInput, type SplitPayment } from "@/common/components/SplitPaymentInput";
import React, { useEffect, useState } from "react";
import { Pressable, View } from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocalSearchParams } from "expo-router";
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
  GroupedFilter,
  emptyGroupedFilter,
  gfValues,
  type GFSection,
  type GroupedFilterValue,
  FieldRow,
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
  toast,
} from "@/common/components/ui";
import { ApprovalChainPanel } from "@/common/components/ApprovalChainPanel";
import { isFlowOff, stageByKey, useApprovalWorkflow } from "@/common/services/approvalWorkflowService";
import { SheetScrollView } from "@/common/components/ui/SheetScrollView";
import { useServerList } from "@/common/hooks/use-server-list";
import { usePersistedState } from "@/common/hooks/use-persisted-state";
import { useAuth } from "@/common/providers/AuthProvider";
import { listCustomers } from "@/modules/customers/services/customerService";
import { createBank, listBanksPage } from "@/modules/banks/services/bankService";
import type { Bank } from "@/modules/banks/types/bank-types";
import { ApiError } from "@/common/services/httpClient";
import { getToken } from "@/common/services/tokenStorage";
import { withPrintProgress } from "@/common/components/ui/PrintProgressHost";
import { approvePersonalLoan, createPersonalLoan, getPersonalLoan, getPersonalLoanSchedulePage, listPersonalLoanApprovals, listPersonalLoanPaymentsPage, listPersonalLoansPage, previewRenewal, recordPersonalLoanPayment, renewPersonalLoan, personalLoanBondUrl } from "@/modules/personal-loans/services/personalLoanService";
import { type Frequency, type InterestType, type PersonalLoan, type PersonalLoanInstallment, type PersonalLoanPayment, type PersonalLoanBondLang } from "@/modules/personal-loans/types/personal-loan-types";
import { dmy, inr, todayISO } from "@/common/utils/format";
import type { Customer } from "@/modules/customers/types/customer-types";
import { loadErrorText, userMessage } from "@/common/services/apiErrors";

// Personal Loans — prototype #header-personalloans + #page-personalloans and
// the pl-filter / pl-create / pl-collect / pl-detail / pl-renew sheets.
// Search (PL no., customer name/code) and the frequency filter are backend
// params on GET /personal-loans; rows page in 10 at a time.

const FREQS = ["Daily", "Weekly", "Monthly"] as const;
const PAYMENT_METHODS = ["Cash", "UPI", "Bank Transfer"] as const;
const PER: Record<Frequency, string> = { Daily: "day", Weekly: "wk", Monthly: "mo" };

// "Pending approval" lists loans waiting in the tenant's "personal_loan"
// approval chain (status filter is server-side).

type Filters = { frequency?: string; status?: string };

const FILTER_SECTIONS: GFSection[] = [
  { kind: "static", key: "freq", label: "Frequency", options: FREQS.map((f) => ({ value: f, label: f })) },
  {
    kind: "static",
    key: "status",
    label: "Status",
    options: ["Active", "Pending Approval", "Rejected", "Closed", "Renewed", "Defaulted"].map((s) => ({ value: s, label: s })),
  },
];

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

  // One grouped filter, multi-select: Frequency and Status (same options as web), sent comma-joined.
  const [fv, setFv] = usePersistedState<GroupedFilterValue>("personalLoans:filters", emptyGroupedFilter());

  const [createOpen, setCreateOpen] = useState(false);
  const [detailId, setDetailId] = useState<number | null>(null);
  const [collectLoan, setCollectLoan] = useState<PersonalLoan | null>(null);
  const [renewLoan, setRenewLoan] = useState<PersonalLoan | null>(null);

  // ?id=<personal loan id> (dashboard "Needs attention") opens its detail.
  const params = useLocalSearchParams<{ id?: string; t?: string }>();
  useEffect(() => {
    if (params.id && Number(params.id)) setDetailId(Number(params.id));
  }, [params.id, params.t]);

  const freqs = gfValues(fv, "freq");
  const statuses = gfValues(fv, "status");
  const filters: Filters = { frequency: freqs.length ? freqs.join(",") : undefined, status: statuses.length ? statuses.join(",") : undefined };
  const filterCount = freqs.length + statuses.length;
  const list = useServerList<PersonalLoan, Filters>({ key: ["personalLoans", "list"], persistKey: "personalLoans", filters, fetchPage: (p) => listPersonalLoansPage(p) });

  return (
    <Screen
      header={<FlatHeader title="Personal Loans" subtitle="Non-gold loans & collections" />}
      floating={canCreate ? <FabCorner onPress={() => setCreateOpen(true)} label="Create personal loan" /> : null}
    >
      <ServerFlatList
        list={list}
        items={list.items}
        keyOf={(l) => String(l.id)}
        emptyText={list.search || filterCount ? "No personal loans match your search." : "No personal loans yet."}
        header={
          <View style={{ paddingTop: 12 }}>
            <SearchInput value={list.search} onChangeText={list.setSearch} placeholder="Search by loan ID or customer name" style={{ paddingBottom: 8 }} />
            <GroupedFilter title="Filter personal loans" sections={FILTER_SECTIONS} value={fv} onChange={setFv} style={{ alignSelf: "flex-start", marginBottom: 10 }} />
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

type CreatePersonalLoanSheetProps = { visible: boolean; onClose: () => void; onCreated: (l: PersonalLoan) => void };

// ---------------------------------------------------------------------------
// Create Personal Loan (prototype #pl-create-modal)
// ---------------------------------------------------------------------------
function CreatePersonalLoanSheet({ visible, onClose, onCreated }: CreatePersonalLoanSheetProps) {
  const qc = useQueryClient();
  // Tenant's "personal_loan" flow on → the loan is created "Pending
  // Approval" and only disbursed once its final stage approves it.
  const needsApproval = !isFlowOff(useApprovalWorkflow(), "personal_loan");
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [principal, setPrincipal] = useState("");
  const [interestType, setInterestType] = useState<InterestType>("Flat");
  const [interestValue, setInterestValue] = useState("");
  const [frequency, setFrequency] = useState<Frequency>("Daily");
  const [tenureCount, setTenureCount] = useState("");
  // Same as the web's "Full Amount" checkbox: withhold the interest upfront
  // (default) or disburse the full principal now.
  const [disburse, setDisburse] = useState<"Withhold interest" | "Full amount">("Withhold interest");
  // Late payment (optional) and how the disbursement leaves the till — same as web.
  const [penalRate, setPenalRate] = useState("");
  const [graceDays, setGraceDays] = useState("");
  const [pay, setPay] = useState<SplitPayment | null>(null);
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
      setPenalRate("");
      setGraceDays("");
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
        penalInterestRate: penalRate ? +penalRate : undefined,
        gracePeriodDays: graceDays ? +graceDays : undefined,
        ...(pay?.split ?? {}),
        bankId: pay?.bankId,
      }),
    onSuccess: (loan) => {
      qc.invalidateQueries({ queryKey: ["personalLoans"] });
      if (loan.status === "Pending Approval") toast.success("Personal loan submitted for approval", `${loan.loanNumber} — disbursed once approved`);
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
    if (disbursedAmount > 0 && !pay?.ready) return "The disbursement breakdown must add up to the amount the customer gets, with a bank for every UPI / Bank Transfer line.";
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
      <FieldRow>
        <Field label="Penal interest (% p.a.)" style={{ flex: 1 }}>
          <Input keyboardType="decimal-pad" placeholder="Same as loan rate" value={penalRate} onChangeText={setPenalRate} />
        </Field>
        <Field label="Grace period (days)" style={{ flex: 1 }}>
          <Input keyboardType="number-pad" placeholder="e.g. 5" value={graceDays} onChangeText={setGraceDays} />
        </Field>
      </FieldRow>
      {disbursedAmount > 0 ? <SplitPaymentInput total={disbursedAmount} onChange={setPay} bankLabel="Bank (account it is paid from)" /> : null}
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
        label={needsApproval ? "Submit for Approval" : "Create & Disburse"}
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

type PersonalLoanDetailSheetProps = {
  loanId: number | null;
  onClose: () => void;
  onOpenLoan: (id: number) => void;
  canUpdate: boolean;
  onCollect: (l: PersonalLoan) => void;
  onRenew: (l: PersonalLoan) => void;
};

function PersonalLoanDetailSheet({
  loanId,
  onClose,
  onOpenLoan,
  canUpdate,
  onCollect,
  onRenew,
}: PersonalLoanDetailSheetProps) {
  const visible = loanId != null;
  const id = loanId ?? 0;
  const [tab, setTab] = useState<DetailTab>("schedule");
  const [bondBusy, setBondBusy] = useState<PersonalLoanBondLang | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setTab("schedule");
    setError(null);
  }, [loanId]);

  const qc = useQueryClient();
  const wf = useApprovalWorkflow();
  const loan = useQuery({ queryKey: ["personalLoan", String(id)], queryFn: () => getPersonalLoan(id), enabled: visible });
  // Approval chain (tenant's "personal_loan" flow) — only for a loan that
  // went through it (approvalStage set).
  const inChain = !!loan.data?.approvalStage;
  const approvals = useQuery({
    queryKey: ["personalLoanApprovals", String(id)],
    queryFn: () => listPersonalLoanApprovals(id),
    enabled: visible && inChain,
  });
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

  async function downloadBond(lang: PersonalLoanBondLang) {
    const l = loan.data;
    if (!l || bondBusy) return;
    setBondBusy(lang);
    setError(null);
    try {
      const token = await getToken();
      const targetUri = `${FileSystem.cacheDirectory}bond-${l.loanNumber}-${lang}.pdf`;
      const result = await withPrintProgress(() =>
        FileSystem.downloadAsync(personalLoanBondUrl(l.id, lang), targetUri, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        })
      );
      if (result.status < 200 || result.status >= 300) throw new ApiError(result.status, "", undefined);
      if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(result.uri, { mimeType: "application/pdf" });
    } catch (e) {
      setError(errMsg(e, "Could not download the bond."));
    } finally {
      setBondBusy(null);
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
      {inChain ? (
        <Card style={{ marginHorizontal: 0, marginBottom: 14 }}>
          <Txt style={{ fontSize: 12, fontWeight: "700", marginBottom: 8 }}>Approval</Txt>
          <ApprovalChainPanel
            flow="personal_loan"
            pending={l.approvalStage}
            status={l.status === "Pending Approval" ? "Pending" : l.status === "Rejected" ? "Rejected" : "Approved"}
            rejectionRemarks={(approvals.data ?? []).find((a) => a.action === "Rejected")?.remarks}
            noun="Personal loan"
            rejectMessage={`Reject ${l.loanNumber}? Nothing is disbursed.`}
            canDecide={canUpdate}
            decide={(input) => approvePersonalLoan(l.id, input)}
            onSaved={() => {
              setError(null);
              qc.invalidateQueries({ queryKey: ["personalLoans"] });
              qc.invalidateQueries({ queryKey: ["personalLoan", String(l.id)] });
              qc.invalidateQueries({ queryKey: ["personalLoanApprovals", String(l.id)] });
              qc.invalidateQueries({ queryKey: ["personalLoanSchedule", l.id] });
            }}
            onError={setError}
          />
          {(approvals.data ?? []).map((a) => (
            <Txt key={a.id} style={{ fontSize: 11, color: C.muted, marginTop: 4 }}>
              {dmy(a.createdAt)} · {a.action} at {stageByKey(wf, "personal_loan", a.stage)?.label ?? a.stage}
              {a.actorRole ? ` by ${a.actorRole}` : ""}
              {a.remarks ? ` — ${a.remarks}` : ""}
            </Txt>
          ))}
        </Card>
      ) : null}
      {l.penalCycleCount > 0 ? (
        <WarningBanner>
          Penal interest applied {l.penalCycleCount} time(s) — {inr(l.totalPenalInterestCharged)} added at {l.penalInterestRate}% p.a.
        </WarningBanner>
      ) : null}
      <PrimaryButton label={bondBusy === "en" ? "Downloading…" : "Download Bond — English"} variant="outline" loading={bondBusy === "en"} onPress={() => downloadBond("en")} style={{ marginBottom: 8 }} />
      <PrimaryButton label={bondBusy === "ml" ? "Downloading…" : "Download Bond — Malayalam"} variant="outline" loading={bondBusy === "ml"} onPress={() => downloadBond("ml")} style={{ marginBottom: 12 }} />
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
  else if (loan.isError || !l) body = <EmptyText>{loadErrorText(loan.error) ?? "This loan no longer exists."}</EmptyText>;
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

type CollectSheetProps = { loan: PersonalLoan | null; onClose: () => void };

// ---------------------------------------------------------------------------
// Collect Payment (prototype #pl-collect-modal)
// ---------------------------------------------------------------------------
function CollectSheet({ loan, onClose }: CollectSheetProps) {
  const canCreateBank = useAuth().can("Bank_Management", "can_create_bank");
  const qc = useQueryClient();
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<(typeof PAYMENT_METHODS)[number]>("Cash");
  const [bank, setBank] = useState<Bank | null>(null);
  const [reference, setReference] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const bankRequired = method === "UPI" || method === "Bank Transfer";

  useEffect(() => {
    if (loan) {
      setAmount(String(Math.min(loan.installmentAmount, loan.outstandingAmount) || ""));
      setMethod("Cash");
      setBank(null);
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
        bankId: bankRequired ? bank?.id : undefined,
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
        <ChipToggle options={PAYMENT_METHODS} value={method} onChange={(v) => { setMethod(v); if (v === "Cash") setBank(null); }} />
      </Field>
      {bankRequired ? (
        <AsyncSelect<Bank>
          label="Bank"
          placeholder="Search or add a bank"
          queryKey={["banks", "picker"]}
          fetcher={async (q) => (await listBanksPage({ q: q || undefined, limit: 20, offset: 0 })).items ?? []}
          selectedLabel={bank?.name}
          onSelect={setBank}
          onClear={() => setBank(null)}
          keyOf={(b) => b.id}
          renderItem={(b) => ({ title: b.name })}
          onCreateNew={canCreateBank ? (name) => createBank({ name }) : undefined}
        />
      ) : null}
      <Field label="Reference">
        <Input placeholder="Optional" value={reference} onChangeText={setReference} />
      </Field>
      <Field label="Description">
        <Input placeholder="Optional" value={description} onChangeText={setDescription} />
      </Field>
      {error ? <Txt style={{ fontSize: 12, color: C.red, marginBottom: 10 }}>{error}</Txt> : null}
      <PrimaryButton label="Confirm Payment" onPress={() => collect.mutate()} loading={collect.isPending} disabled={!amount || Number(amount) <= 0 || (bankRequired && !bank)} />
    </Sheet>
  );
}

type RenewSheetProps = { loan: PersonalLoan | null; onClose: () => void; onRenewed: (newId: number) => void };

// ---------------------------------------------------------------------------
// Renew Loan (prototype #pl-renew-modal) with the server renewal preview.
// ---------------------------------------------------------------------------
function RenewSheet({ loan, onClose, onRenewed }: RenewSheetProps) {
  const qc = useQueryClient();
  const [principal, setPrincipal] = useState("");
  const [interestType, setInterestType] = useState<InterestType>("Flat");
  const [interestValue, setInterestValue] = useState("");
  const [frequency, setFrequency] = useState<Frequency>("Daily");
  const [tenure, setTenure] = useState("");
  const [pay, setPay] = useState<SplitPayment | null>(null);
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
    mutationFn: () =>
      renewPersonalLoan(id, {
        principalAmount: principalNum, interestType, interestValue: interestValueNum, frequency, tenureCount: tenureNum,
        ...((preview.data?.disbursedAmount ?? 0) > 0 ? { ...(pay?.split ?? {}), bankId: pay?.bankId } : {}),
      }),
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
      {preview.data && preview.data.disbursedAmount > 0 ? <SplitPaymentInput total={preview.data.disbursedAmount} onChange={setPay} bankLabel="Bank (account it is paid from)" /> : null}
      {preview.data?.shortfall ? <WarningBanner>New principal is not enough to cover the outstanding balance and interest.</WarningBanner> : null}
      {error ? <Txt style={{ fontSize: 12, color: C.red, marginBottom: 10 }}>{error}</Txt> : null}
      <PrimaryButton label="Confirm Renewal" onPress={() => renew.mutate()} loading={renew.isPending} disabled={!principal || !tenure || !!preview.data?.shortfall || ((preview.data?.disbursedAmount ?? 0) > 0 && !pay?.ready)} />
    </Sheet>
  );
}
