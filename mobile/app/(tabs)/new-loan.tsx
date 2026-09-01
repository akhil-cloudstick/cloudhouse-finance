import React, { useState } from "react";
import { ScrollView, View, Pressable, RefreshControl, StyleSheet, Platform } from "react-native";
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
import { createLoan, addOrnamentImage, CreateOrnamentInput } from "../../src/api/loans";
import { DocumentField } from "../../src/components/DocumentField";
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
// img holds the uploaded "/uploads/..." URL for this ornament's photo (see
// DocumentField), same shape as frontend/modules/loans/components/NewLoan.tsx's
// OrnRow — uploaded immediately on pick, then linked to the ornament after
// createLoan() returns (see submit's onSuccess below).
type OrnRow = { name: string; purityUnit: PurityUnit; purityValue: string; grossWeight: string; quantity: string; img: string };

const emptyRow: OrnRow = { name: "", purityUnit: "karat", purityValue: "", grossWeight: "", quantity: "1", img: "" };

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
  const { employee, can } = useAuth();
  const canCreateLoan = can("Loan_Management", "can_create_loan");
  const queryClient = useQueryClient();

  const [customerQuery, setCustomerQuery] = useState("");
  const debouncedCustomerQuery = useDebouncedValue(customerQuery);
  const [customer, setCustomer] = useState<Customer | null>(null);
  // Both result queries fetch unconditionally (see their comments below), so
  // gating the dropdown on "has data" alone showed both floating panels at
  // once as soon as the screen mounted — neither field had been touched
  // yet. Only show a dropdown while its own field is actually focused,
  // same pattern as OrnamentNameField's suggestion list above. The timeout
  // on blur (not an immediate close) lets a tap on a row register first —
  // blur fires before the row's onPress otherwise.
  const [customerFocused, setCustomerFocused] = useState(false);

  const [schemeQuery, setSchemeQuery] = useState("");
  const debouncedSchemeQuery = useDebouncedValue(schemeQuery);
  const [scheme, setScheme] = useState<Scheme | null>(null);
  const [schemeFocused, setSchemeFocused] = useState(false);

  const [principal, setPrincipal] = useState("");
  // Free text staff may want to record on this loan that no standard field
  // captures — carried through onto the printed Statement of Account.
  const [additionalInfo, setAdditionalInfo] = useState("");
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
        ...(additionalInfo.trim() ? { additionalInfo: additionalInfo.trim() } : {}),
      });
    },
    onSuccess: async (loan) => {
      // Link each photographed row to the ornament the backend just created
      // for it. The backend returns ornaments in submission order (see
      // frontend/modules/loans/components/NewLoan.tsx's matching comment on
      // OrnamentRepository.FindByLoanID ordering by id asc) — safe to zip
      // validRows against loan.ornaments by index. Best-effort: the loan
      // itself is already created at this point, so an image-link failure
      // here shouldn't block navigating to it (staff can retry from the loan
      // detail screen if that grows an "add photo" affordance later).
      const createdOrnaments = loan.ornaments ?? [];
      await Promise.all(
        validRows.map((r, i) => {
          const created = createdOrnaments[i];
          if (r.img && created) return addOrnamentImage(created.id, r.img).catch(() => undefined);
          return Promise.resolve();
        })
      );
      queryClient.invalidateQueries({ queryKey: ["loans"] });
      setCustomer(null);
      setScheme(null);
      setPrincipal("");
      setAdditionalInfo("");
      setRows([{ ...emptyRow }]);
      setError(null);
      router.push(`/loans/${loan.id}`);
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Could not create loan."),
  });

  // The backend already 403s a POST /loans without "can change loan" — the
  // tab bar (AppTabBar.tsx) already hides this tab for a role without it,
  // this is a defensive second check for direct navigation to the route.
  if (!canCreateLoan) {
    return (
      <ScreenContainer style={{ padding: 0 }}>
        <View style={{ flex: 1, paddingHorizontal: 16, paddingTop: 16 }}>
      <Card>
          <ThemedText variant="body" color={colors.muted}>
            You don&apos;t have permission to create a loan. Contact a Loan Operator, Branch Manager, or Administrator.
          </ThemedText>
        </Card>
        </View>
      </ScreenContainer>    );
  }

  return (
    <ScreenContainer style={{ padding: 0 }}>
      <View style={{ flex: 1, paddingHorizontal: 16, paddingTop: 16 }}>
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

        {/* zIndex here (not just on the inner dropdown wrapper below) is
         * what actually makes the dropdown float over the Scheme card —
         * RN only respects zIndex among siblings sharing the same direct
         * parent, and this Card and the Scheme Card below are both direct
         * children of this ScrollView. Without it, the Scheme Card (a
         * later sibling) painted over this dropdown instead of the other
         * way around, since sibling paint order otherwise just follows
         * document order — that's the "dropdown looks shredded by the
         * next card" bug. */}
        <Card style={{ zIndex: customerFocused ? 20 : 1 }}>
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
            <View style={{ position: "relative", zIndex: 20 }}>
              <GoldTextInput
                label="Search customer"
                placeholder="Name, phone, or code…"
                value={customerQuery}
                onChangeText={setCustomerQuery}
                onFocus={() => setCustomerFocused(true)}
                onBlur={() => setTimeout(() => setCustomerFocused(false), 150)}
              />
              {customerFocused && (customerResults.data ?? []).length > 0 ? (
                // A real floating dropdown now — absolutely positioned over
                // whatever's below (Scheme card, etc.) instead of pushing it
                // down the page. nestedScrollEnabled lets its own scroll work
                // independently of the outer form ScrollView on Android.
                <View style={styles.dropdown}>
                  <ScrollView
                    nestedScrollEnabled
                    style={{ maxHeight: 220 }}
                    keyboardShouldPersistTaps="handled"
                    showsVerticalScrollIndicator
                  >
                    {(customerResults.data ?? []).map((c) => (
                      <Pressable key={c.id} onPress={() => setCustomer(c)} style={styles.dropdownRow}>
                        <ThemedText variant="body">{c.name}</ThemedText>
                        <ThemedText variant="small" color={colors.muted}>
                          {c.code} · {c.phone}
                        </ThemedText>
                      </Pressable>
                    ))}
                  </ScrollView>
                </View>
              ) : null}
            </View>
          )}
        </Card>

        <Card style={{ zIndex: schemeFocused ? 20 : 1 }}>
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
            <View style={{ position: "relative", zIndex: 20 }}>
              <GoldTextInput
                label="Search scheme"
                value={schemeQuery}
                onChangeText={setSchemeQuery}
                onFocus={() => setSchemeFocused(true)}
                onBlur={() => setTimeout(() => setSchemeFocused(false), 150)}
              />
              {schemeFocused && (schemeResults.data ?? []).length > 0 ? (
                <View style={styles.dropdown}>
                  <ScrollView
                    nestedScrollEnabled
                    style={{ maxHeight: 220 }}
                    keyboardShouldPersistTaps="handled"
                    showsVerticalScrollIndicator
                  >
                    {(schemeResults.data ?? []).map((s) => (
                      <Pressable key={s.id} onPress={() => setScheme(s)} style={styles.dropdownRow}>
                        <ThemedText variant="body">{s.name}</ThemedText>
                        <ThemedText variant="small" color={colors.muted}>
                          {s.interestRate}% · {s.durationMonths} months
                        </ThemedText>
                      </Pressable>
                    ))}
                  </ScrollView>
                </View>
              ) : null}
            </View>
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
              <DocumentField
                label="Ornament photo"
                hint="Photograph the ornament being pledged"
                value={row.img}
                onChange={(url) => updateRow(i, { img: url })}
                allowPdf={false}
              />
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
          <GoldTextInput
            label="Additional Information (optional)"
            placeholder="Anything else worth recording on this loan…"
            value={additionalInfo}
            onChangeText={setAdditionalInfo}
            multiline
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
      </View>
    </ScreenContainer>  );
}

const styles = StyleSheet.create({
  // Floats over whatever's below in the form rather than pushing it down —
  // `top: "100%"` lands it right under the label+input block it's attached
  // to (see the wrapping `position: "relative"` View above each usage).
  dropdown: {
    position: "absolute",
    top: "100%",
    left: 0,
    right: 0,
    marginTop: -6,
    backgroundColor: colors.card,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.line,
    zIndex: 30,
    ...Platform.select({
      ios: { shadowColor: colors.charcoal, shadowOpacity: 0.15, shadowRadius: 10, shadowOffset: { width: 0, height: 4 } },
      android: { elevation: 6 },
    }),
  },
  dropdownRow: { paddingVertical: 10, paddingHorizontal: 12 },
});
