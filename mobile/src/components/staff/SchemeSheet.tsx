import React, { useEffect, useState } from "react";
import { Alert, Pressable, View } from "react-native";
import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AccBtn, Buffering, BtnRow2, C, CheckItem, ChipToggle, DateField, EmptyText, Field, FieldRow, Input, PrimaryButton, ResultBox, Sheet, Txt } from "../ui";
import { useAuth } from "../../auth/AuthContext";
import { useDebouncedValue } from "../../hooks/useDebouncedValue";
import { calculateSchemeEligibility, createScheme, toggleSchemeActive, updateScheme, type SchemeInput } from "../../api/schemes";
import { listLoansPage } from "../../api/loans";
import { downloadSchemeStatement, previewSchemeStatementPdf, type StatementFilters } from "../../utils/schemeStatement";
import { ApiError } from "../../api/client";
import { inr, todayISO } from "../../lib/format";
import type { Scheme, ServiceChargeMode, ServiceChargeType } from "../../types/scheme";

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

const num = (t: string) => t.replace(/[^0-9.]/g, "");

export function SchemeSheet({ visible, onClose, scheme }: { visible: boolean; onClose: () => void; scheme?: Scheme | null }) {
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
        <ChipToggle options={METHODS} value={method} onChange={setMethod} labels={METHOD_LABELS} wrap />
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

// ---------------------------------------------------------------------------
// Download Statement (prototype #scheme-statement-modal). The file itself is
// built by the backend (GET /schemes/:id/statement, src/utils/schemeStatement.ts)
// from every loan in range — nothing is assembled on the phone. The optional
// loan picker below pages loans in range from the server 10 at a time.
// ---------------------------------------------------------------------------

const firstOfMonth = () => `${todayISO().slice(0, 8)}01`;
const PAGE = 10;

export function SchemeStatementSheet({ visible, onClose, scheme }: { visible: boolean; onClose: () => void; scheme: Scheme | null }) {
  const [from, setFrom] = useState(firstOfMonth());
  const [to, setTo] = useState(todayISO());
  const [goldWeight, setGoldWeight] = useState("");
  const [goldRate, setGoldRate] = useState("");
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState<"pdf" | "xlsx" | "preview" | null>(null);
  const [eligible, setEligible] = useState<number | null>(null);

  useEffect(() => {
    if (!visible) return;
    setFrom(firstOfMonth());
    setTo(todayISO());
    setGoldWeight("");
    setGoldRate("");
    setSelected(new Set());
    setBusy(null);
    setEligible(null);
  }, [visible, scheme?.id]);
  useEffect(() => setSelected(new Set()), [from, to]);

  const schemeId = scheme?.id ?? 0;
  const loans = useInfiniteQuery({
    queryKey: ["scheme-loans", schemeId, from, to],
    enabled: visible && !!scheme,
    initialPageParam: 0,
    queryFn: ({ pageParam }) => listLoansPage({ schemeId, from: from || undefined, to: to || undefined, limit: PAGE, offset: pageParam as number }),
    getNextPageParam: (last, all) => (last?.hasMore ? all.length * PAGE : undefined),
  });
  const rows = loans.data?.pages.flatMap((p) => p.items ?? []) ?? [];
  const total = loans.data?.pages[0]?.total;

  // Eligibility for the entered weight × rate (the old scheme screen's
  // calculator, now folded into this sheet like the prototype).
  const w = Number(useDebouncedValue(goldWeight));
  const r = Number(useDebouncedValue(goldRate));
  const calc = useMutation({
    mutationFn: () => calculateSchemeEligibility(schemeId, w, r),
    onSuccess: (res) => setEligible(res.eligibleAmount),
    onError: () => setEligible(null),
  });
  useEffect(() => {
    if (visible && scheme && w > 0 && r > 0) calc.mutate();
    else setEligible(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [w, r, visible, scheme?.id]);

  const filters: StatementFilters = {
    from: from || undefined,
    to: to || undefined,
    loanIds: selected.size ? Array.from(selected) : undefined,
    goldWeight: Number(goldWeight) || undefined,
    goldRate: Number(goldRate) || undefined,
  };

  async function run(kind: "pdf" | "xlsx" | "preview") {
    if (!scheme) return;
    setBusy(kind);
    try {
      if (kind === "preview") await previewSchemeStatementPdf(scheme.id, filters);
      else await downloadSchemeStatement(scheme.id, kind, filters);
    } catch (e) {
      Alert.alert(kind === "preview" ? "Preview failed" : "Download failed", e instanceof Error ? e.message : "Could not download statement.");
    } finally {
      setBusy(null);
    }
  }

  const toggle = (id: number) =>
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const allLoadedSelected = rows.length > 0 && rows.every((l) => selected.has(l.id));

  return (
    <Sheet visible={visible} onClose={onClose} title={`Download Statement — ${scheme?.name ?? ""}`} maxHeightPct={70}>
      <FieldRow>
        <DateField label="From date" value={from} onChange={setFrom} max={to || todayISO()} clearable />
        <DateField label="To date" value={to} onChange={setTo} min={from || undefined} max={todayISO()} clearable />
      </FieldRow>
      <FieldRow>
        <Field label="Gold weight (g)">
          <Input placeholder="Optional — filter by weight" keyboardType="decimal-pad" value={goldWeight} onChangeText={(t) => setGoldWeight(num(t))} />
        </Field>
        <Field label="Gold rate (₹/g)">
          <Input placeholder="Optional — filter by rate" keyboardType="decimal-pad" value={goldRate} onChangeText={(t) => setGoldRate(num(t))} />
        </Field>
      </FieldRow>
      {calc.isPending ? <Buffering style={{ paddingVertical: 8 }} /> : eligible != null ? <ResultBox k="Eligible amount" v={inr(eligible)} /> : null}

      <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 6 }}>
        <Txt style={{ flex: 1, fontSize: 11.5, fontWeight: "600", color: C.muted }}>
          Loans {selected.size > 0 ? `(${selected.size} selected)` : `(all${total != null ? ` ${total}` : ""} in range)`}
        </Txt>
        {rows.length > 0 ? (
          <Pressable hitSlop={6} onPress={() => setSelected(allLoadedSelected ? new Set() : new Set(rows.map((l) => l.id)))}>
            <Txt style={{ fontSize: 11.5, fontWeight: "700", color: C.brandDeep }}>{allLoadedSelected ? "Clear all" : "Select all"}</Txt>
          </Pressable>
        ) : null}
      </View>
      {loans.isLoading ? (
        <Buffering block />
      ) : rows.length === 0 ? (
        <EmptyText>No loans opened under this scheme in that range.</EmptyText>
      ) : (
        <>
          {rows.map((l) => (
            <CheckItem
              key={l.id}
              checked={selected.has(l.id)}
              onPress={() => toggle(l.id)}
              title={`${l.loanNumber} — ${l.customer?.name ?? "—"}`}
              sub={inr(l.principalAmount)}
            />
          ))}
          {loans.hasNextPage ? (
            <AccBtn
              label={loans.isFetchingNextPage ? "Loading…" : "Load more"}
              disabled={loans.isFetchingNextPage}
              onPress={() => loans.fetchNextPage()}
              style={{ flex: 0, marginBottom: 12 }}
            />
          ) : null}
        </>
      )}

      <PrimaryButton label="Preview PDF" variant="outline" onPress={() => run("preview")} loading={busy === "preview"} disabled={busy !== null} style={{ marginTop: 8, marginBottom: 10 }} />
      <BtnRow2>
        <PrimaryButton label="Export .xlsx" variant="outline" onPress={() => run("xlsx")} loading={busy === "xlsx"} disabled={busy !== null} />
        <PrimaryButton label="Download PDF" onPress={() => run("pdf")} loading={busy === "pdf"} disabled={busy !== null} />
      </BtnRow2>
    </Sheet>
  );
}
