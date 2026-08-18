import React, { useState } from "react";
import { ScrollView, View, Pressable, RefreshControl } from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRefetchOnFocus } from "../../src/hooks/useRefetchOnFocus";
import { useRouter } from "expo-router";
import { ScreenContainer } from "../../src/components/ScreenContainer";
import { Card } from "../../src/components/Card";
import { ThemedText } from "../../src/components/ThemedText";
import { GoldTextInput } from "../../src/components/GoldTextInput";
import { GoldButton } from "../../src/components/GoldButton";
import { colors } from "../../src/theme/colors";
import { useAuth } from "../../src/auth/AuthContext";
import { useDebouncedValue } from "../../src/hooks/useDebouncedValue";
import { listCustomers } from "../../src/api/customers";
import { listSchemes } from "../../src/api/schemes";
import { createLoan, CreateOrnamentInput } from "../../src/api/loans";
import { latestGoldRate } from "../../src/api/goldRates";
import { listOrnamentTypes, createOrnamentType } from "../../src/api/ornamentTypes";
import { formatPurity, isKaratInRange, isFinenessInRange, rateForPurityString, PurityUnit } from "../../src/lib/purity";
import { fmt } from "../../src/lib/format";
import { ChipSelect } from "../../src/components/ChipSelect";
import { Customer } from "../../src/types/customer";
import { Scheme } from "../../src/types/scheme";
import { ApiError } from "../../src/api/client";

// purityUnit/purityValue stand in for frontend/components/PurityPicker.tsx's
// Karat/Fineness% toggle — combined into the canonical "22K"/"91.6%" string
// (rowPurity() below) right before it's used, same as the web picker's
// `value`.
type OrnRow = { name: string; purityUnit: PurityUnit; purityValue: string; grossWeight: string; quantity: string };

const emptyRow: OrnRow = { name: "", purityUnit: "karat", purityValue: "", grossWeight: "", quantity: "1" };

// Search-or-create against the shared ornament_types catalog — mirrors the
// SearchableSelect(allowCreate) frontend/components/NewLoan.tsx wires to the
// "Ornament" column, so staff aren't limited to types someone already typed
// in on the web admin; picking or typing a new one here adds it to the same
// catalog. createOrnamentType find-or-creates (dedupes by name) server-side,
// so it's safe to call even when the typed name already exists.
function OrnamentNameField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const queryClient = useQueryClient();
  const [focused, setFocused] = useState(false);
  const debounced = useDebouncedValue(value);

  const results = useQuery({
    queryKey: ["ornamentTypes", debounced],
    queryFn: () => listOrnamentTypes(debounced || undefined),
    enabled: focused,
  });

  const create = useMutation({
    mutationFn: (name: string) => createOrnamentType(name),
    onSuccess: (type) => {
      queryClient.invalidateQueries({ queryKey: ["ornamentTypes"] });
      onChange(type.name);
      setFocused(false);
    },
  });

  const trimmed = value.trim();
  const options = results.data ?? [];
  const exactMatch = options.some((t) => t.name.toLowerCase() === trimmed.toLowerCase());

  return (
    <View>
      <GoldTextInput
        label="Ornament name"
        placeholder="e.g. Chain, Bangle…"
        value={value}
        onChangeText={onChange}
        onFocus={() => setFocused(true)}
        // Delay the blur-driven close so a tap on a suggestion (which fires
        // after the input blurs) still registers before the list unmounts.
        onBlur={() => setTimeout(() => setFocused(false), 150)}
      />
      {focused && trimmed ? (
        <ScrollView nestedScrollEnabled style={{ maxHeight: 180 }} keyboardShouldPersistTaps="handled">
          {options.map((t) => (
            <Pressable
              key={t.id}
              onPress={() => {
                onChange(t.name);
                setFocused(false);
              }}
              style={{ paddingVertical: 8 }}
            >
              <ThemedText variant="body">{t.name}</ThemedText>
            </Pressable>
          ))}
          {!exactMatch ? (
            <Pressable onPress={() => create.mutate(trimmed)} style={{ paddingVertical: 8 }}>
              <ThemedText variant="small" color={colors.goldDeep}>
                + Add &quot;{trimmed}&quot; as a new ornament type
              </ThemedText>
            </Pressable>
          ) : null}
        </ScrollView>
      ) : null}
    </View>
  );
}

// The mobile app had no way to originate a loan at all — every loan had to
// be created on the web admin. This is a lean port of
// frontend/components/NewLoan.tsx's core flow (customer/scheme/branch +
// ornament rows + principal), without that screen's draft-saving, print
// helpers, or gold-rate-eligibility calculator, which stay web-only for now.
export default function NewLoanScreen() {
  const router = useRouter();
  const { employee } = useAuth();
  const queryClient = useQueryClient();

  const [customerQuery, setCustomerQuery] = useState("");
  const debouncedCustomerQuery = useDebouncedValue(customerQuery);
  const [customer, setCustomer] = useState<Customer | null>(null);

  const [schemeQuery, setSchemeQuery] = useState("");
  const debouncedSchemeQuery = useDebouncedValue(schemeQuery);
  const [scheme, setScheme] = useState<Scheme | null>(null);

  const [principal, setPrincipal] = useState("");
  const [rows, setRows] = useState<OrnRow[]>([{ ...emptyRow }]);
  const [error, setError] = useState<string | null>(null);

  const customerResults = useQuery({
    queryKey: ["newLoanCustomers", debouncedCustomerQuery],
    // Same "show everything, then narrow" behaviour as the scheme picker
    // below — an empty query still fetches (the full, branch-scoped list),
    // so the dropdown isn't empty until the first keystroke.
    queryFn: () => listCustomers(debouncedCustomerQuery || undefined),
    enabled: !customer,
  });

  const schemeResults = useQuery({
    queryKey: ["newLoanSchemes", debouncedSchemeQuery],
    queryFn: () => listSchemes(debouncedSchemeQuery || undefined),
    enabled: !scheme,
  });

  // The web NewLoan form refuses to submit until today's K24 rate is
  // published — every ornament's value (and the LTV-eligible amount) is
  // priced off it, so creating a loan against yesterday's (or no) rate would
  // silently under/over-value the pledge. Mirrored here the same way.
  //
  // Shares the ["gold-rates", "latest"] key gold-rates.tsx invalidates after
  // a publish, and refetches every time this screen mounts — otherwise
  // publishing a rate on the Gold Rates screen and coming straight back
  // here could still show a stale "not published yet" banner from before
  // the publish.
  const goldRate = useQuery({
    queryKey: ["gold-rates", "latest"],
    queryFn: latestGoldRate,
    refetchOnMount: "always",
  });

  useRefetchOnFocus(goldRate.refetch);

  const today = new Date().toISOString().slice(0, 10);
  // `date` comes back as a full RFC3339 timestamp, not "YYYY-MM-DD" — slice
  // it down first (mirrors frontend/lib/goldRateApi.ts's toGoldRateView).
  // Comparing the raw timestamp to `today` would never match, so this
  // banner would incorrectly show "not set" forever, even right after
  // publishing.
  const isTodaySet = !!goldRate.data?.date && goldRate.data.date.slice(0, 10) === today;
  const k24 = goldRate.data?.k24 ?? 0;

  function updateRow(i: number, patch: Partial<OrnRow>) {
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }
  function addRow() {
    setRows((prev) => [...prev, { ...emptyRow }]);
  }
  function removeRow(i: number) {
    setRows((prev) => prev.filter((_, idx) => idx !== i));
  }

  // Combines a row's Karat/Fineness toggle + typed number into the
  // canonical "22K"/"91.6%" string PurityPicker.tsx produces — null if the
  // number's out of range or not typed yet.
  function rowPurity(r: OrnRow): string | null {
    const n = Number(r.purityValue);
    if (!r.purityValue.trim() || !(n > 0)) return null;
    if (r.purityUnit === "karat" && !isKaratInRange(n)) return null;
    if (r.purityUnit === "fineness" && !isFinenessInRange(n)) return null;
    return formatPurity(r.purityUnit, n);
  }

  const validRows = rows.filter((r) => r.name.trim() && rowPurity(r) && Number(r.grossWeight) > 0);

  // Per-row gold value = weight × quantity × today's rate for that purity —
  // same formula as frontend/components/NewLoan.tsx's rowVals. There's no
  // deduction-weight field here (the web form always sends 0 for it too —
  // see NewLoan.tsx's submit payload), so weight going in is weight priced.
  function rowValue(r: OrnRow): number {
    const purity = rowPurity(r);
    const rate = purity ? rateForPurityString(k24, purity) : null;
    if (rate == null) return 0;
    return Number(r.grossWeight || 0) * Number(r.quantity || 1) * rate;
  }
  const totalGrossValue = validRows.reduce((sum, r) => sum + rowValue(r), 0);
  const eligibleAmount = scheme ? Math.round((totalGrossValue * scheme.ltvPercent) / 100) : 0;

  const canSubmit = !!customer && !!scheme && Number(principal) > 0 && validRows.length > 0 && isTodaySet;

  const submit = useMutation({
    mutationFn: () => {
      const due = new Date();
      due.setMonth(due.getMonth() + (scheme?.durationMonths ?? 0));
      const ornaments: CreateOrnamentInput[] = validRows.map((r) => ({
        name: r.name.trim(),
        purity: rowPurity(r)!,
        grossWeight: Number(r.grossWeight),
        quantity: r.quantity ? Number(r.quantity) : undefined,
      }));
      return createLoan({
        branchId: employee!.branchId,
        customerId: customer!.id,
        schemeId: scheme!.id,
        openedDate: today,
        dueDate: due.toISOString().slice(0, 10),
        principalAmount: Number(principal),
        ornaments,
      });
    },
    onSuccess: (loan) => {
      queryClient.invalidateQueries({ queryKey: ["loans"] });
      setCustomer(null);
      setScheme(null);
      setPrincipal("");
      setRows([{ ...emptyRow }]);
      setError(null);
      router.push(`/loans/${loan.id}`);
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Could not create loan."),
  });

  return (
    <ScreenContainer>
      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={goldRate.isRefetching} onRefresh={() => goldRate.refetch()} />}
      >
        {!isTodaySet ? (
          <Card style={{ backgroundColor: colors.goldPale, borderColor: colors.goldDeep }}>
            <ThemedText variant="small" color={colors.ink}>
              Today&apos;s gold rate hasn&apos;t been published yet — ornament values, the LTV-eligible amount, and
              loan creation are all blocked until it is. Publish it from Gold Rates (More → Gold Rates) first.
            </ThemedText>
          </Card>
        ) : null}

        <Card>
          <ThemedText variant="h3" style={{ marginBottom: 8 }}>
            Customer
          </ThemedText>
          {customer ? (
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
              <View>
                <ThemedText variant="body">{customer.name}</ThemedText>
                <ThemedText variant="small" color={colors.muted}>
                  {customer.code} · {customer.phone}
                </ThemedText>
              </View>
              <Pressable onPress={() => setCustomer(null)}>
                <ThemedText variant="small" color={colors.red}>
                  Change
                </ThemedText>
              </Pressable>
            </View>
          ) : (
            <>
              <GoldTextInput
                label="Search customer"
                placeholder="Name, phone, or code…"
                value={customerQuery}
                onChangeText={setCustomerQuery}
              />
              {(customerResults.data ?? []).length > 0 ? (
                // Capped height + its own scroll so a long match list scrolls
                // within this "dropdown" instead of shoving the rest of the
                // form down the page. nestedScrollEnabled lets it scroll
                // independently of the outer form ScrollView on Android.
                <ScrollView
                  nestedScrollEnabled
                  style={{ maxHeight: 220 }}
                  keyboardShouldPersistTaps="handled"
                  showsVerticalScrollIndicator
                >
                  {(customerResults.data ?? []).map((c) => (
                    <Pressable key={c.id} onPress={() => setCustomer(c)} style={{ paddingVertical: 8 }}>
                      <ThemedText variant="body">{c.name}</ThemedText>
                      <ThemedText variant="small" color={colors.muted}>
                        {c.code} · {c.phone}
                      </ThemedText>
                    </Pressable>
                  ))}
                </ScrollView>
              ) : null}
            </>
          )}
        </Card>

        <Card>
          <ThemedText variant="h3" style={{ marginBottom: 8 }}>
            Scheme
          </ThemedText>
          {scheme ? (
            <>
              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                <View>
                  <ThemedText variant="body">{scheme.name}</ThemedText>
                  <ThemedText variant="small" color={colors.muted}>
                    {scheme.interestRate}% interest · {scheme.durationMonths} months · LTV {scheme.ltvPercent}%
                  </ThemedText>
                </View>
                <Pressable onPress={() => setScheme(null)}>
                  <ThemedText variant="small" color={colors.red}>
                    Change
                  </ThemedText>
                </Pressable>
              </View>
              {validRows.length > 0 ? (
                <ThemedText variant="small" color={colors.muted} style={{ marginTop: 8 }}>
                  Gold value ₹{fmt(totalGrossValue)} × {scheme.ltvPercent}% LTV = eligible amount ₹
                  {fmt(eligibleAmount)}
                </ThemedText>
              ) : null}
            </>
          ) : (
            <>
              <GoldTextInput label="Search scheme" value={schemeQuery} onChangeText={setSchemeQuery} />
              {(schemeResults.data ?? []).length > 0 ? (
                <ScrollView
                  nestedScrollEnabled
                  style={{ maxHeight: 220 }}
                  keyboardShouldPersistTaps="handled"
                  showsVerticalScrollIndicator
                >
                  {(schemeResults.data ?? []).map((s) => (
                    <Pressable key={s.id} onPress={() => setScheme(s)} style={{ paddingVertical: 8 }}>
                      <ThemedText variant="body">{s.name}</ThemedText>
                      <ThemedText variant="small" color={colors.muted}>
                        {s.interestRate}% · {s.durationMonths} months
                      </ThemedText>
                    </Pressable>
                  ))}
                </ScrollView>
              ) : null}
            </>
          )}
        </Card>

        <Card>
          <ThemedText variant="h3" style={{ marginBottom: 8 }}>
            Ornaments
          </ThemedText>
          {rows.map((row, i) => (
            <View key={i} style={{ marginBottom: 12, paddingBottom: 12, borderBottomWidth: i < rows.length - 1 ? 1 : 0, borderBottomColor: colors.line }}>
              <OrnamentNameField value={row.name} onChange={(v) => updateRow(i, { name: v })} />
              <ChipSelect
                label="Purity unit"
                options={["Karat", "Fineness"] as const}
                value={row.purityUnit === "karat" ? "Karat" : "Fineness"}
                onChange={(v) => updateRow(i, { purityUnit: v === "Karat" ? "karat" : "fineness" })}
              />
              <GoldTextInput
                label={row.purityUnit === "karat" ? "Karat (e.g. 22)" : "Fineness % (e.g. 91.6)"}
                keyboardType="numeric"
                value={row.purityValue}
                onChangeText={(v) => updateRow(i, { purityValue: v })}
              />
              <GoldTextInput
                label="Gross weight (g)"
                keyboardType="numeric"
                value={row.grossWeight}
                onChangeText={(v) => updateRow(i, { grossWeight: v })}
              />
              <GoldTextInput label="Quantity" keyboardType="numeric" value={row.quantity} onChangeText={(v) => updateRow(i, { quantity: v })} />
              {row.name.trim() && row.purityValue.trim() && Number(row.grossWeight) > 0 ? (
                <ThemedText variant="small" color={colors.muted} style={{ marginBottom: 8 }}>
                  {rowPurity(row) != null
                    ? `Value: ₹${fmt(rowValue(row))}`
                    : row.purityUnit === "karat"
                      ? "Karat must be between 10 and 24"
                      : "Fineness % must be greater than 0 and at most 100"}
                </ThemedText>
              ) : null}
              {rows.length > 1 ? (
                <Pressable onPress={() => removeRow(i)}>
                  <ThemedText variant="small" color={colors.red}>
                    Remove
                  </ThemedText>
                </Pressable>
              ) : null}
            </View>
          ))}
          <GoldButton title="+ Add ornament" variant="outline" onPress={addRow} />
        </Card>

        <Card>
          <ThemedText variant="h3" style={{ marginBottom: 8 }}>
            Principal
          </ThemedText>
          <GoldTextInput
            label="Principal amount"
            keyboardType="numeric"
            placeholder={eligibleAmount ? String(eligibleAmount) : undefined}
            value={principal}
            onChangeText={setPrincipal}
          />
          {!isTodaySet ? (
            <ThemedText variant="small" color={colors.red} style={{ marginBottom: 8 }}>
              Can&apos;t create a loan until today&apos;s gold rate is published.
            </ThemedText>
          ) : null}
          {error ? (
            <ThemedText variant="small" color={colors.red} style={{ marginBottom: 8 }}>
              {error}
            </ThemedText>
          ) : null}
          <GoldButton
            title="Create loan"
            onPress={() => submit.mutate()}
            loading={submit.isPending}
            disabled={!canSubmit || submit.isPending}
          />
        </Card>
      </ScrollView>
    </ScreenContainer>
  );
}
