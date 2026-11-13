import { SplitPaymentInput, type SplitPayment } from "@/common/components/SplitPaymentInput";
import React, { useEffect, useState } from "react";
import { View } from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import { AccRow, AsyncSelect, Buffering, C, Card, ChipToggle, FabCorner, Field, FieldGrid, GroupedFilter, emptyGroupedFilter, gfValues, type GFSection, type GroupedFilterValue, FieldRow, FlatHeader, Input, PrimaryButton, Screen, SearchFilterRow, ServerFlatList, Sheet, Txt, WarningBanner, toast } from "@/common/components/ui";
import { isFlowOff, useApprovalWorkflow } from "@/common/services/approvalWorkflowService";
import { useServerList } from "@/common/hooks/use-server-list";
import { usePersistedState } from "@/common/hooks/use-persisted-state";
import { useAuth } from "@/common/providers/AuthProvider";
import { listCustomers } from "@/modules/customers/services/customerService";
import { createPersonalLoan, editPersonalLoan, listPersonalLoansPage, previewRenewal, recordPersonalLoanPayment, renewPersonalLoan } from "@/modules/personal-loans/services/personalLoanService";
import { type Frequency, type InterestType, type PersonalLoan } from "@/modules/personal-loans/types/personal-loan-types";
import { inr } from "@/common/utils/format";
import type { Customer } from "@/modules/customers/types/customer-types";
import { userMessage } from "@/common/services/apiErrors";

// Personal Loans — prototype #header-personalloans + #page-personalloans and
// the pl-filter / pl-create / pl-collect / pl-detail / pl-renew sheets.
// Search (PL no., customer name/code) and the frequency filter are backend
// params on GET /personal-loans; rows page in 10 at a time.

const FREQS = ["Daily", "Weekly", "Monthly"] as const;
export const PER: Record<Frequency, string> = { Daily: "day", Weekly: "wk", Monthly: "mo" };

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
            <SearchFilterRow
              value={list.search}
              onChangeText={list.setSearch}
              placeholder="Search by loan ID or customer name"
              filter={<GroupedFilter title="Filter personal loans" sections={FILTER_SECTIONS} value={fv} onChange={setFv} />}
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
  const needsApproval = !editing && !isFlowOff(useApprovalWorkflow(), "personal_loan");
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
      setPrincipal(loan ? String(enteredPrincipal(loan)) : "");
      setInterestType(loan?.interestType ?? "Flat");
      setInterestValue(loan ? String(loan.interestValue) : "");
      setFrequency(loan?.frequency ?? "Daily");
      setTenureCount(loan ? String(loan.tenureCount) : "");
      setDisburse(loan?.fullDisbursement ? "Full amount" : "Withhold interest");
      setPenalRate(loan && !penalIsDefault(loan) && loan.penalInterestRate ? String(loan.penalInterestRate) : "");
      setGraceDays(loan?.gracePeriodDays ? String(loan.gracePeriodDays) : "");
      setError(null);
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
      qc.invalidateQueries({ queryKey: ["personalLoans"] });
      if (editing) {
        qc.invalidateQueries({ queryKey: ["personalLoan"] });
        qc.invalidateQueries({ queryKey: ["personalLoanSchedule"] });
        toast.success("Loan updated", `${saved.loanNumber} — terms saved`);
      } else if (saved.status === "Pending Approval") toast.success("Personal loan submitted for approval", `${saved.loanNumber} — disbursed once approved`);
      onCreated(saved);
    },
    onError: (err) => setError(errMsg(err, "Could not create the loan — try again.")),
  });

  function validate(): string | null {
    if (!editing && !customer) return "Please select a customer.";
    if (!principalNum || principalNum <= 0) return "Please enter the principal amount.";
    if (!tenureNum || tenureNum <= 0) return "Please enter the number of installments.";
    if (interestValueNum < 0) return "Interest value must not be negative.";
    if (interestAmount >= principalNum) return "Interest amount must be less than the principal amount.";
    if ((!editing || amountChanged) && disbursedAmount > 0 && !pay?.ready) return "The disbursement breakdown must add up to the amount the customer gets, with a bank for every UPI / Bank Transfer line.";
    return null;
  }

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
        fetcher={(q) => listCustomers(q || undefined)}
        selectedLabel={customer ? `${customer.name} · ${customer.code ?? ""}` : undefined}
        onClear={() => setCustomer(null)}
        onSelect={setCustomer}
        keyOf={(c) => c.id}
        renderItem={(c) => ({ title: c.name, sub: [c.code, c.phone].filter(Boolean).join(" · ") })}
      />
      )}
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
      {disbursedAmount > 0 && (!editing || amountChanged) ? <SplitPaymentInput total={disbursedAmount} onChange={setPay} bankLabel="Bank (account it is paid from)" /> : null}
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
        label={editing ? "Save Changes" : needsApproval ? "Submit for Approval" : "Create & Disburse"}
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
  const [reference, setReference] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const outstanding = loan ? roundRupee(loan.outstandingAmount) : 0;

  useEffect(() => {
    if (loan) {
      const o = roundRupee(loan.outstandingAmount);
      const d = roundRupee(Math.min(loan.installmentAmount, o));
      setAmount(d > 0 ? String(d) : "");
      setPay(null);
      setReference("");
      setDescription("");
      setError(null);
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
    <Sheet visible={!!loan} onClose={onClose} title={`Collect Payment — ${loan?.loanNumber ?? ""}`} maxHeightPct={85}>
      {loan ? (
        <Txt style={{ fontSize: 12, color: C.muted, marginTop: 6, marginBottom: 10 }}>
          Outstanding balance: {inr(outstanding)}  ·  Balance after payment: {inr(Math.max(0, outstanding - amt))}
        </Txt>
      ) : null}
      <Field label="Amount">
        <Input keyboardType="decimal-pad" value={amount} onChangeText={setAmount} placeholder="₹" />
      </Field>
      {overCap ? <Txt style={{ fontSize: 12, color: C.red, marginBottom: 10 }}>Amount cannot exceed the outstanding balance of {inr(outstanding)}.</Txt> : null}
      {loan && amt > 0 ? <SplitPaymentInput key={loan.id} total={amt} onChange={setPay} /> : null}
      <Field label="Reference">
        <Input placeholder="Optional" value={reference} onChangeText={setReference} />
      </Field>
      <Field label="Description">
        <Input placeholder="Optional" value={description} onChangeText={setDescription} />
      </Field>
      {error ? <Txt style={{ fontSize: 12, color: C.red, marginBottom: 10 }}>{error}</Txt> : null}
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
