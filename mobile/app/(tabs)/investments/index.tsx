import React, { useEffect, useState } from "react";
import { View } from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AccRow,
  AsyncSelect,
  Buffering,
  BtnRow2,
  C,
  Card,
  ChipToggle,
  EmptyText,
  FabMenu,
  Field,
  FieldGrid,
  FieldRow,
  FilterChipRow,
  FiltersBar,
  FlatHeader,
  Input,
  NoticeBanner,
  PrimaryButton,
  Screen,
  SearchInput,
  SectionTitle,
  ServerFlatList,
  Sheet,
  SheetListItem,
  StatusChip,
  ThemeDropdown,
  Txt,
  toast,
} from "../../../src/components/ui";
import { useServerList } from "../../../src/hooks/useServerList";
import { usePersistedState } from "../../../src/hooks/usePersistedState";
import { useAuth } from "../../../src/auth/AuthContext";
import { listCustomers } from "../../../src/api/customers";
import { ApiError } from "../../../src/api/client";
import {
  addCashToInvestment,
  createInvestment,
  createInvestmentPlan,
  getInvestment,
  getInvestmentSchedulePage,
  getInvestmentTransactionsPage,
  listInvestmentPlans,
  listInvestmentPlansPage,
  listInvestmentsPage,
  markPayoutPaid,
  matureInvestment,
  splitForMode,
  updateInvestmentPlan,
  withdrawFromInvestment,
  type CreatePlanInput,
  type PaymentMode,
} from "../../../src/api/investments";
import { previewInvestmentBondPdf } from "../../../src/utils/investmentBond";
import { dmy, inr } from "../../../src/lib/format";
import type { Customer } from "../../../src/types/customer";
import type {
  Investment,
  InvestmentEngine,
  InvestmentPayout,
  InvestmentPlan,
  InvestmentProductType,
  InvestmentStatus,
  InvestmentTransaction,
  InterestRateType,
  PayoutFrequency,
} from "../../../src/types/investment";
import { isUserCancel, loadErrorText, userMessage } from "../../../src/api/errors";

// Investments — prototype #header-investments + #page-investments and the
// inv-filter / inv-create / investment-plans / inv-plan-create / inv-detail /
// inv-addcash / inv-withdraw / inv-closerenew sheets. Search (INV no.,
// investor name/code) and the status filter are backend params.

const STATUS_FILTERS = ["All", "Active", "Matured", "Closed", "Renewed"] as const;
type StatusFilter = (typeof STATUS_FILTERS)[number];
const PAYMENT_MODES: PaymentMode[] = ["Cash", "UPI", "Bank Transfer", "Cheque"];
const WITHDRAW_FROM = ["Interest", "Principal", "Both"] as const;

type Filters = { status?: InvestmentStatus };

const errMsg = (err: unknown, fallback: string) => userMessage(err, fallback);
const planLabel = (p: InvestmentPlan) => `${p.name} — ${p.interestRatePercent}% · ${p.engine === "Live" ? "Single payout" : p.payoutFrequency} · ${p.tenureMonths}mo`;

export default function InvestmentsScreen() {
  const { can } = useAuth();
  const canCreate = can("Investment_Management", "can_create_investment");
  const canUpdate = can("Investment_Management", "can_update_investment");

  const [status, setStatus] = usePersistedState<StatusFilter>("investments:status", "All");
  const [filterOpen, setFilterOpen] = useState(false);
  const [draft, setDraft] = useState<StatusFilter>("All");

  const [plansOpen, setPlansOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [detailId, setDetailId] = useState<number | null>(null);

  const filters: Filters = { status: status === "All" ? undefined : status };
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
        canCreate || canUpdate ? (
          <FabMenu
            label="Investment actions"
            actions={[
              ...(canCreate ? [{ label: "New Investment", icon: "plus", onPress: () => setCreateOpen(true) }] : []),
              ...(canUpdate ? [{ label: "Plans", icon: "layers", onPress: () => setPlansOpen(true) }] : []),
            ]}
          />
        ) : null
      }
    >
      <ServerFlatList
        list={list}
        items={list.items}
        keyOf={(i) => String(i.id)}
        emptyText={list.search || status !== "All" ? "No investments match your search." : "No investments yet."}
        header={
          <View style={{ paddingTop: 12 }}>
            <SearchInput value={list.search} onChangeText={list.setSearch} placeholder="Search by investment ID or investor name" style={{ paddingBottom: 8 }} />
            <FiltersBar
              count={status !== "All" ? 1 : 0}
              summary={`${status === "All" ? "All investments" : status}${list.total != null ? ` · ${list.total}` : ""}`}
              onPress={() => {
                setDraft(status);
                setFilterOpen(true);
              }}
              style={{ marginTop: 0, marginBottom: 10 }}
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
            actions={[{ label: "View", primary: true, onPress: () => setDetailId(inv.id) }]}
          />
        )}
      />

      <Sheet visible={filterOpen} onClose={() => setFilterOpen(false)} title="Filter Investments" maxHeightPct={55}>
        <Field label="Status">
          <FilterChipRow options={STATUS_FILTERS} value={draft} onChange={setDraft} style={{ flexWrap: "wrap" }} />
        </Field>
        <PrimaryButton
          label="Apply Filters"
          onPress={() => {
            setStatus(draft);
            setFilterOpen(false);
          }}
        />
      </Sheet>

      <PlansSheet visible={plansOpen} onClose={() => setPlansOpen(false)} />
      <CreateInvestmentSheet
        visible={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={(inv) => {
          setCreateOpen(false);
          setDetailId(inv.id);
        }}
      />
      <InvestmentDetailSheet investmentId={detailId} onClose={() => setDetailId(null)} canUpdate={canUpdate} />
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

function PlansSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
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
        <ServerFlatList
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

function PlanFormSheet({ form, setForm }: { form: PlanForm | null; setForm: (f: PlanForm | null) => void }) {
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setError(null), [form?.id, form === null]);

  function validate(f: PlanForm): string | null {
    if (!f.name.trim()) return "Please enter a plan name.";
    const rate = Number(f.interestRatePercent);
    if (f.interestRatePercent.trim() === "" || isNaN(rate) || rate < 0) return "Interest rate must be 0 or more.";
    const tenure = Number(f.tenureMonths);
    if (!tenure || tenure <= 0) return "Tenure must be greater than 0.";
    if (f.engine === "Schedule") {
      const step = FREQ_STEP_MONTHS[f.payoutFrequency] ?? 1;
      if (tenure % step !== 0) return `Tenure months must divide evenly by ${f.payoutFrequency}'s ${step}-month step.`;
    }
    return null;
  }

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
    onError: (err) => setError(errMsg(err, "Could not save the plan — try again.")),
  });

  const f = form;
  return (
    <Sheet visible={!!form} onClose={() => setForm(null)} title={f?.id ? "Edit Investment Plan" : "Add Investment Plan"} maxHeightPct={92}>
      {f ? (
        <>
          <Field label="Plan name">
            <Input placeholder="e.g. Gold Saver Bond" value={f.name} onChangeText={(v) => setForm({ ...f, name: v })} />
          </Field>
          <Field label="Interest rate type">
            <ChipToggle options={["Simple", "Compound"] as const} value={f.interestRateType} onChange={(v) => setForm({ ...f, interestRateType: v })} />
          </Field>
          <Field label="Interest rate (% p.a.)">
            <Input keyboardType="decimal-pad" placeholder="e.g. 9.5" value={f.interestRatePercent} onChangeText={(v) => setForm({ ...f, interestRatePercent: v })} />
          </Field>
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
          <Field label="Status">
            <ChipToggle options={["Active", "Inactive"] as const} value={f.isActive ? "Active" : "Inactive"} onChange={(v) => setForm({ ...f, isActive: v === "Active" })} />
          </Field>
          {error ? <Txt style={{ fontSize: 12, color: C.red, marginBottom: 10 }}>{error}</Txt> : null}
          <PrimaryButton
            label="Save Plan"
            loading={save.isPending}
            onPress={() => {
              const v = validate(f);
              if (v) return setError(v);
              setError(null);
              save.mutate();
            }}
          />
        </>
      ) : null}
    </Sheet>
  );
}

// ---------------------------------------------------------------------------
// Create Investment (prototype #inv-create-modal)
// ---------------------------------------------------------------------------
function CreateInvestmentSheet({ visible, onClose, onCreated }: { visible: boolean; onClose: () => void; onCreated: (inv: Investment) => void }) {
  const qc = useQueryClient();
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [plan, setPlan] = useState<InvestmentPlan | null>(null);
  const [principal, setPrincipal] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (visible) {
      setCustomer(null);
      setPlan(null);
      setPrincipal("");
      setError(null);
    }
  }, [visible]);

  const plans = useQuery({ queryKey: ["investmentPlans", "active"], queryFn: () => listInvestmentPlans(true), enabled: visible });
  const principalNum = +principal || 0;

  const submit = useMutation({
    mutationFn: () => createInvestment({ branchId: customer!.branchId, customerId: customer!.id, planId: plan!.id, principalAmount: principalNum }),
    onSuccess: (inv) => {
      qc.invalidateQueries({ queryKey: ["investments"] });
      onCreated(inv);
    },
    onError: (err) => setError(errMsg(err, "Could not create the investment — try again.")),
  });

  function validate(): string | null {
    if (!customer) return "Please select an investor.";
    if (!plan) return "Please select an investment plan.";
    if (!principalNum || principalNum <= 0) return "Please enter the principal amount.";
    if (principalNum < plan.minPrincipal) return `Principal must be at least ${inr(plan.minPrincipal)} for this plan.`;
    return null;
  }

  return (
    <Sheet visible={visible} onClose={onClose} title="Create Investment" maxHeightPct={88}>
      <AsyncSelect<Customer>
        label="Investor"
        placeholder="Search existing customer by name, ID or phone"
        queryKey={["customers", "picker"]}
        fetcher={(q) => listCustomers(q || undefined)}
        selectedLabel={customer ? `${customer.name} · ${customer.code ?? ""}` : undefined}
        onClear={() => setCustomer(null)}
        onSelect={setCustomer}
        keyOf={(c) => c.id}
        renderItem={(c) => ({ title: c.name, sub: [c.code, c.phone].filter(Boolean).join(" · ") })}
      />
      <Field label="Investment plan">
        {plans.isLoading ? (
          <Buffering />
        ) : (plans.data ?? []).length === 0 ? (
          <Txt style={{ fontSize: 12, color: C.muted }}>No active plans available.</Txt>
        ) : (
          <ThemeDropdown<InvestmentPlan> value={plan} options={plans.data ?? []} onChange={setPlan} labelOf={planLabel} keyOf={(p) => p.id} placeholder="Select a plan" />
        )}
      </Field>
      <Field label="Principal amount">
        <Input keyboardType="decimal-pad" placeholder={plan ? `Min ${inr(plan.minPrincipal)}` : "e.g. 100000"} value={principal} onChangeText={setPrincipal} />
      </Field>
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
      {error ? <Txt style={{ fontSize: 12, color: C.red, marginBottom: 10 }}>{error}</Txt> : null}
      <PrimaryButton
        label="Create Investment"
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
// Detail (prototype #inv-detail-modal) + schedule / transactions (paged)
// ---------------------------------------------------------------------------
function InvestmentDetailSheet({ investmentId, onClose, canUpdate }: { investmentId: number | null; onClose: () => void; canUpdate: boolean }) {
  const qc = useQueryClient();
  const visible = investmentId != null;
  const id = investmentId ?? 0;
  const [action, setAction] = useState<"addCash" | "withdraw" | "mature" | null>(null);
  const [payout, setPayout] = useState<InvestmentPayout | null>(null);
  const [printing, setPrinting] = useState(false);

  const investment = useQuery({ queryKey: ["investment", String(id)], queryFn: () => getInvestment(id), enabled: visible });
  const inv = investment.data;
  const isLive = inv?.engine === "Live";

  const schedule = useServerList<InvestmentPayout>({
    key: ["investmentSchedule", id],
    fetchPage: (p) => getInvestmentSchedulePage(id, p.limit, p.offset),
    enabled: visible && !!inv && !isLive,
  });
  const transactions = useServerList<InvestmentTransaction>({
    key: ["investmentTransactions", id],
    fetchPage: (p) => getInvestmentTransactionsPage(id, p.limit, p.offset),
    enabled: visible && !!inv && isLive,
  });

  useEffect(() => {
    setAction(null);
    setPayout(null);
  }, [investmentId]);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["investment", String(id)] });
    qc.invalidateQueries({ queryKey: ["investmentTransactions", id] });
    qc.invalidateQueries({ queryKey: ["investmentSchedule", id] });
    qc.invalidateQueries({ queryKey: ["investments"] });
  };

  async function printBond() {
    if (!inv) return;
    setPrinting(true);
    try {
      await previewInvestmentBondPdf(inv.id, inv.investmentNumber);
    } catch (e) {
      if (isUserCancel(e)) return;
      toast.error("Preview failed", errMsg(e, "Could not open the agreement."));
    } finally {
      setPrinting(false);
    }
  }

  const title = inv ? `${inv.investmentNumber} — ${inv.customer?.name ?? `Customer #${inv.customerId}`}` : "Investment";

  const header = inv ? (
    <View style={{ paddingHorizontal: 16, paddingTop: 12 }}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
        <Txt style={{ fontSize: 11.5, color: C.muted, fontWeight: "600" }}>Started {dmy(inv.startDate)}</Txt>
        <StatusChip label={inv.status} />
      </View>
      <FieldGrid
        style={{ marginBottom: 16 }}
        items={[
          { k: "Plan", v: inv.plan?.name ?? "—" },
          { k: "Principal", v: inr(inv.principalAmount) },
          { k: "Rate", v: `${inv.interestRatePercent}% p.a. ${inv.interestRateType}` },
          { k: "Maturity", v: dmy(inv.maturityDate) },
          { k: "Tenure", v: `${inv.tenureMonths} months` },
          { k: "Payout", v: isLive ? "Single payout" : inv.payoutFrequency },
          ...(isLive
            ? [
                { k: "Outstanding principal", v: inr(inv.outstandingPrincipal) },
                { k: "Outstanding interest", v: inr(inv.outstandingInterest), color: C.brandDeep },
              ]
            : [{ k: "Interest paid", v: inr(inv.totalInterestPaid), color: C.green }]),
        ]}
      />
      {inv.renewedFromInvestmentId || inv.renewedToInvestmentId ? (
        <NoticeBanner>
          {[
            inv.renewedFromInvestmentId ? `Renewed from Investment #${inv.renewedFromInvestmentId}` : null,
            inv.renewedToInvestmentId ? `Renewed to Investment #${inv.renewedToInvestmentId}` : null,
          ]
            .filter(Boolean)
            .join(" · ")}
        </NoticeBanner>
      ) : null}
      {inv.plan?.productType === "Bond" ? (
        <PrimaryButton label="Print Agreement" variant="outline" loading={printing} onPress={printBond} style={{ marginBottom: 10 }} />
      ) : null}
      {canUpdate && inv.status === "Active" && isLive ? (
        <BtnRow2 style={{ marginBottom: 10 }}>
          <PrimaryButton label="Add Cash" variant="outline" onPress={() => setAction("addCash")} />
          <PrimaryButton label="Withdraw" variant="outline" onPress={() => setAction("withdraw")} />
        </BtnRow2>
      ) : null}
      {canUpdate && inv.status === "Matured" ? <PrimaryButton label="Close / Renew" onPress={() => setAction("mature")} style={{ marginBottom: 10 }} /> : null}
      <SectionTitle flush style={{ marginTop: 8 }}>
        {isLive ? "Transactions" : "Interest payout schedule"}
      </SectionTitle>
    </View>
  ) : null;

  let body: React.ReactNode = null;
  if (!visible) body = null;
  else if (investment.isLoading) body = <Buffering block />;
  else if (investment.isError || !inv) body = <EmptyText>{loadErrorText(investment.error) ?? "This investment no longer exists."}</EmptyText>;
  else if (isLive)
    body = (
      <ServerFlatList
        list={transactions}
        items={transactions.items}
        inSheet
        gutter={16}
        header={header}
        emptyText="No transactions yet."
        keyOf={(t) => String(t.id)}
        renderItem={(t) => (
          <AccRow
            id={t.type}
            idColor={t.type === "Withdrawal" ? C.red : C.green}
            name={dmy(t.occurredOn)}
            sub={t.reference || undefined}
            amount={`${t.type === "Withdrawal" ? "−" : "+"}${inr(t.amount)}`}
            amountColor={t.type === "Withdrawal" ? C.red : C.green}
            details={[
              { k: "Principal", v: inr(t.principalAmount) },
              { k: "Interest", v: inr(t.interestAmount) },
              { k: "Principal after", v: inr(t.principalAfter) },
              { k: "Interest after", v: inr(t.interestAfter) },
            ]}
          />
        )}
      />
    );
  else
    body = (
      <ServerFlatList
        list={schedule}
        items={schedule.items}
        inSheet
        gutter={16}
        header={header}
        emptyText="No payouts scheduled."
        keyOf={(p) => String(p.id)}
        renderItem={(p) => (
          <AccRow
            id={`#${p.sequenceNo}`}
            name={dmy(p.dueDate)}
            sub={p.isPrincipalReturn ? "Principal return" : "Interest payout"}
            amount={inr(p.amount)}
            status={p.status}
            details={[
              { k: "Due date", v: dmy(p.dueDate) },
              { k: "Paid on", v: p.paidAt ? dmy(p.paidAt) : "—" },
            ]}
            actions={canUpdate && p.status === "Pending" ? [{ label: "Mark Paid", primary: true, onPress: () => setPayout(p) }] : undefined}
          />
        )}
      />
    );

  return (
    <>
      <Sheet visible={visible} onClose={onClose} title={title} maxHeightPct={85} scroll={false}>
        <View style={{ flexShrink: 1 }}>{body}</View>
      </Sheet>
      {inv ? (
        <>
          <AddCashSheet inv={inv} visible={action === "addCash"} onClose={() => setAction(null)} onDone={invalidate} />
          <WithdrawSheet inv={inv} visible={action === "withdraw"} onClose={() => setAction(null)} onDone={invalidate} />
          <CloseRenewSheet inv={inv} visible={action === "mature"} onClose={() => setAction(null)} onDone={invalidate} />
          <MarkPaidSheet inv={inv} payout={payout} onClose={() => setPayout(null)} onDone={invalidate} />
        </>
      ) : null}
    </>
  );
}

type ActionProps = { inv: Investment; visible: boolean; onClose: () => void; onDone: () => void };

function ModeField({ value, onChange }: { value: PaymentMode; onChange: (m: PaymentMode) => void }) {
  return (
    <Field label="Mode">
      <ThemeDropdown<PaymentMode> value={value} options={PAYMENT_MODES} onChange={onChange} labelOf={(m) => m} keyOf={(m) => m} />
    </Field>
  );
}

// prototype #inv-addcash-modal
function AddCashSheet({ inv, visible, onClose, onDone }: ActionProps) {
  const [amount, setAmount] = useState("");
  const [mode, setMode] = useState<PaymentMode>("Cash");
  const [reference, setReference] = useState("");
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (visible) {
      setAmount("");
      setMode("Cash");
      setReference("");
      setError(null);
    }
  }, [visible]);
  const m = useMutation({
    mutationFn: () => addCashToInvestment(inv.id, { amount: Number(amount), reference: reference.trim() || undefined, ...splitForMode(mode, Number(amount)) }),
    onSuccess: () => {
      onDone();
      onClose();
    },
    onError: (err) => setError(errMsg(err, "Could not add cash — try again.")),
  });
  return (
    <Sheet visible={visible} onClose={onClose} title={`Add Cash — ${inv.investmentNumber}`} maxHeightPct={60}>
      <Txt style={{ fontSize: 12, color: C.muted, marginTop: 6, marginBottom: 10 }}>Current outstanding principal: {inr(inv.outstandingPrincipal)}</Txt>
      <Field label="Amount">
        <Input keyboardType="decimal-pad" placeholder="₹" value={amount} onChangeText={setAmount} />
      </Field>
      <ModeField value={mode} onChange={setMode} />
      <Field label="Reference">
        <Input placeholder="Optional" value={reference} onChangeText={setReference} />
      </Field>
      {error ? <Txt style={{ fontSize: 12, color: C.red, marginBottom: 10 }}>{error}</Txt> : null}
      <PrimaryButton label="Add Cash" onPress={() => m.mutate()} loading={m.isPending} disabled={!amount || Number(amount) <= 0} />
    </Sheet>
  );
}

// prototype #inv-withdraw-modal
function WithdrawSheet({ inv, visible, onClose, onDone }: ActionProps) {
  const [from, setFrom] = useState<(typeof WITHDRAW_FROM)[number]>("Interest");
  const [interest, setInterest] = useState("");
  const [principal, setPrincipal] = useState("");
  const [mode, setMode] = useState<PaymentMode>("Cash");
  const [reference, setReference] = useState("");
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (visible) {
      setFrom("Interest");
      setInterest("");
      setPrincipal("");
      setMode("Cash");
      setReference("");
      setError(null);
    }
  }, [visible]);
  const interestAmount = from === "Principal" ? 0 : Number(interest || 0);
  const principalAmount = from === "Interest" ? 0 : Number(principal || 0);
  const m = useMutation({
    mutationFn: () =>
      withdrawFromInvestment(inv.id, { interestAmount, principalAmount, reference: reference.trim() || undefined, ...splitForMode(mode, interestAmount + principalAmount) }),
    onSuccess: () => {
      onDone();
      onClose();
    },
    onError: (err) => setError(errMsg(err, "Could not withdraw — try again.")),
  });
  return (
    <Sheet visible={visible} onClose={onClose} title={`Withdraw — ${inv.investmentNumber}`} maxHeightPct={65}>
      <Txt style={{ fontSize: 12, color: C.muted, marginTop: 6, marginBottom: 10 }}>
        Outstanding principal: {inr(inv.outstandingPrincipal)} · Outstanding interest: {inr(inv.outstandingInterest)}
      </Txt>
      <Field label="Withdraw from">
        <ChipToggle options={WITHDRAW_FROM} value={from} onChange={setFrom} />
      </Field>
      {from !== "Principal" ? (
        <Field label="Interest amount">
          <Input keyboardType="decimal-pad" placeholder="₹" value={interest} onChangeText={setInterest} />
        </Field>
      ) : null}
      {from !== "Interest" ? (
        <Field label="Principal amount">
          <Input keyboardType="decimal-pad" placeholder="₹" value={principal} onChangeText={setPrincipal} />
        </Field>
      ) : null}
      <ModeField value={mode} onChange={setMode} />
      <Field label="Reference">
        <Input placeholder="Optional" value={reference} onChangeText={setReference} />
      </Field>
      {error ? <Txt style={{ fontSize: 12, color: C.red, marginBottom: 10 }}>{error}</Txt> : null}
      <PrimaryButton label="Confirm Withdrawal" onPress={() => m.mutate()} loading={m.isPending} disabled={interestAmount + principalAmount <= 0} />
    </Sheet>
  );
}

// prototype #inv-closerenew-modal
function CloseRenewSheet({ inv, visible, onClose, onDone }: ActionProps) {
  const [act, setAct] = useState<"Close" | "Renew">("Close");
  const [plan, setPlan] = useState<InvestmentPlan | null>(null);
  const [principal, setPrincipal] = useState("");
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (visible) {
      setAct("Close");
      setPlan(null);
      setPrincipal("");
      setError(null);
    }
  }, [visible]);
  const plans = useQuery({ queryKey: ["investmentPlans", "active"], queryFn: () => listInvestmentPlans(true), enabled: visible && act === "Renew" });
  const m = useMutation({
    mutationFn: () =>
      matureInvestment(inv.id, {
        action: act,
        planId: act === "Renew" ? plan?.id : undefined,
        principalAmount: act === "Renew" ? Number(principal || 0) : undefined,
      }),
    onSuccess: () => {
      onDone();
      onClose();
    },
    onError: (err) => setError(errMsg(err, "Could not apply the maturity decision — try again.")),
  });
  return (
    <Sheet visible={visible} onClose={onClose} title={`Close / Renew — ${inv.investmentNumber}`} maxHeightPct={60}>
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
      {error ? <Txt style={{ fontSize: 12, color: C.red, marginBottom: 10 }}>{error}</Txt> : null}
      <PrimaryButton label="Confirm" onPress={() => m.mutate()} loading={m.isPending} disabled={act === "Renew" && (!plan || !principal)} />
    </Sheet>
  );
}

// Mark a scheduled payout paid — picks the payment mode for the full amount.
function MarkPaidSheet({ inv, payout, onClose, onDone }: { inv: Investment; payout: InvestmentPayout | null; onClose: () => void; onDone: () => void }) {
  const [mode, setMode] = useState<PaymentMode>("Cash");
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (payout) {
      setMode("Cash");
      setError(null);
    }
  }, [payout]);
  const m = useMutation({
    mutationFn: () => markPayoutPaid(inv.id, payout!.id, splitForMode(mode, payout!.amount)),
    onSuccess: () => {
      onDone();
      onClose();
    },
    onError: (err) => setError(errMsg(err, "Could not mark the payout paid — try again.")),
  });
  return (
    <Sheet visible={!!payout} onClose={onClose} title={`Mark Payout Paid — #${payout?.sequenceNo ?? ""}`} maxHeightPct={55}>
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
      <ModeField value={mode} onChange={setMode} />
      {error ? <Txt style={{ fontSize: 12, color: C.red, marginBottom: 10 }}>{error}</Txt> : null}
      <PrimaryButton label="Mark Paid" onPress={() => m.mutate()} loading={m.isPending} />
    </Sheet>
  );
}
