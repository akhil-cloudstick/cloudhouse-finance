import { SplitPaymentInput, type SplitPayment } from "@/common/components/SplitPaymentInput";
import React, { useEffect, useState } from "react";
import { Pressable, View } from "react-native";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import { AccRow, AsyncSelect, gfDate, Buffering, C, Card, ChipToggle, FabCorner, Field, FieldGrid, GroupedFilter, emptyGroupedFilter, gfValues, type GFSection, type GroupedFilterValue, FieldRow, FlatHeader, Input, PrimaryButton, Screen, SearchFilterRow, ServerFlatList, Sheet, Txt, WarningBanner, toast } from "@/common/components/ui";
import { chainFor, isFlowOff, useApprovalWorkflow } from "@/common/services/approvalWorkflowService";
import { useServerList } from "@/common/hooks/use-server-list";
import { usePersistedState } from "@/common/hooks/use-persisted-state";
import { useAuth } from "@/common/providers/AuthProvider";
import { getCashSummary } from "@/modules/cash/services/cashService";
import { CustomerFormSheet } from "@/modules/customers/components/CustomerFormSheet";
import { listCustomersPage } from "@/modules/customers/services/customerService";
import { createPersonalLoan, editPersonalLoan, listPersonalLoansPage, previewRenewal, recordPersonalLoanPayment, renewPersonalLoan } from "@/modules/personal-loans/services/personalLoanService";
import { type Frequency, type InterestType, type PersonalLoan } from "@/modules/personal-loans/types/personal-loan-types";
import { inr } from "@/common/utils/format";
import type { Customer } from "@/modules/customers/types/customer-types";
import { FieldErr } from "@/common/components/ErrorText";
import { userMessage } from "@/common/services/apiErrors";

// Personal Loans — prototype #header-personalloans + #page-personalloans and
// the pl-filter / pl-create / pl-collect / pl-detail / pl-renew sheets.
// Search (PL no., customer name/code) and the frequency filter are backend
// params on GET /personal-loans; rows page in 10 at a time.

const FREQS = ["Daily", "Weekly", "Monthly"] as const;
export const PER: Record<Frequency, string> = { Daily: "day", Weekly: "wk", Monthly: "mo" };

// "Pending approval" lists loans waiting in the tenant's "personal_loan"
// approval chain (status filter is server-side).

type Filters = { frequency?: string; status?: string; from?: string; to?: string };

// Pending Approval / Rejected only occur while the business has the personal_loan approval flow on (web parity).
const filterSections = (approvalOn: boolean): GFSection[] => [
  { kind: "static", key: "freq", label: "Frequency", options: FREQS.map((f) => ({ value: f, label: f })) },
  {
    kind: "static",
    key: "status",
    label: "Status",
    options: (approvalOn ? ["Active", "Pending Approval", "Rejected", "Closed", "Renewed", "Defaulted"] : ["Active", "Closed", "Renewed", "Defaulted"]).map((s) => ({ value: s, label: s })),
  },
  { kind: "date", key: "date", label: "Date" },
];

// Personal-loan money movements also change the till, bank balances and ledgers.
export function invalidateMoney(qc: ReturnType<typeof useQueryClient>) {
  for (const key of ["personalLoans", "cash-summary", "ledger", "cash-movements", "banks"]) qc.invalidateQueries({ queryKey: [key] });
}

export const errMsg = (err: unknown, fallback: string) => userMessage(err, fallback);

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
  const [collectLoan, setCollectLoan] = useState<PersonalLoan | null>(null);

  // ?id=<personal loan id> (old deep link) opens that loan's page.
  const params = useLocalSearchParams<{ id?: string; t?: string }>();
  useEffect(() => {
    if (params.id && Number(params.id)) router.push(`/personal-loans/${Number(params.id)}` as never);
  }, [params.id, params.t]);

  const freqs = gfValues(fv, "freq");
  const statuses = gfValues(fv, "status");
  const approvalOn = chainFor(useApprovalWorkflow(), "personal_loan").length > 0;
  const dr = gfDate(fv, "date");
  const filters: Filters = { frequency: freqs.length ? freqs.join(",") : undefined, status: statuses.length ? statuses.join(",") : undefined, from: dr.from || undefined, to: dr.to || undefined };
  const filterCount = freqs.length + statuses.length + (dr.from || dr.to ? 1 : 0);
  const list = useServerList<PersonalLoan, Filters>({ key: ["personalLoans", "list"], persistKey: "personalLoans", filters, fetchPage: (p) => listPersonalLoansPage(p) });

  return (
    <Screen
      header={<FlatHeader title="Personal Loans" subtitle="Non-gold loans & collections" />}
      floating={canCreate ? <FabCorner onPress={() => setCreateOpen(true)} label="Create personal loan" /> : null}
    >
      <ServerFlatList stickyHeader
        list={list}
        items={list.items}
        keyOf={(l) => String(l.id)}
        emptyText={list.search || filterCount ? "No personal loans match your search." : "No personal loans yet."}
        header={
          <View style={{ paddingTop: 12 }}>
            <SearchFilterRow
              value={list.search}
              onChangeText={list.setSearch}
              placeholder="Search by loan ID or customer name"
              filter={<GroupedFilter title="Filter personal loans" sections={filterSections(approvalOn)} value={fv} onChange={setFv} />}
            />
          </View>
        }
        renderItem={(l, i) => (
          <AccRow
            // iPad and bigger: the same columns as the web Personal Loans table.
            cells={[
              { h: "Loan / Customer", v: l.loanNumber, sub: l.customer?.name, flex: 1.6 },
              { h: "Principal", v: inr(l.principalAmount), num: true },
              { h: "Outstanding", v: inr(l.outstandingAmount), num: true },
              { h: "Frequency", v: l.frequency },
              { h: "Status", v: l.status, chip: true },
            ]}
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
              { label: "Collect Payment", disabled: !canUpdate || (l.status !== "Active" && l.status !== "Pending"), onPress: () => setCollectLoan(l) },
              { label: "View", primary: true, onPress: () => router.push(`/personal-loans/${l.id}` as never) },
            ]}
          />
        )}
      />

      <CreatePersonalLoanSheet
        visible={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={(loan) => {
          setCreateOpen(false);
          router.push(`/personal-loans/${loan.id}` as never);
        }}
      />
      <CollectSheet loan={collectLoan} onClose={() => setCollectLoan(null)} />
    </Screen>
  );
}

// `loan` set: corrects that loan's terms (only before any payment) instead of opening a new one.
type CreatePersonalLoanSheetProps = { visible: boolean; onClose: () => void; onCreated: (l: PersonalLoan) => void; loan?: PersonalLoan | null };

// The loan amount as it was typed in: the stored principal is what is owed, which includes the interest on a full disbursement.
const enteredPrincipal = (l: PersonalLoan) => (l.fullDisbursement ? l.principalAmount - l.interestAmount : l.principalAmount);
// Penal terms left at their default follow the loan's own interest, so they are shown blank.
const penalIsDefault = (l: PersonalLoan) => (l.interestType === "Percentage" ? l.penalInterestRate === l.interestValue && !l.penalFlatAmount : !l.penalInterestRate && l.penalFlatAmount === l.interestAmount);

// ---------------------------------------------------------------------------
// Create Personal Loan (prototype #pl-create-modal)
// ---------------------------------------------------------------------------
export function CreatePersonalLoanSheet({ visible, onClose, onCreated, loan }: CreatePersonalLoanSheetProps) {
  const qc = useQueryClient();
  const editing = !!loan;
  // Tenant's "personal_loan" flow on → the loan is created "Pending
  // Approval" and only disbursed once its final stage approves it.
  // The hook is called on every render (never behind `!editing`), so the hook order never changes.
  const approvalWorkflow = useApprovalWorkflow();
  const needsApproval = !editing && !isFlowOff(approvalWorkflow, "personal_loan");
  const [customer, setCustomer] = useState<Customer | null>(null);
  const canCreateCustomer = useAuth().can("Customer_Management", "can_create_customer");
  const [addingCustomer, setAddingCustomer] = useState(false);
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
  const [tried, setTried] = useState(false);

  useEffect(() => {
    if (visible) {
      setCustomer(null);
      setPrincipal(loan ? String(enteredPrincipal(loan)) : "");
      setInterestType(loan?.interestType ?? "Flat");
      setInterestValue(loan ? String(loan.interestValue) : "");
      setFrequency(loan?.frequency ?? "Daily");
      setTenureCount(loan ? String(loan.tenureCount) : "");
      setDisburse(loan?.fullDisbursement ? "Full amount" : "Withhold interest");
      setPenalRate(loan && !penalIsDefault(loan) && loan.penalInterestRate ? String(loan.penalInterestRate) : "");
      setGraceDays(loan?.gracePeriodDays ? String(loan.gracePeriodDays) : "");
      setTried(false);
    }
  }, [visible, loan]);

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

  // Editing keeps how the customer was paid unless the amount changes (then a new breakdown is needed); the server checks the till.
  const amountChanged = !!loan && Math.abs(disbursedAmount - loan.disbursedAmount) >= 0.005;

  // Branch balance in hand — skipped when approval is needed (nothing is paid out yet), when editing, or without cash access.
  const canViewCash = useAuth().can("Cash_Management", "can_view_cash_module");
  const balance = useQuery({
    queryKey: ["cash-summary", "pl-create", customer?.branchId],
    queryFn: () => getCashSummary(customer!.branchId),
    enabled: visible && !editing && !needsApproval && canViewCash && !!customer?.branchId,
    retry: false,
  });
  const balanceInHand = balance.data?.expectedCash ?? null;
  const insufficient = !editing && !needsApproval && balanceInHand !== null && disbursedAmount > balanceInHand + 0.005;

  const submit = useMutation({
    mutationFn: () =>
      loan
        ? editPersonalLoan(loan.id, {
            principalAmount: principalNum,
            interestType,
            interestValue: interestValueNum,
            frequency,
            tenureCount: tenureNum,
            fullDisbursement,
            penalInterestRate: penalRate ? +penalRate : 0,
            gracePeriodDays: graceDays ? +graceDays : 0,
            ...(amountChanged ? { ...(pay?.split ?? {}), bankId: pay?.bankId } : {}),
          })
        : createPersonalLoan({
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
    onSuccess: (saved) => {
      invalidateMoney(qc);
      if (editing) {
        qc.invalidateQueries({ queryKey: ["personalLoan"] });
        qc.invalidateQueries({ queryKey: ["personalLoanSchedule"] });
        toast.success("Loan updated", `${saved.loanNumber} — terms saved`);
      } else if (saved.status === "Pending Approval") toast.success("Personal loan submitted for approval", `${saved.loanNumber} — disbursed once approved`);
      onCreated(saved);
    },
    onError: (err) => toast.error(errMsg(err, "Could not create the loan — try again.")),
  });

  const errs: Record<string, string> = {};
  if (!editing && !customer) errs.customer = "Select a customer.";
  if (!principalNum || principalNum <= 0) errs.principal = "Enter the principal amount.";
  if (!tenureNum || tenureNum <= 0) errs.tenure = "Enter the number of installments.";
  if (interestValue.trim() === "") errs.interest = "Enter the interest value.";
  else if (interestValueNum < 0) errs.interest = "Interest value must not be negative.";
  else if (interestAmount >= principalNum) errs.interest = "Interest amount must be less than the principal amount.";
  if (insufficient) errs.pay = "Insufficient balance in hand to disburse this loan.";
  else if ((!editing || amountChanged) && disbursedAmount > 0 && !pay?.ready) errs.pay = "The disbursement breakdown must add up to the amount the customer gets, with a bank for every UPI / Bank Transfer line.";
  const fe = (k: string) => (tried ? errs[k] : undefined);

  return (
    <Sheet visible={visible} onClose={onClose} title={loan ? `Edit ${loan.loanNumber}` : "Create Personal Loan"} maxHeightPct={92}>
      {loan ? (
        <Field label="Customer">
          <Input value={`${loan.customer.name} · ${loan.customer.code}`} editable={false} />
        </Field>
      ) : (
      <AsyncSelect<Customer>
        label="Customer"
        placeholder="Search existing customer by name, ID or phone"
        queryKey={["customers", "picker"]}
        fetcher={async (q) => (await listCustomersPage({ q: q || undefined, limit: 20, offset: 0 })).items ?? []}
        selectedLabel={customer ? `${customer.name} · ${customer.code ?? ""}` : undefined}
        onClear={() => setCustomer(null)}
        onSelect={setCustomer}
        keyOf={(c) => c.id}
        renderItem={(c) => ({ title: c.name, sub: [c.code, c.phone].filter(Boolean).join(" · ") })}
      />
      )}
      <FieldErr m={fe("customer")} />
      {!loan && canCreateCustomer && !customer ? (
        <Pressable onPress={() => setAddingCustomer(true)} hitSlop={6} style={{ marginTop: -6, marginBottom: 12 }} accessibilityRole="button">
          <Txt style={{ fontSize: 12.5, fontWeight: "700", color: C.brandDeep }}>+ Add new customer</Txt>
        </Pressable>
      ) : null}
      <Field label="Principal amount">
        <Input keyboardType="decimal-pad" placeholder="e.g. 15000" value={principal} onChangeText={setPrincipal} />
      </Field>
      <FieldErr m={fe("principal")} />
      <Field label="Number of installments">
        <Input keyboardType="number-pad" placeholder="e.g. 100" value={tenureCount} onChangeText={setTenureCount} />
      </Field>
      <FieldErr m={fe("tenure")} />
      <Field label="Interest type">
        <ChipToggle options={["Flat", "Percentage"] as const} value={interestType} onChange={setInterestType} />
      </Field>
      <Field label={interestType === "Flat" ? "Interest value (₹)" : "Interest value (%)"}>
        <Input keyboardType="decimal-pad" placeholder={interestType === "Flat" ? "e.g. 1500" : "e.g. 2"} value={interestValue} onChangeText={setInterestValue} />
      </Field>
      <FieldErr m={fe("interest")} />
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
      {disbursedAmount > 0 && (!editing || amountChanged) ? <SplitPaymentInput total={disbursedAmount} onChange={setPay} bankLabel="Bank (account it is paid from)" /> : null}
      <FieldErr m={fe("pay")} />
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
      <PrimaryButton
        label={editing ? "Save Changes" : needsApproval ? "Submit for Approval" : "Create & Disburse"}
        loading={submit.isPending}
        onPress={() => {
          if (Object.keys(errs).length) return setTried(true);
          submit.mutate();
        }}
      />
      <CustomerFormSheet visible={addingCustomer} onClose={() => setAddingCustomer(false)} onSaved={(c) => { if (c?.id) setCustomer(c); }} />
    </Sheet>
  );
}

type CollectSheetProps = { loan: PersonalLoan | null; onClose: () => void };

// ---------------------------------------------------------------------------
// Collect Payment (prototype #pl-collect-modal)
// ---------------------------------------------------------------------------
// Whole rupees, halves away from zero (same rule as web roundRupee / backend RoundMoney).
const roundRupee = (n: number) => {
  if (!Number.isFinite(n)) return 0;
  const r = Math.round(Math.round(Math.abs(n) * 1e6) / 1e6);
  return n < 0 ? -r : r;
};

export function CollectSheet({ loan, onClose }: CollectSheetProps) {
  const qc = useQueryClient();
  const [amount, setAmount] = useState("");
  const [pay, setPay] = useState<SplitPayment | null>(null);
  const outstanding = loan ? roundRupee(loan.outstandingAmount) : 0;
  // How many installments are being paid: a count sets amount = count × installment (capped at what is owed); editing the amount clears it.
  const [count, setCount] = useState("");
  const maxInstallments = loan && loan.installmentAmount > 0 ? Math.max(1, Math.min(loan.tenureCount || Infinity, Math.ceil(outstanding / loan.installmentAmount))) : 1;
  const onCount = (raw: string) => {
    let v = raw.replace(/[^0-9]/g, "");
    if (v !== "" && +v > maxInstallments) v = String(maxInstallments);
    if (v !== "" && +v < 1) v = "1";
    setCount(v);
    if (loan && +v > 0) setAmount(String(roundRupee(Math.min(+v * loan.installmentAmount, outstanding))));
  };

  useEffect(() => {
    if (loan) {
      const o = roundRupee(loan.outstandingAmount);
      const d = roundRupee(Math.min(loan.installmentAmount, o));
      setAmount(d > 0 ? String(d) : "");
      setCount(d > 0 ? "1" : "");
      setPay(null);
    }
  }, [loan]);

  const amt = Number(amount) || 0;
  const overCap = amt > 0 && roundRupee(amt) > outstanding + 0.01;
  const ready = amt > 0 && !overCap && !!pay?.ready;

  const collect = useMutation({
    mutationFn: () => {
      const sp = pay!;
      return recordPersonalLoanPayment(loan!.id, {
        amount: amt,
        cashAmount: sp.split.cashAmount,
        upiAmount: sp.split.upiAmount,
        bankTransferAmount: sp.split.bankTransferAmount,
        chequeAmount: sp.split.chequeAmount,
        bankId: sp.bankId,
      });
    },
    onSuccess: () => {
      const id = loan!.id;
      qc.invalidateQueries({ queryKey: ["personalLoan", String(id)] });
      qc.invalidateQueries({ queryKey: ["personalLoanSchedule", id] });
      qc.invalidateQueries({ queryKey: ["personalLoanPayments", id] });
      invalidateMoney(qc);
      onClose();
    },
    onError: (err) => toast.error(errMsg(err, "Could not record the payment — try again.")),
  });

  return (
    <Sheet visible={!!loan} onClose={onClose} title={`Collect Payment — ${loan?.loanNumber ?? ""}`} maxHeightPct={85}>
      {loan ? (
        <Txt style={{ fontSize: 12, color: C.muted, marginTop: 6, marginBottom: 10 }}>
          Outstanding balance: {inr(outstanding)}  ·  Balance after payment: {inr(Math.max(0, outstanding - amt))}
        </Txt>
      ) : null}
      <FieldRow>
        <Field label="No. of installments" style={{ flex: 1 }}>
          <Input keyboardType="number-pad" value={count} onChangeText={onCount} placeholder="e.g. 1" />
        </Field>
        <Field label="Amount" style={{ flex: 1 }}>
          <Input keyboardType="decimal-pad" value={amount} onChangeText={(v) => { setAmount(v); setCount(""); }} placeholder="₹" />
        </Field>
      </FieldRow>
      {overCap ? <Txt style={{ fontSize: 12, color: C.red, marginBottom: 10 }}>Amount cannot exceed the outstanding balance of {inr(outstanding)}.</Txt> : null}
      {loan && amt > 0 ? <SplitPaymentInput key={loan.id} total={amt} onChange={setPay} /> : null}
      <PrimaryButton label="Confirm Payment" onPress={() => collect.mutate()} loading={collect.isPending} disabled={!ready} />
    </Sheet>
  );
}

type RenewSheetProps = { loan: PersonalLoan | null; onClose: () => void; onRenewed: (newId: number) => void };

// ---------------------------------------------------------------------------
// Renew Loan (prototype #pl-renew-modal) with the server renewal preview.
// ---------------------------------------------------------------------------
export function RenewSheet({ loan, onClose, onRenewed }: RenewSheetProps) {
  const qc = useQueryClient();
  const [principal, setPrincipal] = useState("");
  const [interestType, setInterestType] = useState<InterestType>("Flat");
  const [interestValue, setInterestValue] = useState("");
  const [frequency, setFrequency] = useState<Frequency>("Daily");
  const [tenure, setTenure] = useState("");
  const [pay, setPay] = useState<SplitPayment | null>(null);

  useEffect(() => {
    if (loan) {
      setPrincipal(String(loan.principalAmount));
      setInterestType(loan.interestType);
      setInterestValue(String(loan.interestValue));
      setFrequency(loan.frequency);
      setTenure(String(loan.tenureCount));
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
    placeholderData: keepPreviousData,
  });

  const renew = useMutation({
    mutationFn: () =>
      renewPersonalLoan(id, {
        principalAmount: principalNum, interestType, interestValue: interestValueNum, frequency, tenureCount: tenureNum,
        ...((preview.data?.disbursedAmount ?? 0) > 0 ? { ...(pay?.split ?? {}), bankId: pay?.bankId } : {}),
      }),
    onSuccess: (result) => {
      invalidateMoney(qc);
      qc.invalidateQueries({ queryKey: ["personalLoan"] });
      onRenewed(result.newLoan.id);
    },
    onError: (err) => toast.error(errMsg(err, "Could not renew the loan — try again.")),
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
      <PrimaryButton label="Confirm Renewal" onPress={() => renew.mutate()} loading={renew.isPending} disabled={!principal || !tenure || !!preview.data?.shortfall || ((preview.data?.disbursedAmount ?? 0) > 0 && !pay?.ready)} />
    </Sheet>
  );
}
