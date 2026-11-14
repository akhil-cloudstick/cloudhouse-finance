import { useEffect, useState } from "react";
import { Pressable, View } from "react-native";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { C, ChipToggle, Field, FieldRow, Input, PrimaryButton, Sheet, ThemeDropdown, Txt } from "@/common/components/ui";
import { SwitchToggle } from "@/common/components/ui/SwitchToggle";
import { useAuth } from "@/common/providers/AuthProvider";
import { BranchField, useOwnBranch } from "@/modules/cash/components/EntryFormParts";
import { createScheme, toggleSchemeActive, updateScheme } from "@/modules/schemes/services/schemeService";
import { type AccrualBasis, type SchemeInput, type Scheme, type ServiceChargeType } from "@/modules/schemes/types/scheme-types";
import { ApiError } from "@/common/services/httpClient";
import { TENANT_MODULES } from "@/common/config/tenantModules";
import { useTheme } from "@/common/theme/ThemeProvider";

// ---------------------------------------------------------------------------
// Scheme create / edit (prototype #scheme-create-modal). Same fields, wire
// values and validation as the old schemes/new.tsx + schemes/[id].tsx edit
// sheet (web SchemeModal.tsx): interest method is stored as the full text,
// service charge None/Flat/Percent (how it is collected is chosen per loan).
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
const ladderHead = { fontSize: 10.5, fontWeight: "800" as const, color: C.muted, textTransform: "uppercase" as const };
const ladderInput = { paddingVertical: 7, paddingHorizontal: 6, textAlign: "center" as const, fontSize: 13 };
// Interest on ₹1,00,000 over 365 days: each step's rate p.a. for the days it covers; the last step takes the rest.
function ladderExample(tiers: TierDraft[]): number {
  let left = 365;
  let total = 0;
  tiers.forEach((t, i) => {
    const d = i === tiers.length - 1 ? left : Math.min(left, parseInt(t.days, 10) || 0);
    total += (100000 * (parseFloat(t.rate) || 0) / 100) * d / 365;
    left -= d;
  });
  return Math.round(total);
}
const CHARGE_TYPES = ["None", "Flat", "Percent"] as const satisfies readonly ServiceChargeType[];
const CHARGE_TYPE_LABELS: Record<ServiceChargeType, string> = { None: "None", Flat: "Flat amount", Percent: "Percentage" };
const STATUSES = ["Active", "Inactive"] as const;
// Same two choices as the web scheme form's Accrual Method.
const ACCRUALS = ["daily", "monthly"] as const;
const ACCRUAL_LABELS: Record<AccrualBasis, string> = { daily: "Daily", monthly: "Monthly" };

function FieldErr({ msg }: { msg?: string }) {
  return msg ? <Txt style={{ fontSize: 11.5, color: C.red, marginTop: 4 }}>{msg}</Txt> : null;
}

export const num = (t: string) => t.replace(/[^0-9.]/g, "");

type SchemeSheetProps = { visible: boolean; onClose: () => void; scheme?: Scheme | null };

export function SchemeSheet({ visible, onClose, scheme }: SchemeSheetProps) {
  const qc = useQueryClient();
  const { employee } = useAuth();
  const editing = !!scheme;
  // "Multiple interest" is switched on per business from the superadmin console;
  // a scheme already on it keeps the option so it can still be edited.
  const { hasModule } = useTheme();
  // "Compound monthly" is unused for now — hidden from new choices; a scheme already on it keeps the option (like web).
  const methods = METHODS.filter(
    (m) =>
      (m !== "Multiple interest" || hasModule(TENANT_MODULES.multipleInterest) || scheme?.interestMethod === m) &&
      (m !== "Compound monthly" || scheme?.interestMethod === m)
  );
  // Branch picker — only for a role that can see every branch (hidden otherwise, like web); the scheme then
  // belongs to the user's own branch.
  const [branch, setBranch] = useOwnBranch(null);

  const [name, setName] = useState("");
  const [interestRate, setInterestRate] = useState("");
  const [durationMonths, setDurationMonths] = useState("");
  const [ltvPercent, setLtvPercent] = useState("");
  // Off: loans on this scheme are not limited by the gold's value, so there is no LTV to enter.
  const [ltvBased, setLtvBased] = useState(true);
  const [method, setMethod] = useState<Method>(METHODS[0]);
  const isMultiple = method === "Multiple interest";
  const [tiers, setTiers] = useState<TierDraft[]>(EMPTY_TIERS);
  const [minDays, setMinDays] = useState("0");
  const [accrualBasis, setAccrualBasis] = useState<AccrualBasis>("daily");
  const [penalRate, setPenalRate] = useState("");
  const [conditions, setConditions] = useState("");
  // New schemes default to Active (web SchemeModal parity; backend defaults false).
  const [status, setStatus] = useState<(typeof STATUSES)[number]>("Active");
  const [chargeType, setChargeType] = useState<ServiceChargeType>("None");
  const [chargeValue, setChargeValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  // Field-level errors (web SchemeModalContent parity); cleared per field as it is edited.
  const [fe, setFe] = useState<Record<string, string>>({});
  const clearFe = (k: string) => setFe((cur) => (cur[k] ? { ...cur, [k]: "" } : cur));

  useEffect(() => {
    if (!visible) return;
    const sc = scheme;
    setName(sc?.name ?? "");
    setInterestRate(sc ? String(sc.interestRate) : "");
    setDurationMonths(sc ? String(sc.durationMonths) : "");
    setLtvPercent(sc && sc.ltvBased !== false ? String(sc.ltvPercent) : "");
    setLtvBased(sc ? sc.ltvBased !== false : true);
    setMethod(sc && (METHODS as readonly string[]).includes(sc.interestMethod ?? "") ? (sc.interestMethod as Method) : METHODS[0]);
    setTiers(sc?.rateTiers?.length ? sc.rateTiers.map((t, i, a) => ({ days: i === a.length - 1 ? "" : String(t.days), rate: String(t.rate) })) : EMPTY_TIERS);
    setMinDays(sc ? String(sc.minimumDays || 0) : "30");
    setAccrualBasis(sc?.accrualBasis === "monthly" ? "monthly" : "daily");
    setPenalRate(sc?.penalRate != null ? String(sc.penalRate) : "");
    setConditions(sc?.conditions ?? "");
    setStatus(!sc || sc.isActive ? "Active" : "Inactive");
    setBranch(sc ? { id: sc.branchId, name: sc.branch?.name ?? "" } : employee ? { id: employee.branchId, name: employee.branch?.name ?? "Your branch" } : null);
    const ct = sc?.serviceChargeType && sc.serviceChargeType !== "None" ? sc.serviceChargeType : "None";
    setChargeType(ct);
    setChargeValue(ct !== "None" ? String(sc?.serviceChargeValue ?? "") : "");
    setError(null);
    setFe({});
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
        ltvBased,
        ltvPercent: ltvBased ? Number(ltvPercent) : 0,
        interestMethod: method,
        accrualBasis,
        penalRate: penalRate ? Number(penalRate) : undefined,
        conditions: conditions.trim() || undefined,
        // Edit keeps the stored flag in the PUT and flips it through the
        // dedicated toggle endpoint below (same as the old detail screen).
        isActive: scheme ? scheme.isActive : status === "Active",
        serviceChargeType: chargeType,
        serviceChargeValue: chargeType === "None" ? 0 : Number(chargeValue),
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
    const errors: Record<string, string> = {};
    if (name.trim().length < 3) errors.name = "Please enter a scheme name (at least 3 characters).";
    if (!isMultiple && !(parseFloat(interestRate) > 0)) errors.rate = "Please enter a valid interest rate.";
    if (!(parseInt(durationMonths, 10) > 0)) errors.duration = "Please enter a valid loan duration in months.";
    const l = parseFloat(ltvPercent);
    if (ltvBased && !(l >= 1 && l <= 100)) errors.ltv = "LTV must be between 1 and 100%.";
    const p = parseFloat(penalRate);
    if (!(p >= 0 && p <= 60)) errors.penal = "Please enter penal charges between 0 and 60% per annum.";
    const cv = parseFloat(chargeValue);
    if (chargeSet && !(cv >= 0 && (chargeType !== "Percent" || cv <= 100))) errors.charge = chargeType === "Percent" ? "Percentage charge must be between 0 and 100." : "Please enter a valid flat charge amount.";
    const err = isMultiple ? tiersError(tiers) : "";
    if (Object.keys(errors).length || err) { setFe(errors); setError(err || null); return; }
    setFe({});
    setError(null);
    save.mutate();
  };
  return (
    <Sheet visible={visible} onClose={onClose} title={editing ? "Edit Scheme" : "Scheme"} maxHeightPct={92}>
      <Field label="Name">
        <Input placeholder="e.g. Gold Plus" value={name} onChangeText={(t) => { setName(t); clearFe("name"); }} />
        <FieldErr msg={fe.name} />
      </Field>
      <FieldRow>
        <BranchField branch={branch} onChange={setBranch} />
        {isMultiple ? (
          <Field label="Minimum period (days)">
            <Input keyboardType="number-pad" value={minDays} onChangeText={(t) => setMinDays(t.replace(/\D/g, ""))} />
          </Field>
        ) : (
          <Field label="Interest rate (% p.a.)">
            <Input placeholder="e.g. 14.4" keyboardType="decimal-pad" value={interestRate} onChangeText={(t) => { setInterestRate(num(t)); clearFe("rate"); }} />
            <FieldErr msg={fe.rate} />
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
          <Input placeholder="e.g. 6" keyboardType="number-pad" value={durationMonths} onChangeText={(t) => { setDurationMonths(t.replace(/\D/g, "")); clearFe("duration"); }} />
          <FieldErr msg={fe.duration} />
        </Field>
        {ltvBased ? (
          <Field label="LTV (%)">
            <Input placeholder="e.g. 75" keyboardType="decimal-pad" value={ltvPercent} onChangeText={(t) => { setLtvPercent(num(t)); clearFe("ltv"); }} />
            <FieldErr msg={fe.ltv} />
          </Field>
        ) : null}
      </FieldRow>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
        <Txt style={{ fontSize: 13, color: C.ink, flex: 1, paddingRight: 12 }}>Loan amount is limited by gold LTV</Txt>
        <SwitchToggle value={ltvBased} onValueChange={setLtvBased} />
      </View>
      <FieldRow>
        <Field label="Interest calculation">
          <ThemeDropdown<Method> value={method} options={methods} onChange={setMethod} labelOf={(m) => METHOD_LABELS[m]} />
        </Field>
        <Field label="Accrual method">
          <ThemeDropdown<AccrualBasis> value={accrualBasis} options={[...ACCRUALS]} onChange={setAccrualBasis} labelOf={(a) => ACCRUAL_LABELS[a]} />
        </Field>
      </FieldRow>
      <Field label="Penal charges (p.a)">
        <Input placeholder="e.g. 24" keyboardType="decimal-pad" value={penalRate} onChangeText={(t) => { setPenalRate(num(t)); clearFe("penal"); }} />
        <FieldErr msg={fe.penal} />
      </Field>
      {isMultiple ? (
        <Field>
          <Txt style={{ fontSize: 11.5, fontWeight: "700", color: C.muted, textTransform: "uppercase", marginBottom: 6 }}>Rate ladder</Txt>
          <View style={{ borderWidth: 1, borderColor: C.line, borderRadius: 12, overflow: "hidden" }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 10, paddingVertical: 7, backgroundColor: C.brandFaint }}>
              <Txt style={{ flex: 1, ...ladderHead }}>Step</Txt>
              <Txt style={{ width: 74, textAlign: "center", ...ladderHead }}>Days</Txt>
              <Txt style={{ width: 74, textAlign: "center", ...ladderHead }}>Rate %</Txt>
              <View style={{ width: 28 }} />
            </View>
            {tiers.map((t, i) => {
              const last = i === tiers.length - 1;
              return (
                <View key={i} style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 10, paddingVertical: 9, borderTopWidth: 1, borderTopColor: C.line }}>
                  <View style={{ flex: 1 }}>
                    <Txt style={{ fontSize: 13, fontWeight: "800" }}>Step {i + 1}</Txt>
                    <Txt style={{ fontSize: 10.5, color: C.muted }}>{last ? "Thereafter" : "Unpaid up to"}</Txt>
                  </View>
                  <View style={{ width: 74 }}>
                    {last
                      ? <Input value="—" editable={false} style={ladderInput} />
                      : <Input placeholder="90" keyboardType="number-pad" value={t.days} onChangeText={(v) => patchTier(i, { days: v.replace(/\D/g, "") })} style={ladderInput} />}
                  </View>
                  <View style={{ width: 74 }}>
                    <Input placeholder="12" keyboardType="decimal-pad" value={t.rate} onChangeText={(v) => patchTier(i, { rate: num(v) })} style={ladderInput} />
                  </View>
                  {last ? (
                    <View style={{ width: 28 }} />
                  ) : (
                    <Pressable
                      accessibilityLabel={`Remove row ${i + 1}`}
                      disabled={tiers.length <= 2}
                      onPress={() => setTiers((cur) => cur.filter((_, j) => j !== i))}
                      style={{ width: 28, height: 28, borderRadius: 9, backgroundColor: C.brandFaint, alignItems: "center", justifyContent: "center", opacity: tiers.length <= 2 ? 0.35 : 1 }}
                    >
                      <Txt style={{ color: C.muted, fontSize: 13, fontWeight: "700" }}>✕</Txt>
                    </Pressable>
                  )}
                </View>
              );
            })}
          </View>
          <Pressable
            onPress={() => setTiers((cur) => [...cur.slice(0, -1), { days: "", rate: "" }, cur[cur.length - 1]])}
            style={{ marginTop: 8, paddingVertical: 10, borderRadius: 11, borderWidth: 1.5, borderStyle: "dashed", borderColor: C.line, alignItems: "center" }}
          >
            <Txt style={{ color: C.brandDeep, fontSize: 13, fontWeight: "700" }}>+ Add a step</Txt>
          </Pressable>
          <View style={{ marginTop: 8, padding: 10, borderRadius: 11, backgroundColor: C.brandFaint }}>
            <Txt style={{ fontSize: 12, color: C.muted }}>
              Example: ₹1,00,000 unpaid for 12 months earns about <Txt style={{ fontSize: 12, fontWeight: "800", color: C.brandDeep }}>₹{ladderExample(tiers).toLocaleString("en-IN")}</Txt>
            </Txt>
          </View>
        </Field>
      ) : null}
      <Field label="Applicable conditions">
        <Input placeholder="Free text, e.g. KYC requirements" value={conditions} onChangeText={setConditions} />
      </Field>
      <Field label="Status">
        <ChipToggle variant="chips" options={STATUSES} value={status} onChange={setStatus} />
      </Field>
      <Field label="Service charge">
        <ChipToggle variant="chips" options={CHARGE_TYPES} value={chargeType} onChange={setChargeType} labels={CHARGE_TYPE_LABELS} />
      </Field>
      <Field label={chargeType === "Flat" ? "Charge amount (₹)" : chargeType === "Percent" ? "Charge (% of principal)" : "Charge amount / percentage"}>
        <Input
          placeholder={chargeType === "Flat" ? "e.g. 500" : chargeType === "Percent" ? "e.g. 2" : "Only if service charge is set"}
          keyboardType="decimal-pad"
          editable={chargeSet}
          value={chargeValue}
          onChangeText={(t) => { setChargeValue(num(t)); clearFe("charge"); }}
        />
        <FieldErr msg={fe.charge} />
      </Field>
      {error ? <Txt style={{ fontSize: 12, color: C.red, marginBottom: 10 }}>{error}</Txt> : null}
      <PrimaryButton
        label="Save Scheme"
        onPress={submit}
        loading={save.isPending}
      />
    </Sheet>
  );
}
