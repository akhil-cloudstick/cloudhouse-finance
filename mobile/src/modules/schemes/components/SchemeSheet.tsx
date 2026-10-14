import { useEffect, useState } from "react";
import { Pressable, View } from "react-native";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { C, ChipToggle, Field, FieldRow, Input, PrimaryButton, Sheet, ThemeDropdown, Txt } from "@/common/components/ui";
import { useAuth } from "@/common/providers/AuthProvider";
import { BranchField, useOwnBranch } from "@/modules/cash/components/EntryFormParts";
import { createScheme, toggleSchemeActive, updateScheme } from "@/modules/schemes/services/schemeService";
import { type SchemeInput, type Scheme, type ServiceChargeMode, type ServiceChargeType } from "@/modules/schemes/types/scheme-types";
import { ApiError } from "@/common/services/httpClient";

// ---------------------------------------------------------------------------
// Scheme create / edit (prototype #scheme-create-modal). Same fields, wire
// values and validation as the old schemes/new.tsx + schemes/[id].tsx edit
// sheet (web SchemeModal.tsx): interest method is stored as the full text,
// service charge None/Flat/Percent + WithheldFromPayout/AddedToPrincipal.
// ---------------------------------------------------------------------------

const METHODS = ["Monthly simple interest", "Flat monthly", "Quarterly simple", "Compound monthly", "Multiple interest"] as const;
type Method = (typeof METHODS)[number];
const METHOD_LABELS: Record<Method, string> = {
  "Monthly simple interest": "Monthly simple",
  "Flat monthly": "Flat monthly",
  "Quarterly simple": "Quarterly simple",
  "Compound monthly": "Compound monthly",
  "Multiple interest": "Multiple interest",
};

// Multiple-interest ladder: each step's rate applies while interest has been
// unpaid for up to `days` days; the last step is "Thereafter". Same rules and
// summary wording as web SchemeModalContent.tsx.
type TierDraft = { days: string; rate: string };
const EMPTY_TIERS: TierDraft[] = [{ days: "", rate: "" }, { days: "", rate: "" }];
function tiersError(tiers: TierDraft[]): string {
  if (tiers.length < 2) return "Add at least two rate rows.";
  for (let i = 0; i < tiers.length; i++) {
    if (!(parseFloat(tiers[i].rate) > 0)) return `Row ${i + 1}: enter a rate above 0.`;
    if (i < tiers.length - 1 && !(parseInt(tiers[i].days, 10) > 0)) return `Row ${i + 1}: enter the days above 0.`;
  }
  return "";
}
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
  // Branch picker — only for a role that can see every branch (hidden otherwise, like web); the scheme then
  // belongs to the user's own branch.
  const [branch, setBranch] = useOwnBranch(null);

  const [name, setName] = useState("");
  const [interestRate, setInterestRate] = useState("");
  const [durationMonths, setDurationMonths] = useState("");
  const [ltvPercent, setLtvPercent] = useState("");
  const [method, setMethod] = useState<Method>(METHODS[0]);
  const isMultiple = method === "Multiple interest";
  const [tiers, setTiers] = useState<TierDraft[]>(EMPTY_TIERS);
  const [minDays, setMinDays] = useState("0");
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
    setTiers(sc?.rateTiers?.length ? sc.rateTiers.map((t, i, a) => ({ days: i === a.length - 1 ? "" : String(t.days), rate: String(t.rate) })) : EMPTY_TIERS);
    setMinDays(sc ? String(sc.minimumDays || 0) : "30");
    setPenalRate(sc?.penalRate != null ? String(sc.penalRate) : "");
    setConditions(sc?.conditions ?? "");
    setStatus(!sc || sc.isActive ? "Active" : "Inactive");
    setBranch(sc ? { id: sc.branchId, name: sc.branch?.name ?? "" } : employee ? { id: employee.branchId, name: employee.branch?.name ?? "Your branch" } : null);
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
        branchId: branch?.id ?? (scheme ? scheme.branchId : employee!.branchId),
        // Multiple interest: the scheme's headline rate is the first step's rate.
        interestRate: isMultiple ? Number(tiers[0].rate) : Number(interestRate),
        rateTiers: isMultiple ? tiers.map((t, i) => ({ days: i === tiers.length - 1 ? 0 : parseInt(t.days, 10), rate: Number(t.rate) })) : [],
        minimumDays: parseInt(minDays, 10) || 0,
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
  const patchTier = (i: number, p: Partial<TierDraft>) => setTiers((cur) => cur.map((x, j) => (j === i ? { ...x, ...p } : x)));
  const submit = () => {
    const err = isMultiple ? tiersError(tiers) : "";
    if (err) { setError(err); return; }
    setError(null);
    save.mutate();
  };
  return (
    <Sheet visible={visible} onClose={onClose} title={editing ? "Edit Scheme" : "Scheme"} maxHeightPct={92}>
      <FieldRow>
        <BranchField branch={branch} onChange={setBranch} />
        <Field label="Name">
          <Input placeholder="e.g. Gold Plus" value={name} onChangeText={setName} />
        </Field>
        {isMultiple ? (
          <Field label="Minimum period (days)">
            <Input keyboardType="number-pad" value={minDays} onChangeText={(t) => setMinDays(t.replace(/\D/g, ""))} />
          </Field>
        ) : (
          <Field label="Interest rate (% p.a.)">
            <Input placeholder="e.g. 14.4" keyboardType="decimal-pad" value={interestRate} onChangeText={(t) => setInterestRate(num(t))} />
          </Field>
        )}
      </FieldRow>
      {!isMultiple ? (
        <FieldRow>
          <Field label="Minimum period (days)">
            <Input keyboardType="number-pad" value={minDays} onChangeText={(t) => setMinDays(t.replace(/\D/g, ""))} />
          </Field>
        </FieldRow>
      ) : null}
      <FieldRow>
        <Field label="Duration (months)">
          <Input placeholder="e.g. 6" keyboardType="number-pad" value={durationMonths} onChangeText={(t) => setDurationMonths(t.replace(/\D/g, ""))} />
        </Field>
        <Field label="LTV (%)">
          <Input placeholder="e.g. 75" keyboardType="decimal-pad" value={ltvPercent} onChangeText={(t) => setLtvPercent(num(t))} />
        </Field>
      </FieldRow>
      <FieldRow>
        <Field label="Interest calculation">
          <ThemeDropdown<Method> value={method} options={[...METHODS]} onChange={setMethod} labelOf={(m) => METHOD_LABELS[m]} />
        </Field>
        <Field label="Penal charges (% p.a., 0–60) *">
          <Input placeholder="e.g. 24" keyboardType="decimal-pad" value={penalRate} onChangeText={(t) => setPenalRate(num(t))} />
        </Field>
      </FieldRow>
      {isMultiple ? (
        <Field label="Rate ladder">
          <View style={{ flexDirection: "row", gap: 6, marginBottom: 4 }}>
            <Txt style={{ width: 44, fontSize: 11, color: C.muted }}>#</Txt>
            <Txt style={{ flex: 1, fontSize: 11, color: C.muted }}>Unpaid days</Txt>
            <Txt style={{ flex: 1, fontSize: 11, color: C.muted }}>Rate % p.a.</Txt>
            <View style={{ width: 24 }} />
          </View>
          {tiers.map((t, i) => {
            const last = i === tiers.length - 1;
            return (
              <View key={i} style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 6 }}>
                <Txt style={{ width: 44, fontSize: 12, color: C.accentDeep }}>Step {i + 1}</Txt>
                <View style={{ flex: 1 }}>
                  {last
                    ? <Input value="Thereafter" editable={false} />
                    : <Input placeholder="e.g. 90" keyboardType="number-pad" value={t.days} onChangeText={(v) => patchTier(i, { days: v.replace(/\D/g, "") })} />}
                </View>
                <View style={{ flex: 1 }}>
                  <Input placeholder="e.g. 12" keyboardType="decimal-pad" value={t.rate} onChangeText={(v) => patchTier(i, { rate: num(v) })} />
                </View>
                <Pressable
                  accessibilityLabel={`Remove row ${i + 1}`}
                  disabled={tiers.length <= 2}
                  onPress={() => setTiers((cur) => cur.filter((_, j) => j !== i))}
                  style={{ width: 24, alignItems: "center", opacity: tiers.length <= 2 ? 0.25 : 1 }}
                >
                  <Txt style={{ color: C.red, fontSize: 16 }}>✕</Txt>
                </Pressable>
              </View>
            );
          })}
          <Pressable onPress={() => setTiers((cur) => [...cur.slice(0, -1), { days: "", rate: "" }, cur[cur.length - 1]])} style={{ paddingVertical: 6 }}>
            <Txt style={{ color: C.accentDeep, fontSize: 13 }}>+ Add rate row</Txt>
          </Pressable>
        </Field>
      ) : null}
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
        onPress={submit}
        loading={save.isPending}
        disabled={!name || !(penalRate !== "" && Number(penalRate) >= 0 && Number(penalRate) <= 60) || (!isMultiple && !interestRate) || !durationMonths || !ltvPercent || (chargeSet && !chargeValue)}
      />
    </Sheet>
  );
}
