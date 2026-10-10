import { useEffect, useState } from "react";
import { View } from "react-native";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { C, ChipToggle, Field, FieldRow, Input, PrimaryButton, Sheet, ThemeDropdown, Txt } from "@/common/components/ui";
import { useAuth } from "@/common/providers/AuthProvider";
import { createScheme, toggleSchemeActive, updateScheme } from "@/modules/schemes/services/schemeService";
import { type SchemeInput, type Scheme, type ServiceChargeMode, type ServiceChargeType } from "@/modules/schemes/types/scheme-types";
import { ApiError } from "@/common/services/httpClient";

// ---------------------------------------------------------------------------
// Scheme create / edit (prototype #scheme-create-modal). Same fields, wire
// values and validation as the old schemes/new.tsx + schemes/[id].tsx edit
// sheet (web SchemeModal.tsx): interest method is stored as the full text,
// service charge None/Flat/Percent + WithheldFromPayout/AddedToPrincipal.
// ---------------------------------------------------------------------------

const METHODS = ["Monthly simple interest", "Flat monthly", "Quarterly simple", "Compound monthly"] as const;
type Method = (typeof METHODS)[number];
const METHOD_LABELS: Record<Method, string> = {
  "Monthly simple interest": "Monthly simple",
  "Flat monthly": "Flat monthly",
  "Quarterly simple": "Quarterly simple",
  "Compound monthly": "Compound monthly",
};
const CHARGE_TYPES = ["None", "Flat", "Percent"] as const satisfies readonly ServiceChargeType[];
const CHARGE_TYPE_LABELS: Record<ServiceChargeType, string> = { None: "None", Flat: "Flat amount", Percent: "Percentage" };
const CHARGE_MODES = ["WithheldFromPayout", "AddedToPrincipal"] as const satisfies readonly ServiceChargeMode[];
const CHARGE_MODE_LABELS: Record<ServiceChargeMode, string> = { WithheldFromPayout: "Withhold from payout", AddedToPrincipal: "Add to principal" };
const STATUSES = ["Active", "Inactive"] as const;

export const num = (t: string) => t.replace(/[^0-9.]/g, "");

type SchemeSheetProps = { visible: boolean; onClose: () => void; scheme?: Scheme | null };

export function SchemeSheet({ visible, onClose, scheme }: SchemeSheetProps) {
  const qc = useQueryClient();
  const { employee } = useAuth();
  const editing = !!scheme;

  const [name, setName] = useState("");
  const [interestRate, setInterestRate] = useState("");
  const [durationMonths, setDurationMonths] = useState("");
  const [ltvPercent, setLtvPercent] = useState("");
  const [method, setMethod] = useState<Method>(METHODS[0]);
  const [penalRate, setPenalRate] = useState("");
  const [conditions, setConditions] = useState("");
  // New schemes default to Active (web SchemeModal parity; backend defaults false).
  const [status, setStatus] = useState<(typeof STATUSES)[number]>("Active");
  const [chargeType, setChargeType] = useState<ServiceChargeType>("None");
  const [chargeValue, setChargeValue] = useState("");
  const [chargeMode, setChargeMode] = useState<ServiceChargeMode>("WithheldFromPayout");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    const sc = scheme;
    setName(sc?.name ?? "");
    setInterestRate(sc ? String(sc.interestRate) : "");
    setDurationMonths(sc ? String(sc.durationMonths) : "");
    setLtvPercent(sc ? String(sc.ltvPercent) : "");
    setMethod(sc && (METHODS as readonly string[]).includes(sc.interestMethod ?? "") ? (sc.interestMethod as Method) : METHODS[0]);
    setPenalRate(sc?.penalRate != null ? String(sc.penalRate) : "");
    setConditions(sc?.conditions ?? "");
    setStatus(!sc || sc.isActive ? "Active" : "Inactive");
    const ct = sc?.serviceChargeType && sc.serviceChargeType !== "None" ? sc.serviceChargeType : "None";
    setChargeType(ct);
    setChargeValue(ct !== "None" ? String(sc?.serviceChargeValue ?? "") : "");
    setChargeMode(sc?.serviceChargeMode === "AddedToPrincipal" ? "AddedToPrincipal" : "WithheldFromPayout");
    setError(null);
  }, [visible, scheme]);

  const save = useMutation({
    mutationFn: async () => {
      const input: SchemeInput = {
        name,
        branchId: scheme ? scheme.branchId : employee!.branchId,
        interestRate: Number(interestRate),
        durationMonths: Number(durationMonths),
        ltvPercent: Number(ltvPercent),
        interestMethod: method,
        penalRate: penalRate ? Number(penalRate) : undefined,
        conditions: conditions.trim() || undefined,
        // Edit keeps the stored flag in the PUT and flips it through the
        // dedicated toggle endpoint below (same as the old detail screen).
        isActive: scheme ? scheme.isActive : status === "Active",
        serviceChargeType: chargeType,
        serviceChargeValue: chargeType === "None" ? 0 : Number(chargeValue),
        serviceChargeMode: chargeType === "None" ? undefined : chargeMode,
      };
      if (!scheme) return createScheme(input);
      const saved = await updateScheme(scheme.id, input);
      if ((status === "Active") !== scheme.isActive) return toggleSchemeActive(scheme.id);
      return saved;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["schemes"] });
      if (scheme) qc.invalidateQueries({ queryKey: ["scheme", String(scheme.id)] });
      onClose();
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Could not save."),
  });

  const chargeSet = chargeType !== "None";
  return (
    <Sheet visible={visible} onClose={onClose} title={editing ? "Edit Scheme" : "Scheme"} maxHeightPct={92}>
      <Field label="Name">
        <Input placeholder="e.g. Gold Plus" value={name} onChangeText={setName} />
      </Field>
      <FieldRow>
        <Field label="Interest rate (% p.a.)">
          <Input placeholder="e.g. 14.4" keyboardType="decimal-pad" value={interestRate} onChangeText={(t) => setInterestRate(num(t))} />
        </Field>
        <Field label="Duration (months)">
          <Input placeholder="e.g. 6" keyboardType="number-pad" value={durationMonths} onChangeText={(t) => setDurationMonths(t.replace(/\D/g, ""))} />
        </Field>
      </FieldRow>
      <Field label="LTV (%)">
        <Input placeholder="e.g. 75" keyboardType="decimal-pad" value={ltvPercent} onChangeText={(t) => setLtvPercent(num(t))} />
      </Field>
      <Field label="Interest calculation method">
        <ThemeDropdown<Method> value={method} options={[...METHODS]} onChange={setMethod} labelOf={(m) => METHOD_LABELS[m]} />
      </Field>
      <Field label="Penal charges (%/month)">
        <Input placeholder="e.g. 2.0" keyboardType="decimal-pad" value={penalRate} onChangeText={(t) => setPenalRate(num(t))} />
      </Field>
      <Field label="Applicable conditions">
        <Input placeholder="Free text, e.g. KYC requirements" value={conditions} onChangeText={setConditions} />
      </Field>
      <Field label="Status">
        <ChipToggle options={STATUSES} value={status} onChange={setStatus} />
      </Field>
      <Field label="Service charge">
        <ChipToggle options={CHARGE_TYPES} value={chargeType} onChange={setChargeType} labels={CHARGE_TYPE_LABELS} wrap />
      </Field>
      <Field label={chargeType === "Flat" ? "Charge amount (₹)" : chargeType === "Percent" ? "Charge (% of principal)" : "Charge amount / percentage"}>
        <Input
          placeholder={chargeType === "Flat" ? "e.g. 500" : chargeType === "Percent" ? "e.g. 2" : "Only if service charge is set"}
          keyboardType="decimal-pad"
          editable={chargeSet}
          value={chargeValue}
          onChangeText={(t) => setChargeValue(num(t))}
        />
      </Field>
      <Field label="How charge is collected">
        <View style={!chargeSet ? { opacity: 0.5 } : null} pointerEvents={chargeSet ? "auto" : "none"}>
          <ChipToggle options={CHARGE_MODES} value={chargeMode} onChange={setChargeMode} labels={CHARGE_MODE_LABELS} />
        </View>
      </Field>
      {error ? <Txt style={{ fontSize: 12, color: C.red, marginBottom: 10 }}>{error}</Txt> : null}
      <PrimaryButton
        label="Save Scheme"
        onPress={() => save.mutate()}
        loading={save.isPending}
        disabled={!name || !interestRate || !durationMonths || !ltvPercent || (chargeSet && !chargeValue)}
      />
    </Sheet>
  );
}
