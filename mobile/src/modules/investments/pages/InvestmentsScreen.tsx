import React, { useEffect, useState } from "react";
import { View } from "react-native";
import { useRouter } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AccRow, AsyncSelect, Buffering, C, Card, DateField, ChipToggle, FabMenu, Field, FieldGrid, FieldRow, FlatHeader, GroupedFilter, emptyGroupedFilter, gfValues, gfDate, type GFSection, type GroupedFilterValue, Input, PrimaryButton, Screen, SearchFilterRow, SearchInput,ServerFlatList, Sheet, SheetListItem, StatusChip, ThemeDropdown, Txt, toast } from "@/common/components/ui";
import { useServerList } from "@/common/hooks/use-server-list";
import { usePersistedState } from "@/common/hooks/use-persisted-state";
import { useAuth } from "@/common/providers/AuthProvider";
import { listInvestorsPage } from "@/modules/investments/services/investorService";
import { addCashToInvestment, createInvestment, editInvestment, createInvestmentPlan, listInvestmentPlans, listInvestmentPlansPage, deleteInvestmentPlan, listInvestmentsPage, markPayoutPaid, matureInvestment, updateInvestmentPlan, withdrawFromInvestment, getPendingInterest, payInterestMonths } from "@/modules/investments/services/investmentService";
import { type CreatePlanInput, type PaymentMode, type Investment, type InvestmentEngine, type InvestmentPayout, type InvestmentPlan, type InvestmentProductType, type InterestRateType, type PayoutFrequency } from "@/modules/investments/types/investment-types";
import { SplitPaymentInput, type SplitPayment } from "@/common/components/SplitPaymentInput";
import { dmy, inr, todayISO } from "@/common/utils/format";
import type { Customer } from "@/modules/customers/types/customer-types";
import { FieldErr } from "@/common/components/ErrorText";
import { userMessage } from "@/common/services/apiErrors";

// Investments — prototype #header-investments + #page-investments and the
// inv-filter / inv-create / investment-plans / inv-plan-create / inv-detail /
// inv-addcash / inv-withdraw / inv-closerenew sheets. Search (INV no.,
// investor name/code) and the status filter are backend params.

// Any number of statuses can be ticked; none ticked means all investments.
const STATUS_FILTERS = ["Active", "Matured", "Closed", "Renewed"] as const;
const PAYMENT_MODES: PaymentMode[] = ["Cash", "UPI", "Bank Transfer", "Cheque"];
const WITHDRAW_FROM = ["Interest", "Principal", "Both"] as const;

// Comma-separated list of statuses (the server accepts one or several).
type Filters = { status?: string; customerIds?: string; plan_ids?: string; from?: string; to?: string };

const errMsg = (err: unknown, fallback: string) => userMessage(err, fallback);
const planLabel = (p: InvestmentPlan) => `${p.name} — ${p.interestRatePercent}% · ${p.engine === "Live" ? "Single payout" : p.payoutFrequency} · ${p.tenureMonths}mo`;

export default function InvestmentsScreen() {
  const router = useRouter();
  const { can } = useAuth();
  const canCreate = can("Investment_Management", "can_create_investment");
  const canUpdate = can("Investment_Management", "can_update_investment");

  // Status, Investor, Plan and a start-date range — same filters as web.
  const [fv, setFv] = usePersistedState<GroupedFilterValue>("investments:filters", emptyGroupedFilter());
  const statuses = gfValues(fv, "status");
  const investorIds = gfValues(fv, "investor");
  const planIds = gfValues(fv, "plan");
  const dates = gfDate(fv, "start");
  const sections: GFSection[] = [
    { kind: "static", key: "status", label: "Status", options: STATUS_FILTERS.map((s) => ({ value: s, label: s })) },
    {
      kind: "async",
      key: "investor",
      label: "Investor",
      fetchPage: (p) => listInvestorsPage({ q: p.q, limit: p.limit, offset: p.offset }).then((r) => ({ items: r.items.map((c) => ({ value: String(c.id), label: c.code ? `${c.name} (${c.code})` : c.name })), hasMore: r.hasMore })),
    },
    {
      kind: "async",
      key: "plan",
      label: "Plan",
      fetchPage: (p) => listInvestmentPlansPage({ q: p.q, limit: p.limit, offset: p.offset }).then((r) => ({ items: (r.items ?? []).map((x) => ({ value: String(x.id), label: x.name })), hasMore: r.hasMore })),
    },
    { kind: "date", key: "start", label: "Start date" },
  ];

  const [plansOpen, setPlansOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);

  const filters: Filters = {
    status: statuses.length ? statuses.join(",") : undefined,
    customerIds: investorIds.length ? investorIds.join(",") : undefined,
    plan_ids: planIds.length ? planIds.join(",") : undefined,
    from: dates.from || undefined,
    to: dates.to || undefined,
  };
  const anyFilter = statuses.length + investorIds.length + planIds.length > 0 || !!dates.from || !!dates.to;
  const list = useServerList<Investment, Filters>({ key: ["investments", "list"], persistKey: "investments", filters, fetchPage: (p) => listInvestmentsPage(p) });

  return (
    <Screen
      header={
        <FlatHeader
          title="Investments"
          subtitle="Deposits, plans & payouts"
        />
      }
      floating={
        // One corner button that opens upward into both actions.
        (
          <FabMenu
            label="Investment actions"
            actions={[
              { label: "Investors", icon: "user", onPress: () => router.push("/investments/investors" as never) },
              ...(canCreate ? [{ label: "New Investment", icon: "plus", onPress: () => setCreateOpen(true) }] : []),
              ...(canUpdate ? [{ label: "Plans", icon: "layers", onPress: () => setPlansOpen(true) }] : []),
            ]}
          />
        )
      }
    >
      <ServerFlatList stickyHeader
        list={list}
        items={list.items}
        keyOf={(i) => String(i.id)}
        emptyText={list.search || anyFilter ? "No investments match your search." : "No investments yet."}
        header={
          <View style={{ paddingTop: 12 }}>
            <SearchFilterRow
              value={list.search}
              onChangeText={list.setSearch}
              placeholder="Search by investment ID or investor name"
              filter={
                <GroupedFilter title="Filter Investments" sections={sections} value={fv} onChange={setFv} />
              }
            />
          </View>
        }
        renderItem={(inv, i) => (
          <AccRow
            defaultOpen={i === 0}
            id={inv.investmentNumber}
            name={inv.customer?.name ?? `Customer #${inv.customerId}`}
            sub={inv.plan?.name}
            amount={inr(inv.principalAmount)}
            status={inv.status}
            details={[
              { k: "Rate", v: `${inv.interestRatePercent}% p.a. · ${inv.interestRateType}` },
              { k: "Maturity date", v: dmy(inv.maturityDate) },
            ]}
            actions={[{ label: "View", primary: true, onPress: () => router.push(`/investments/${inv.id}` as never) }]}
          />
        )}
      />

      <PlansSheet visible={plansOpen} onClose={() => setPlansOpen(false)} />
      <CreateInvestmentSheet
        visible={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={(inv) => {
          setCreateOpen(false);
          router.push(`/investments/${inv.id}` as never);
        }}
      />
    </Screen>
  );
}

// ---------------------------------------------------------------------------
// Investment Plans (prototype #investment-plans-modal) + Add/Edit Plan
// ---------------------------------------------------------------------------
const FIXED_PAYOUT_FREQUENCIES = ["Monthly", "Quarterly", "Yearly"] as const;
const FREQ_STEP_MONTHS: Record<string, number> = { Monthly: 1, Quarterly: 3, Yearly: 12 };

type PlanForm = {
  id: number | null;
  name: string;
  productType: InvestmentProductType;
  interestRateType: InterestRateType;
  interestRatePercent: string;
  engine: InvestmentEngine;
  payoutFrequency: PayoutFrequency;
  tenureMonths: string;
  minPrincipal: string;
  isActive: boolean;
};

const BLANK_PLAN: PlanForm = {
  id: null,
  name: "",
  productType: "Bond",
  interestRateType: "Simple",
  interestRatePercent: "",
  engine: "Schedule",
  payoutFrequency: "Monthly",
  tenureMonths: "",
  minPrincipal: "",
  isActive: true,
};

type PlansSheetProps = { visible: boolean; onClose: () => void };

function PlansSheet({ visible, onClose }: PlansSheetProps) {
  const canCreatePlan = useAuth().can("Investment_Management", "can_create_investment");
  const [form, setForm] = useState<PlanForm | null>(null);
  const list = useServerList<InvestmentPlan>({
    key: ["investmentPlans", "page"],
    fetchPage: (p) => listInvestmentPlansPage(p),
    enabled: visible,
  });

  return (
    <>
      <Sheet
        visible={visible}
        onClose={onClose}
        title="Investment Plans"
        maxHeightPct={80}
        scroll={false}
        headExtra={
          <View style={{ paddingTop: 12 }}>
            <SearchInput value={list.search} onChangeText={list.setSearch} placeholder="Search plans by name" style={{ paddingHorizontal: 16 }} />
          </View>
        }
      >
        <ServerFlatList stickyHeader
          list={list}
          items={list.items}
          inSheet
          gutter={16}
          emptyText={list.search ? "No plans match your search." : "No plans yet."}
          keyOf={(p) => String(p.id)}
          renderItem={(p, i) => (
            <SheetListItem
              first={i === 0}
              icon="layers"
              title={p.name}
              right={<StatusChip label={p.isActive ? "Active" : "Inactive"} tone={p.isActive ? "active" : "closed"} />}
              sub={`${p.interestRatePercent}% ${p.interestRateType} · ${p.engine === "Live" ? "Single payout" : `${p.payoutFrequency} payout`} · ${p.tenureMonths}mo · Min ${inr(p.minPrincipal)}`}
              onPress={() =>
                setForm({
                  id: p.id,
                  name: p.name,
                  productType: p.productType,
                  interestRateType: p.interestRateType,
                  interestRatePercent: String(p.interestRatePercent),
                  engine: p.engine,
                  payoutFrequency: p.engine === "Schedule" ? p.payoutFrequency : "Monthly",
                  tenureMonths: String(p.tenureMonths),
                  minPrincipal: String(p.minPrincipal),
                  isActive: p.isActive,
                })
              }
            />
          )}
        />
        {canCreatePlan ? (
          <View style={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: 16 }}>
            <PrimaryButton label="+ Add Plan" onPress={() => setForm({ ...BLANK_PLAN })} />
          </View>
        ) : null}
      </Sheet>
      <PlanFormSheet form={form} setForm={setForm} />
    </>
  );
}

type PlanFormSheetProps = { form: PlanForm | null; setForm: (f: PlanForm | null) => void };

function PlanFormSheet({ form, setForm }: PlanFormSheetProps) {
  const qc = useQueryClient();
  const [tried, setTried] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  const canDeletePlan = useAuth().can("Investment_Management", "can_delete_investment");
  useEffect(() => { setTried(false); setConfirmDel(false); }, [form?.id, form === null]);

  const planErrs = (f: PlanForm | null): Record<string, string> => {
    const e: Record<string, string> = {};
    if (!f) return e;
    if (!f.name.trim()) e.name = "Enter a plan name.";
    const rate = Number(f.interestRatePercent);
    if (f.interestRatePercent.trim() === "" || isNaN(rate) || rate < 0) e.rate = "Interest rate must be 0 or more.";
    const tenure = Number(f.tenureMonths);
    if (!tenure || tenure <= 0) e.tenure = "Tenure must be greater than 0.";
    else if (f.engine === "Schedule") {
      const step = FREQ_STEP_MONTHS[f.payoutFrequency] ?? 1;
      if (tenure % step !== 0) e.tenure = `Tenure months must divide evenly by ${f.payoutFrequency}'s ${step}-month step.`;
    }
    return e;
  };

    const save = useMutation({
    mutationFn: () => {
      const f = form!;
      const input: CreatePlanInput = {
        name: f.name.trim(),
        productType: f.productType,
        interestRateType: f.interestRateType,
        interestRatePercent: Number(f.interestRatePercent),
        payoutFrequency: f.engine === "Schedule" ? f.payoutFrequency : "Monthly",
        tenureMonths: Number(f.tenureMonths),
        minPrincipal: Number(f.minPrincipal || 0),
        isActive: f.isActive,
        engine: f.engine,
      };
      return f.id ? updateInvestmentPlan(f.id, input) : createInvestmentPlan(input);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["investmentPlans"] });
      setForm(null);
    },
    onError: (err) => toast.error(errMsg(err, "Could not save the plan — try again.")),
  });

  const del = useMutation({
    mutationFn: () => deleteInvestmentPlan(form!.id!),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["investmentPlans"] });
      setForm(null);
    },
    onError: (err) => {
      setConfirmDel(false);
      toast.error(errMsg(err, "Could not delete the plan — try again."));
    },
  });

  const f = form;
  const pe = planErrs(f);
  const fe = (k: string) => (tried ? pe[k] : undefined);
  return (
    <Sheet visible={!!form} onClose={() => setForm(null)} title={f?.id ? "Edit Investment Plan" : "Add Investment Plan"} maxHeightPct={92}>
      {f ? (
        <>
          <Field label="Plan name">
            <Input placeholder="e.g. Gold Saver Bond" value={f.name} onChangeText={(v) => setForm({ ...f, name: v })} />
          </Field>
          <FieldErr m={fe("name")} />
          <Field label="Interest rate type">
            <ChipToggle options={["Simple", "Compound"] as const} value={f.interestRateType} onChange={(v) => setForm({ ...f, interestRateType: v })} />
          </Field>
          <Field label="Interest rate (% p.a.)">
            <Input keyboardType="decimal-pad" placeholder="e.g. 9.5" value={f.interestRatePercent} onChangeText={(v) => setForm({ ...f, interestRatePercent: v })} />
          </Field>
          <FieldErr m={fe("rate")} />
          <Field label="Payout engine">
            <ChipToggle
              options={["Schedule", "Live"] as const}
              labels={{ Schedule: "Fixed Payout", Live: "Single Payout" }}
              value={f.engine}
              onChange={(v) => setForm({ ...f, engine: v, payoutFrequency: "Monthly" })}
            />
          </Field>
          {f.engine === "Schedule" ? (
            <Field label="Payout frequency">
              <ChipToggle
                options={FIXED_PAYOUT_FREQUENCIES}
                value={f.payoutFrequency as (typeof FIXED_PAYOUT_FREQUENCIES)[number]}
                onChange={(v) => setForm({ ...f, payoutFrequency: v })}
              />
            </Field>
          ) : null}
          <FieldRow>
            <Field label="Tenure (months)">
              <Input keyboardType="number-pad" placeholder="e.g. 12" value={f.tenureMonths} onChangeText={(v) => setForm({ ...f, tenureMonths: v })} />
            </Field>
            <Field label="Minimum principal (₹)">
              <Input keyboardType="decimal-pad" placeholder="e.g. 25000" value={f.minPrincipal} onChangeText={(v) => setForm({ ...f, minPrincipal: v })} />
            </Field>
          </FieldRow>
          <FieldErr m={fe("tenure")} />
          <Field label="Status">
            <ChipToggle options={["Active", "Inactive"] as const} value={f.isActive ? "Active" : "Inactive"} onChange={(v) => setForm({ ...f, isActive: v === "Active" })} />
          </Field>
          {f.id && canDeletePlan ? (
            <>
              {confirmDel ? <Txt style={{ fontSize: 12, color: C.muted, marginBottom: 8 }}>Delete the plan {f.name}? A plan already used by an investment can&apos;t be deleted — mark it inactive instead.</Txt> : null}
              <PrimaryButton
                label={confirmDel ? "Tap again to delete plan" : "Delete Plan"}
                variant="reject"
                style={{ marginBottom: 10 }}
                loading={del.isPending}
                onPress={() => (confirmDel ? del.mutate() : setConfirmDel(true))}
              />
            </>
          ) : null}
          <PrimaryButton
            label="Save Plan"
            loading={save.isPending}
            onPress={() => {
              if (Object.keys(pe).length) return setTried(true);
              save.mutate();
            }}
          />
        </>
      ) : null}
    </Sheet>
  );
}

// `investment` set: corrects that investment (only before any interest or payout) instead of opening a new one.
type CreateInvestmentSheetProps = { presetCustomer?: Customer | null; visible: boolean; onClose: () => void; onCreated: (inv: Investment) => void; investment?: Investment | null };

// ---------------------------------------------------------------------------
// Create Investment (prototype #inv-create-modal)
// ---------------------------------------------------------------------------
export function CreateInvestmentSheet({ presetCustomer, visible, onClose, onCreated, investment }: CreateInvestmentSheetProps) {
  const qc = useQueryClient();
  const editing = !!investment;
  const [startDate, setStartDate] = useState("");
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [plan, setPlan] = useState<InvestmentPlan | null>(null);
  const [principal, setPrincipal] = useState("");
  const [pay, setPay] = useState<SplitPayment | null>(null);
  const [tried, setTried] = useState(false);

  useEffect(() => {
    if (visible) {
      setCustomer(presetCustomer ?? null);
      setPlan(investment?.plan ?? null);
      setPrincipal(investment ? String(investment.principalAmount) : "");
      setStartDate(investment ? investment.startDate.slice(0, 10) : "");
      setTried(false);
    }
  }, [visible, investment, presetCustomer]);

  const plans = useQuery({ queryKey: ["investmentPlans", "active"], queryFn: () => listInvestmentPlans(true), enabled: visible });
  const principalNum = +principal || 0;
  // Editing keeps how the deposit was paid unless the amount changes (then a new breakdown is needed).
  const amountChanged = !!investment && Math.abs(principalNum - investment.principalAmount) >= 0.005;
  // The investment's own plan stays choosable even if it has since been switched off.
  const planOptions = investment && !(plans.data ?? []).some((p) => p.id === investment.planId) ? [investment.plan, ...(plans.data ?? [])] : (plans.data ?? []);

  const submit = useMutation({
    mutationFn: () => investment
      ? editInvestment(investment.id, { planId: plan!.id, principalAmount: principalNum, startDate: startDate || undefined, ...(amountChanged ? { ...(pay?.split ?? {}), bankId: pay?.bankId } : {}) })
      : createInvestment({ branchId: customer!.branchId, customerId: customer!.id, planId: plan!.id, principalAmount: principalNum, ...(pay?.split ?? {}), bankId: pay?.bankId }),
    onSuccess: (inv) => {
      qc.invalidateQueries({ queryKey: ["investments"] });
      if (editing) {
        qc.invalidateQueries({ queryKey: ["investment"] });
        qc.invalidateQueries({ queryKey: ["investmentSchedule"] });
        qc.invalidateQueries({ queryKey: ["investmentLedger"] });
        toast.success("Investment updated", `${inv.investmentNumber} — saved`);
      }
      onCreated(inv);
    },
    onError: (err) => toast.error(errMsg(err, "Could not create the investment — try again.")),
  });

  const errs: Record<string, string> = {};
  if (!editing && !customer) errs.customer = "Select an investor.";
  if (!plan) errs.plan = "Select an investment plan.";
  if (!principalNum || principalNum <= 0) errs.principal = "Enter the principal amount.";
  else if (plan && principalNum < plan.minPrincipal) errs.principal = `Principal must be at least ${inr(plan.minPrincipal)} for this plan.`;
  if ((!editing || amountChanged) && !pay?.ready) errs.pay = "The payment breakdown must add up to the principal, with a bank for every UPI / Bank Transfer line.";
  const fe = (k: string) => (tried ? errs[k] : undefined);

  return (
    <Sheet visible={visible} onClose={onClose} title={investment ? `Edit ${investment.investmentNumber}` : "Create Investment"} maxHeightPct={88}>
      {investment ? (
        <Field label="Investor">
          <Input value={`${investment.customer.name} · ${investment.customer.code}`} editable={false} />
        </Field>
      ) : (
      <AsyncSelect<Customer>
        label="Investor"
        placeholder="Search investor by name, ID or phone"
        queryKey={["investors", "picker"]}
        fetcher={async (q) => (await listInvestorsPage({ q: q || undefined, limit: 20, offset: 0 })).items ?? []}
        selectedLabel={customer ? `${customer.name} · ${customer.code ?? ""}` : undefined}
        onClear={() => setCustomer(null)}
        onSelect={setCustomer}
        keyOf={(c) => c.id}
        renderItem={(c) => ({ title: c.name, sub: [c.code, c.phone].filter(Boolean).join(" · ") })}
      />
      )}
      <FieldErr m={fe("customer")} />
      <Field label="Investment plan">
        {plans.isLoading ? (
          <Buffering />
        ) : (plans.data ?? []).length === 0 ? (
          <Txt style={{ fontSize: 12, color: C.muted }}>No active plans available.</Txt>
        ) : (
          <ThemeDropdown<InvestmentPlan> value={plan} options={planOptions} onChange={setPlan} labelOf={planLabel} keyOf={(p) => p.id} placeholder="Select a plan" />
        )}
      </Field>
      <FieldErr m={fe("plan")} />
      <Field label="Principal amount">
        <Input keyboardType="decimal-pad" placeholder={plan ? `Min ${inr(plan.minPrincipal)}` : "e.g. 100000"} value={principal} onChangeText={setPrincipal} />
      </Field>
      <FieldErr m={fe("principal")} />
      {editing ? (
        <Field label="Start date">
          <DateField value={startDate} max={todayISO()} onChange={setStartDate} />
        </Field>
      ) : null}
      {!editing || amountChanged ? <SplitPaymentInput total={principalNum} onChange={setPay} bankLabel="Bank (account it landed in)" /> : null}
      <FieldErr m={fe("pay")} />
      <Card style={{ marginHorizontal: 0, marginBottom: 14 }}>
        <FieldGrid
          items={[
            { k: "Rate", v: plan ? `${plan.interestRatePercent}% p.a.` : "—" },
            { k: "Payout", v: plan ? (plan.engine === "Live" ? "Single payout" : plan.payoutFrequency) : "—" },
            { k: "Tenure", v: plan ? `${plan.tenureMonths} months` : "—" },
            { k: "Principal deposited", v: inr(principalNum) },
          ]}
        />
      </Card>
      <PrimaryButton
        label={editing ? "Save Changes" : "Create Investment"}
        loading={submit.isPending}
        onPress={() => {
          if (Object.keys(errs).length) return setTried(true);
          submit.mutate();
        }}
      />
    </Sheet>
  );
}

type ActionProps = { inv: Investment; visible: boolean; onClose: () => void; onDone: () => void };

type ModeFieldProps = { value: PaymentMode; onChange: (m: PaymentMode) => void };

function ModeField({ value, onChange }: ModeFieldProps) {
  return (
    <Field label="Mode">
      <ThemeDropdown<PaymentMode> value={value} options={PAYMENT_MODES} onChange={onChange} labelOf={(m) => m} keyOf={(m) => m} />
    </Field>
  );
}

// prototype #inv-addcash-modal
export function AddCashSheet({ inv, visible, onClose, onDone }: ActionProps) {
  const [amount, setAmount] = useState("");
  const [pay, setPay] = useState<SplitPayment | null>(null);
  const [reference, setReference] = useState("");
  useEffect(() => {
    if (visible) {
      setAmount("");
      setReference("");
    }
  }, [visible]);
  const m = useMutation({
    mutationFn: () => addCashToInvestment(inv.id, { amount: Number(amount), reference: reference.trim() || undefined, ...(pay?.split ?? {}), bankId: pay?.bankId } as Parameters<typeof addCashToInvestment>[1]),
    onSuccess: () => {
      onDone();
      onClose();
    },
    onError: (err) => toast.error(errMsg(err, "Could not add cash — try again.")),
  });
  return (
    <Sheet visible={visible} onClose={onClose} title={`Add Cash — ${inv.investmentNumber}`} maxHeightPct={88}>
      <Txt style={{ fontSize: 12, color: C.muted, marginTop: 6, marginBottom: 10 }}>Current outstanding principal: {inr(inv.outstandingPrincipal)}</Txt>
      <Field label="Amount">
        <Input keyboardType="decimal-pad" placeholder="₹" value={amount} onChangeText={setAmount} />
      </Field>
      <SplitPaymentInput total={Number(amount) || 0} onChange={setPay} />
      <Field label="Reference">
        <Input maxLength={150} placeholder="Optional (max 150 characters)" value={reference} onChangeText={setReference} />
      </Field>
      <PrimaryButton label="Add Cash" onPress={() => m.mutate()} loading={m.isPending} disabled={!amount || Number(amount) <= 0 || !pay?.ready} />
    </Sheet>
  );
}

// prototype #inv-withdraw-modal
export function WithdrawSheet({ inv, visible, onClose, onDone }: ActionProps) {
  const [from, setFrom] = useState<(typeof WITHDRAW_FROM)[number]>("Interest");
  const [interest, setInterest] = useState("");
  const [principal, setPrincipal] = useState("");
  const [pay, setPay] = useState<SplitPayment | null>(null);
  const [reference, setReference] = useState("");
  useEffect(() => {
    if (visible) {
      setFrom("Interest");
      setInterest("");
      setPrincipal("");
      setReference("");
    }
  }, [visible]);
  const interestAmount = from === "Principal" ? 0 : Number(interest || 0);
  const principalAmount = from === "Interest" ? 0 : Number(principal || 0);
  const overInterest = interestAmount > (inv.outstandingInterest || 0) + 0.01;
  const overPrincipal = principalAmount > (inv.outstandingPrincipal || 0) + 0.01;
  const m =useMutation({
    mutationFn: () =>
      withdrawFromInvestment(inv.id, { interestAmount, principalAmount, reference: reference.trim() || undefined, ...(pay?.split ?? {}), bankId: pay?.bankId } as Parameters<typeof withdrawFromInvestment>[1]),
    onSuccess: () => {
      onDone();
      onClose();
    },
    onError: (err) => toast.error(errMsg(err, "Could not withdraw — try again.")),
  });
  return (
    <Sheet visible={visible} onClose={onClose} title={`Withdraw — ${inv.investmentNumber}`} maxHeightPct={90}>
      <Txt style={{ fontSize: 12, color: C.muted, marginTop: 6, marginBottom: 10 }}>
        Outstanding principal: {inr(inv.outstandingPrincipal)} · Outstanding interest: {inr(inv.outstandingInterest)}
      </Txt>
      <Field label="Withdraw from">
        <ChipToggle options={WITHDRAW_FROM} value={from} onChange={setFrom} />
      </Field>
      {from !== "Principal" ? (
        <Field label="Interest amount">
          <Input keyboardType="decimal-pad" placeholder="₹" value={interest} onChangeText={setInterest} />
          {overInterest ? <Txt style={{ fontSize: 12, color: C.red, marginTop: 4 }}>Exceeds the outstanding interest ({inr(inv.outstandingInterest)}).</Txt> : null}
        </Field>
      ) : null}
      {from !== "Interest" ? (
        <Field label="Principal amount">
          <Input keyboardType="decimal-pad" placeholder="₹" value={principal} onChangeText={setPrincipal} />
          {overPrincipal ? <Txt style={{ fontSize: 12, color: C.red, marginTop: 4 }}>Exceeds the outstanding principal ({inr(inv.outstandingPrincipal)}).</Txt> : null}
        </Field>
      ) : null}
      <SplitPaymentInput total={interestAmount + principalAmount} onChange={setPay} />
      <Field label="Reference">
        <Input maxLength={150} placeholder="Optional (max 150 characters)" value={reference} onChangeText={setReference} />
      </Field>
      <PrimaryButton label="Confirm Withdrawal" onPress={() => m.mutate()} loading={m.isPending} disabled={interestAmount + principalAmount <= 0 || overInterest || overPrincipal || !pay?.ready} />
    </Sheet>
  );
}

// prototype #inv-closerenew-modal
export function CloseRenewSheet({ inv, visible, onClose, onDone }: ActionProps) {
  const [act, setAct] = useState<"Close" | "Renew">("Close");
  const [plan, setPlan] = useState<InvestmentPlan | null>(null);
  const [principal, setPrincipal] = useState("");
  const [pay, setPay] = useState<SplitPayment | null>(null);
  // A Live investment pays principal plus interest out on Close.
  // A scheduled one owes the principal it still holds plus the settlement interest (same as web).
  const payable =
    inv.engine === "Live"
      ? (inv.outstandingPrincipal || 0) + (inv.outstandingInterest || 0)
      : Math.max(0, inv.principalAmount - (inv.principalReturned || 0)) + (inv.settlementInterest || 0);
  const needsPayout = act === "Close" && (inv.engine === "Live" || payable > 0);
  useEffect(() => {
    if (visible) {
      setAct("Close");
      setPlan(null);
      setPrincipal(inv.outstandingPrincipal ? String(inv.outstandingPrincipal) : "");
    }
  }, [visible]);
  const plans = useQuery({ queryKey: ["investmentPlans", "active"], queryFn: () => listInvestmentPlans(true), enabled: visible && act === "Renew" });
  const m = useMutation({
    mutationFn: () =>
      matureInvestment(inv.id, {
        action: act,
        planId: act === "Renew" ? plan?.id : undefined,
        principalAmount: act === "Renew" ? Number(principal || 0) : undefined,
        ...(needsPayout ? { ...(pay?.split ?? {}), bankId: pay?.bankId } : {}),
      }),
    onSuccess: () => {
      onDone();
      onClose();
    },
    onError: (err) => toast.error(errMsg(err, "Could not apply the maturity decision — try again.")),
  });
  return (
    <Sheet visible={visible} onClose={onClose} title={`Close / Renew — ${inv.investmentNumber}`} maxHeightPct={90}>
      <Field label="Action" style={{ marginTop: 6 }}>
        <ChipToggle options={["Close", "Renew"] as const} value={act} onChange={setAct} />
      </Field>
      {act === "Renew" ? (
        <Field label="Renew into plan">
          {plans.isLoading ? (
            <Buffering />
          ) : (
            <ThemeDropdown<InvestmentPlan> value={plan} options={plans.data ?? []} onChange={setPlan} labelOf={planLabel} keyOf={(p) => p.id} placeholder="Select a plan" />
          )}
        </Field>
      ) : null}
      <Field label="New principal amount (renew only)">
        <Input keyboardType="decimal-pad" placeholder="₹" value={principal} onChangeText={setPrincipal} editable={act === "Renew"} />
      </Field>
      {needsPayout ? <SplitPaymentInput total={payable} onChange={setPay} bankLabel="Bank (account it is paid from)" /> : null}
      <PrimaryButton label="Confirm" onPress={() => m.mutate()} loading={m.isPending} disabled={(act === "Renew" && (!plan || !principal)) || (needsPayout && !pay?.ready)} />
    </Sheet>
  );
}

type PayInterestSheetProps = { inv: Investment; visible: boolean; onClose: () => void; onDone: () => void };

// Pay several months of a scheduled investment's interest in one go — the amount is applied to the oldest
// unpaid months in order, each in full, so it has to be a whole number of months (same as web).
export function PayInterestSheet({ inv, visible, onClose, onDone }: PayInterestSheetProps) {
  const [amount, setAmount] = useState("");
  const [pay, setPay] = useState<SplitPayment | null>(null);
  const pending = useQuery({ queryKey: ["investmentPendingInterest", inv.id], queryFn: () => getPendingInterest(inv.id), enabled: visible, staleTime: 0 });
  const months = pending.data ?? [];
  useEffect(() => {
    if (visible) {
      setAmount("");
    }
  }, [visible]);
  // Start from the oldest unpaid month once the list arrives.
  useEffect(() => {
    if (visible && months.length) setAmount((cur) => cur || String(months[0].amount));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, pending.data]);

  const amt = Number(amount) || 0;
  // How many whole months the typed amount covers (a part-month is not allowed).
  let covered = 0;
  let sum = 0;
  for (const mth of months) {
    if (sum + mth.amount > amt + 0.01) break;
    sum = Math.round((sum + mth.amount) * 100) / 100;
    covered++;
  }
  const exact = amt > 0 && covered > 0 && Math.abs(sum - amt) < 0.01;
  const total = Math.round(months.reduce((s, mth) => s + mth.amount, 0) * 100) / 100;
  const m = useMutation({
    mutationFn: () => payInterestMonths(inv.id, { amount: amt, ...(pay?.split ?? { cashAmount: 0, upiAmount: 0, bankTransferAmount: 0, chequeAmount: 0 }), bankId: pay?.bankId }),
    onSuccess: (paid) => {
      toast.success(`${paid.length} month${paid.length === 1 ? "" : "s"} of interest paid`, inr(amt));
      onDone();
      onClose();
    },
    onError: (err) => toast.error(errMsg(err, "Could not record the interest payment — try again.")),
  });
  return (
    <Sheet visible={visible} onClose={onClose} title={`Pay Interest — ${inv.investmentNumber}`} maxHeightPct={90}>
      {pending.isLoading ? (
        <Buffering block />
      ) : months.length === 0 ? (
        <Txt style={{ fontSize: 13, color: C.muted, marginVertical: 12 }}>There is no unpaid interest on this investment.</Txt>
      ) : (
        <>
          <Txt style={{ fontSize: 12.5, color: C.muted, marginTop: 6, marginBottom: 10 }}>
            {months.length} unpaid month{months.length === 1 ? "" : "s"} · {inr(total)} in all
          </Txt>
          <Field label="Amount (₹) *">
            <Input keyboardType="decimal-pad" placeholder="₹" value={amount} onChangeText={setAmount} />
          </Field>
          <Txt style={{ fontSize: 12.5, color: exact ? C.green : C.muted, marginBottom: 10 }}>
            {amt > 0 && covered > 0
              ? `Covers ${covered} month${covered === 1 ? "" : "s"}: #${months[0].sequenceNo}${covered > 1 ? `–#${months[covered - 1].sequenceNo}` : ""} (due ${dmy(months[0].dueDate)}${covered > 1 ? ` – ${dmy(months[covered - 1].dueDate)}` : ""})`
              : amt > 0
                ? `Less than the next month's interest of ${inr(months[0].amount)}`
                : "Enter the amount to see the months it covers"}
          </Txt>
          {amt > 0 && covered > 0 && !exact ? <Txt style={{ fontSize: 12, color: C.red, marginBottom: 10 }}>Not whole months — {inr(sum)} covers {covered}.</Txt> : null}
          <SplitPaymentInput total={amt} onChange={setPay} bankLabel="Bank (account it is paid from)" />
          <PrimaryButton label="Pay Interest" onPress={() => m.mutate()} loading={m.isPending} disabled={!exact || !pay?.ready} />
        </>
      )}
    </Sheet>
  );
}

type MarkPaidSheetProps = { inv: Investment; payout: InvestmentPayout | null; onClose: () => void; onDone: () => void };

// Mark a scheduled payout paid — picks the payment mode for the full amount.
export function MarkPaidSheet({ inv, payout, onClose, onDone }: MarkPaidSheetProps) {
  const [pay, setPay] = useState<SplitPayment | null>(null);
  useEffect(() => {
    if (payout) {
    }
  }, [payout]);
  const m = useMutation({
    mutationFn: () => markPayoutPaid(inv.id, payout!.id, pay!.split, pay!.bankId),
    onSuccess: () => {
      onDone();
      onClose();
    },
    onError: (err) => toast.error(errMsg(err, "Could not mark the payout paid — try again.")),
  });
  return (
    <Sheet visible={!!payout} onClose={onClose} title={`Mark Payout Paid — #${payout?.sequenceNo ?? ""}`} maxHeightPct={88}>
      {payout ? (
        <Card style={{ marginHorizontal: 0, marginTop: 6, marginBottom: 14 }}>
          <FieldGrid
            items={[
              { k: "Due date", v: dmy(payout.dueDate) },
              { k: "Amount", v: inr(payout.amount), color: C.brandDeep },
            ]}
          />
        </Card>
      ) : null}
      {payout ? <SplitPaymentInput total={payout.amount} onChange={setPay} /> : null}
      <PrimaryButton label="Mark Paid" onPress={() => m.mutate()} loading={m.isPending} disabled={!pay?.ready} />
    </Sheet>
  );
}
