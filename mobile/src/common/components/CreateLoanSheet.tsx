import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AsyncSelect,
  C,
  Card,
  ChipToggle,
  ComboInput,
  DashedButton,
  DateField,
  Field,
  FieldGrid,
  FieldRow,
  Input,
  MenuItem,
  NoticeBanner,
  OrnamentCard,
  PrimaryButton,
  SectionTitle,
  Sheet,
  Txt,
  WarningBanner,
  openPage,
} from "@/common/components/ui";
import { UploadField } from "./UploadField";
import { useAuth } from "@/common/providers/AuthProvider";
import { listCustomers } from "@/modules/customers/services/customerService";
import { listBranchesPage } from "@/modules/branches/services/branchService";
import { listLockersPage } from "@/modules/lockers/services/lockerService";
import { listActiveSchemes } from "@/modules/schemes/services/schemeService";
import { createLoan, addOrnamentImage } from "@/modules/loans/services/loanService";
import { type CreateOrnamentInput } from "@/modules/loans/types/loan-types";
import { latestGoldRate } from "@/modules/gold-rates/services/goldRateService";
import { formatPurity, isFinenessInRange, isKaratInRange, rateForPurityString, type PurityUnit } from "@/common/utils/purity";
import { inr, todayISO } from "@/common/utils/format";
import { ApiError } from "@/common/services/httpClient";
import type { Customer } from "@/modules/customers/types/customer-types";
import type { Scheme } from "@/modules/schemes/types/scheme-types";
import type { Locker } from "@/modules/lockers/types/locker-types";
import { OrnamentTypeField } from "./OrnamentTypeField";

// Create New Loan (prototype #loan-modal) — rise-up sheet opened from the
// Loans page "+" and the dashboard's Create Loan quick action. Same business
// rules as the web NewLoan form: blocked until today's gold rate is
// published, ornament value = net wt × qty × rate for its purity, principal
// capped at the scheme's LTV-eligible amount.
type OrnRow = { name: string; purityUnit: PurityUnit; purityValue: string; grossWeight: string; lessWeight: string; quantity: string; img: string };
const emptyRow: OrnRow = { name: "", purityUnit: "karat", purityValue: "22", grossWeight: "", lessWeight: "", quantity: "1", img: "" };
const KARATS = ["24", "23", "22", "21", "20", "18", "16", "14", "12", "10"];
const FINENESS = ["99.9", "99.5", "91.6", "87.5", "83.3", "75", "58.5", "41.7"];

type PurityInputProps = { unit: PurityUnit; value: string; onChange: (v: string) => void };

/** Karat / fineness entry: type any value, or pick a standard one. */
function PurityInput({ unit, value, onChange }: PurityInputProps) {
  const opts = unit === "karat" ? KARATS : FINENESS;
  return (
    <ComboInput
      value={value}
      onChangeText={(v) => onChange(v.replace(/[^0-9.]/g, ""))}
      keyboardType="decimal-pad"
      placeholder={unit === "karat" ? "22" : "91.6"}
      menu={(close) => (
        <>
          {opts.map((o) => (
            <MenuItem
              key={o}
              title={unit === "karat" ? `${o}K` : `${o}%`}
              selected={o === value}
              onPress={() => {
                onChange(o);
                close();
              }}
            />
          ))}
        </>
      )}
    />
  );
}

const netOf = (r: OrnRow) => Math.max(0, (Number(r.grossWeight) || 0) - (Number(r.lessWeight) || 0));
const trim3 = (n: number) => String(+n.toFixed(3));

function rowPurity(r: OrnRow): string | null {
  const n = Number(r.purityValue);
  if (!r.purityValue.trim() || !(n > 0)) return null;
  if (r.purityUnit === "karat" && !isKaratInRange(n)) return null;
  if (r.purityUnit === "fineness" && !isFinenessInRange(n)) return null;
  return formatPurity(r.purityUnit, n);
}

type CreateLoanSheetProps = { visible: boolean; onClose: () => void };

export function CreateLoanSheet({ visible, onClose }: CreateLoanSheetProps) {
  const qc = useQueryClient();
  const { employee, can } = useAuth();
  const canCreate = can("Loan_Management", "can_create_loan");
  // Only a cross-branch user picks another branch — everyone else books into
  // their own (the backend enforces this too, overriding branchId).
  const canPickBranch = can("Branch_Management", "can_view_all_branches");
  const ownBranch = employee ? { id: employee.branchId, name: employee.branch?.name ?? "Your branch" } : null;

  const [customer, setCustomer] = useState<Customer | null>(null);
  const [scheme, setScheme] = useState<Scheme | null>(null);
  const [branch, setBranch] = useState<{ id: number; name: string } | null>(ownBranch);
  const [locker, setLocker] = useState<Locker | null>(null);
  const [rows, setRows] = useState<OrnRow[]>([{ ...emptyRow }]);
  const [principal, setPrincipal] = useState("");
  const [info, setInfo] = useState("");
  // Loan (opened) date — same rule as the web NewLoan form: defaults to
  // today, may be backdated but never set in the future (the DateField's max
  // blocks it; the backend re-checks). Interest accrues from this date and
  // the due date is derived from it.
  const [openedDate, setOpenedDate] = useState(todayISO());
  const [error, setError] = useState<string | null>(null);

  const goldRate = useQuery({ queryKey: ["gold-rates", "latest"], queryFn: latestGoldRate, enabled: visible, refetchOnMount: "always" });

  useEffect(() => {
    if (!visible) return;
    setError(null);
  }, [visible]);

  const today = todayISO();
  const isTodaySet = !!goldRate.data?.date && goldRate.data.date.slice(0, 10) === today;
  const k24 = goldRate.data?.k24 ?? 0;

  const update = (i: number, patch: Partial<OrnRow>) => setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  const valueOf = (r: OrnRow) => {
    const p = rowPurity(r);
    const rate = p ? rateForPurityString(k24, p) : null;
    return rate == null ? 0 : netOf(r) * (Number(r.quantity) || 1) * rate;
  };
  const valid = rows.filter((r) => r.name.trim() && rowPurity(r) && Number(r.grossWeight) > 0 && netOf(r) > 0);
  const lessExceeds = rows.some((r) => Number(r.lessWeight) > Number(r.grossWeight));
  const totalNet = valid.reduce((sum, r) => sum + netOf(r) * (Number(r.quantity) || 1), 0);
  const goldValue = valid.reduce((sum, r) => sum + valueOf(r), 0);
  const eligible = scheme ? Math.round((goldValue * scheme.ltvPercent) / 100) : 0;
  const overEligible = !!scheme && valid.length > 0 && Number(principal) > eligible;
  const canSubmit = canCreate && !!openedDate && openedDate <= today && !!branch && !!customer && !!scheme && Number(principal) > 0 && valid.length > 0 && isTodaySet && !lessExceeds;

  const reset = () => {
    setCustomer(null);
    setScheme(null);
    setBranch(ownBranch);
    setLocker(null);
    setRows([{ ...emptyRow }]);
    setPrincipal("");
    setInfo("");
    setOpenedDate(todayISO());
    setError(null);
  };

  const submit = useMutation({
    mutationFn: () => {
      const [oy, om, od] = openedDate.split("-").map(Number);
      const due = new Date(oy, om - 1, od);
      due.setMonth(due.getMonth() + (scheme?.durationMonths ?? 0));
      const ornaments: CreateOrnamentInput[] = valid.map((r) => ({
        name: r.name.trim(),
        purity: rowPurity(r)!,
        grossWeight: Number(r.grossWeight),
        deductionWeight: Number(r.lessWeight) || 0,
        quantity: r.quantity ? Number(r.quantity) : undefined,
      }));
      return createLoan({
        branchId: branch!.id,
        ...(locker ? { lockerId: locker.id } : {}),
        customerId: customer!.id,
        schemeId: scheme!.id,
        openedDate,
        dueDate: `${due.getFullYear()}-${String(due.getMonth() + 1).padStart(2, "0")}-${String(due.getDate()).padStart(2, "0")}`,
        principalAmount: Number(principal),
        ornaments,
        ...(info.trim() ? { additionalInfo: info.trim() } : {}),
      });
    },
    onSuccess: async (loan) => {
      // Link each photographed row to the ornament created for it (returned
      // in submission order). Best-effort — the loan already exists.
      const created = loan.ornaments ?? [];
      await Promise.all(valid.map((r, i) => (r.img && created[i] ? addOrnamentImage(created[i].id, r.img).catch(() => undefined) : Promise.resolve())));
      qc.invalidateQueries({ queryKey: ["loans"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      reset();
      onClose();
      openPage(`/loans/${loan.id}`);
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Could not create loan."),
  });

  const schemeLabel = (sc: Scheme) => `${sc.name} — ${sc.interestRate}% · ${sc.durationMonths}mo · LTV ${sc.ltvPercent}%`;

  return (
    <Sheet visible={visible} onClose={onClose} title="Create New Loan" maxHeightPct={80}>
      {!canCreate ? (
        <NoticeBanner>You don&apos;t have permission to create a loan. Contact a Loan Operator, Branch Manager, or Administrator.</NoticeBanner>
      ) : null}
      {canCreate && goldRate.data !== undefined && !isTodaySet ? (
        <WarningBanner>Today&apos;s gold rate hasn&apos;t been published yet — loan creation is blocked until it is. Set it from the dashboard gold rate.</WarningBanner>
      ) : null}

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
      <AsyncSelect<Scheme>
        label="Scheme"
        placeholder="Search active schemes"
        queryKey={["schemes", "active"]}
        fetcher={(q) => listActiveSchemes(q || undefined)}
        selectedLabel={scheme ? schemeLabel(scheme) : undefined}
        onClear={() => setScheme(null)}
        onSelect={setScheme}
        keyOf={(sc) => sc.id}
        renderItem={(sc) => ({ title: sc.name, sub: `${sc.interestRate}% · ${sc.durationMonths}mo · LTV ${sc.ltvPercent}%` })}
      />

      {canPickBranch ? (
        <AsyncSelect<{ id: number; name: string; code?: string }>
          label="Branch"
          placeholder="Search branch"
          queryKey={["branches", "loan-picker"]}
          fetcher={async (q) => (await listBranchesPage({ q: q || undefined, active: true, limit: 20, offset: 0 })).items ?? []}
          selectedLabel={branch?.name}
          onSelect={(b) => {
            setBranch({ id: b.id, name: b.name });
            if (locker && locker.branchId !== b.id) setLocker(null);
          }}
          keyOf={(b) => b.id}
          renderItem={(b) => ({ title: b.name, sub: b.code })}
        />
      ) : (
        <Field label="Branch">
          <Input value={branch?.name ?? ""} editable={false} />
        </Field>
      )}
      <AsyncSelect<Locker>
        label="Locker (optional)"
        placeholder="Assign later, or search locker code"
        queryKey={["lockers", "loan-picker", branch?.id]}
        fetcher={async (q) => (await listLockersPage({ branchId: branch?.id, status: "active", q: q || undefined, limit: 20, offset: 0 })).items ?? []}
        selectedLabel={locker ? `${locker.code} (${locker.occupied}/${locker.capacity} packets)` : undefined}
        onClear={() => setLocker(null)}
        onSelect={setLocker}
        keyOf={(l) => l.id}
        renderItem={(l) => ({ title: `${l.code} (${l.occupied}/${l.capacity} packets)`, sub: l.branch?.name })}
      />

      <SectionTitle flush style={{ marginTop: 16 }}>
        Ornaments
      </SectionTitle>

      {rows.map((r, i) => {
        const bad = Number(r.lessWeight) > Number(r.grossWeight);
        return (
          <OrnamentCard key={i} title={`Ornament ${i + 1}`} onRemove={rows.length > 1 ? () => setRows((p) => p.filter((_, x) => x !== i)) : undefined}>
            <OrnamentTypeField value={r.name} onChange={(v) => update(i, { name: v })} />
            <Field label="Purity unit">
              <ChipToggle
                options={["karat", "fineness"] as const}
                labels={{ karat: "Karat", fineness: "Fineness" }}
                value={r.purityUnit}
                onChange={(u) => update(i, { purityUnit: u, purityValue: u === "karat" ? "22" : "91.6" })}
              />
            </Field>
            <FieldRow>
              <Field label={r.purityUnit === "karat" ? "Karat" : "Fineness %"}>
                <PurityInput key={r.purityUnit} unit={r.purityUnit} value={r.purityValue} onChange={(v) => update(i, { purityValue: v })} />
              </Field>
              <Field label="Quantity">
                <Input keyboardType="number-pad" value={r.quantity} onChangeText={(v) => update(i, { quantity: v })} />
              </Field>
            </FieldRow>
            <FieldRow>
              <Field label="Gross Wt (g)">
                <Input keyboardType="decimal-pad" placeholder="0.0" value={r.grossWeight} onChangeText={(v) => update(i, { grossWeight: v })} />
              </Field>
              <Field label="Less Wt (g)">
                <Input keyboardType="decimal-pad" placeholder="0.0" value={r.lessWeight} onChangeText={(v) => update(i, { lessWeight: v })} style={bad ? { borderColor: C.red } : undefined} />
              </Field>
            </FieldRow>
            {bad ? <Txt style={{ fontSize: 11, color: C.red, marginTop: -6, marginBottom: 8 }}>Less Wt cannot be greater than Gross Wt</Txt> : null}
            <Field label="Net Wt (g)">
              <Input value={r.grossWeight ? trim3(netOf(r)) : ""} editable={false} placeholder="Auto" />
            </Field>
            <UploadField label="Ornament photo" value={r.img} onChange={(url) => update(i, { img: url })} allowPdf={false} />
          </OrnamentCard>
        );
      })}

      <DashedButton label="Add Ornament" onPress={() => setRows((p) => [...p, { ...emptyRow }])} />

      <Card style={{ marginHorizontal: 0, marginBottom: 14, padding: 14 }}>
        <FieldGrid
          items={[
            { k: "Total Net Wt", v: `${+totalNet.toFixed(2)} g` },
            { k: "Gold Value", v: inr(Math.round(goldValue)) },
            { k: "LTV", v: scheme ? `${scheme.ltvPercent}%` : "—" },
            { k: "Eligible Amount", v: inr(eligible), color: C.brandDeep },
          ]}
        />
      </Card>

      <DateField label="Loan date" value={openedDate} onChange={setOpenedDate} max={today} />
      <Field label="Principal amount">
        <Input keyboardType="number-pad" placeholder={eligible ? inr(eligible) : "₹"} value={principal} onChangeText={setPrincipal} />
      </Field>
      {overEligible ? <Txt style={{ fontSize: 11, color: C.red, marginTop: -6, marginBottom: 10 }}>Principal is above the eligible amount of {inr(eligible)}.</Txt> : null}
      {scheme && scheme.serviceChargeType && scheme.serviceChargeType !== "None"
        ? (() => {
            const p = +principal || eligible || 0;
            const charge = scheme.serviceChargeType === "Flat" ? scheme.serviceChargeValue ?? 0 : (p * (scheme.serviceChargeValue ?? 0)) / 100;
            const withheld = scheme.serviceChargeMode === "WithheldFromPayout";
            return (
              <Txt style={{ fontSize: 11, color: C.muted, marginTop: -6, marginBottom: 10 }}>
                Service charge {inr(charge)}{" "}
                {withheld ? `withheld from payout — customer receives ${inr(Math.max(0, p - charge))}.` : `added to principal — customer owes ${inr(p + charge)}.`}
              </Txt>
            );
          })()
        : null}
      <Field label="Additional information">
        <Input placeholder="Optional notes" value={info} onChangeText={setInfo} multiline />
      </Field>
      {error ? <Txt style={{ fontSize: 12, color: C.red, marginBottom: 10 }}>{error}</Txt> : null}
      <PrimaryButton label="Confirm & Create Loan" onPress={() => submit.mutate()} loading={submit.isPending} disabled={!canSubmit} />
    </Sheet>
  );
}
