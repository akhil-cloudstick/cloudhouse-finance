import React, { useEffect, useState } from "react";
import { Pressable, View } from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import {
  AsyncSelect,
  C,
  Card,
  ChipToggle,
  DashedButton,
  Field,
  FieldGrid,
  FieldRow,
  Input,
  NoticeBanner,
  OrnamentCard,
  PrimaryButton,
  SectionTitle,
  Sheet,
  ThemeDropdown,
  Txt,
  WarningBanner,
} from "../ui";
import { UploadField } from "./UploadField";
import { useAuth } from "../../auth/AuthContext";
import { useDebouncedValue } from "../../hooks/useDebouncedValue";
import { listCustomers } from "../../api/customers";
import { listSchemes } from "../../api/schemes";
import { createLoan, addOrnamentImage, type CreateOrnamentInput } from "../../api/loans";
import { latestGoldRate } from "../../api/goldRates";
import { listOrnamentTypes, createOrnamentType } from "../../api/ornamentTypes";
import { formatPurity, isFinenessInRange, isKaratInRange, rateForPurityString, type PurityUnit } from "../../lib/purity";
import { inr, todayISO } from "../../lib/format";
import { ApiError } from "../../api/client";
import type { Customer } from "../../types/customer";
import type { Scheme } from "../../types/scheme";

// Create New Loan (prototype #loan-modal) — rise-up sheet opened from every
// header's "+" and the dashboard's Create Loan quick action. Same business
// rules as the web NewLoan form: blocked until today's gold rate is
// published, ornament value = net wt × qty × rate for its purity, principal
// capped at the scheme's LTV-eligible amount.
type OrnRow = { name: string; purityUnit: PurityUnit; purityValue: string; grossWeight: string; lessWeight: string; quantity: string; img: string };
const emptyRow: OrnRow = { name: "", purityUnit: "karat", purityValue: "22", grossWeight: "", lessWeight: "", quantity: "1", img: "" };
const KARATS = ["24", "23", "22", "21", "20", "18", "16", "14", "12", "10"];

const netOf = (r: OrnRow) => Math.max(0, (Number(r.grossWeight) || 0) - (Number(r.lessWeight) || 0));
const trim3 = (n: number) => String(+n.toFixed(3));

function rowPurity(r: OrnRow): string | null {
  const n = Number(r.purityValue);
  if (!r.purityValue.trim() || !(n > 0)) return null;
  if (r.purityUnit === "karat" && !isKaratInRange(n)) return null;
  if (r.purityUnit === "fineness" && !isFinenessInRange(n)) return null;
  return formatPurity(r.purityUnit, n);
}

/** Search-or-create against the shared ornament_types catalog. */
function OrnamentTypeField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const qc = useQueryClient();
  const [focused, setFocused] = useState(false);
  const dq = useDebouncedValue(value);
  const results = useQuery({ queryKey: ["ornamentTypes", dq], queryFn: () => listOrnamentTypes(dq || undefined), enabled: focused });
  const create = useMutation({
    mutationFn: (name: string) => createOrnamentType(name),
    onSuccess: (t) => {
      qc.invalidateQueries({ queryKey: ["ornamentTypes"] });
      onChange(t.name);
      setFocused(false);
    },
  });
  const trimmed = value.trim();
  const options = (results.data ?? []).slice(0, 8);
  const exact = options.some((t) => t.name.toLowerCase() === trimmed.toLowerCase());
  return (
    <Field label="Ornament type">
      <Input placeholder="e.g. Gold Chain, Bangle, Ring" value={value} onChangeText={onChange} onFocus={() => setFocused(true)} />
      {focused && (options.length > 0 || (trimmed && !exact)) ? (
        <View style={{ marginTop: 6, backgroundColor: C.card, borderWidth: 1, borderColor: C.line, borderRadius: 12, padding: 6 }}>
          {options.map((t) => (
            <Pressable
              key={t.id}
              style={{ paddingVertical: 9, paddingHorizontal: 10, borderRadius: 8 }}
              onPress={() => {
                onChange(t.name);
                setFocused(false);
              }}
            >
              <Txt style={{ fontSize: 12.5, fontWeight: "600" }}>{t.name}</Txt>
            </Pressable>
          ))}
          {trimmed && !exact ? (
            <Pressable style={{ paddingVertical: 9, paddingHorizontal: 10, borderRadius: 8 }} onPress={() => !create.isPending && create.mutate(trimmed)}>
              <Txt style={{ fontSize: 12.5, fontWeight: "700", color: C.brandDeep }}>{create.isPending ? "Adding…" : `+ Add "${trimmed}"`}</Txt>
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </Field>
  );
}

export function CreateLoanSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const router = useRouter();
  const qc = useQueryClient();
  const { employee, can } = useAuth();
  const canCreate = can("Loan_Management", "can_create_loan");

  const [customer, setCustomer] = useState<Customer | null>(null);
  const [scheme, setScheme] = useState<Scheme | null>(null);
  const [rows, setRows] = useState<OrnRow[]>([{ ...emptyRow }]);
  const [principal, setPrincipal] = useState("");
  const [info, setInfo] = useState("");
  const [error, setError] = useState<string | null>(null);

  const schemes = useQuery({ queryKey: ["schemes", "active-picker"], queryFn: () => listSchemes(), enabled: visible });
  const activeSchemes = (schemes.data ?? []).filter((sc) => sc.isActive !== false);
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
  const canSubmit = canCreate && !!customer && !!scheme && Number(principal) > 0 && valid.length > 0 && isTodaySet && !lessExceeds;

  const reset = () => {
    setCustomer(null);
    setScheme(null);
    setRows([{ ...emptyRow }]);
    setPrincipal("");
    setInfo("");
    setError(null);
  };

  const submit = useMutation({
    mutationFn: () => {
      const due = new Date();
      due.setMonth(due.getMonth() + (scheme?.durationMonths ?? 0));
      const ornaments: CreateOrnamentInput[] = valid.map((r) => ({
        name: r.name.trim(),
        purity: rowPurity(r)!,
        grossWeight: Number(r.grossWeight),
        deductionWeight: Number(r.lessWeight) || 0,
        quantity: r.quantity ? Number(r.quantity) : undefined,
      }));
      return createLoan({
        branchId: employee!.branchId,
        customerId: customer!.id,
        schemeId: scheme!.id,
        openedDate: today,
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
      router.push(`/loans/${loan.id}` as never);
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
      <Field label="Scheme">
        <ThemeDropdown<Scheme> value={scheme} options={activeSchemes} onChange={setScheme} labelOf={schemeLabel} keyOf={(sc) => sc.id} placeholder="Select a scheme" />
      </Field>

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
                {r.purityUnit === "karat" ? (
                  <ThemeDropdown value={r.purityValue} options={KARATS} onChange={(v) => update(i, { purityValue: v })} labelOf={(k) => `${k}K`} />
                ) : (
                  <Input keyboardType="decimal-pad" value={r.purityValue} onChangeText={(v) => update(i, { purityValue: v })} placeholder="91.6" />
                )}
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
