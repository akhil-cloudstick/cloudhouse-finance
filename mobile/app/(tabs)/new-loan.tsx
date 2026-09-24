import React, { useState } from "react";
import { View, Pressable, RefreshControl, StyleSheet, Platform } from "react-native";
import { GutterScrollView } from "../../src/components/Gutter";
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
import { SearchDropdown } from "../../src/components/SearchDropdown";
import { Icon } from "../../src/components/Icon";
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
// Gross Wt / Less Wt / Net Wt mirror frontend/modules/loans/components/NewLoan.tsx:
// Net = Gross − Less; editing Net derives Less instead. Less Wt is sent as
// deductionWeight, which the backend uses to re-derive NetWeight.
type OrnRow = { name: string; purityUnit: PurityUnit; purityValue: string; grossWeight: string; lessWeight: string; netWeight: string; quantity: string; img: string };

const emptyRow: OrnRow = { name: "", purityUnit: "karat", purityValue: "", grossWeight: "", lessWeight: "", netWeight: "", quantity: "1", img: "" };

const trimNum = (n: number) => String(+n.toFixed(3));

function applyWeightEdit(r: OrnRow, patch: Partial<OrnRow>): OrnRow {
  const next = { ...r, ...patch };
  const gross = Number(next.grossWeight) || 0;
  if ("netWeight" in patch) {
    if (next.netWeight.trim() === "") return { ...next, lessWeight: "" };
    const net = gross > 0 ? Math.min(Number(next.netWeight) || 0, gross) : Number(next.netWeight) || 0;
    return { ...next, netWeight: net === Number(next.netWeight) ? next.netWeight : trimNum(net), lessWeight: gross > 0 ? trimNum(Math.max(0, gross - net)) : "" };
  }
  if ("grossWeight" in patch || "lessWeight" in patch) {
    if (next.grossWeight.trim() === "") return { ...next, netWeight: "" };
    return { ...next, netWeight: trimNum(Math.max(0, gross - (Number(next.lessWeight) || 0))) };
  }
  return next;
}

// Search-or-create against the shared ornament_types catalog (same as the web
// SearchableSelect with allowCreate). createOrnamentType find-or-creates by name.
function OrnamentNameField({
  value,
  onChange,
  open,
  onOpenChange,
}: {
  value: string;
  onChange: (v: string) => void;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const debounced = useDebouncedValue(value);

  const results = useQuery({
    queryKey: ["ornamentTypes", debounced],
    queryFn: () => listOrnamentTypes(debounced || undefined),
    enabled: open,
  });

  const create = useMutation({
    mutationFn: (name: string) => createOrnamentType(name),
    onSuccess: (type) => {
      queryClient.invalidateQueries({ queryKey: ["ornamentTypes"] });
      onChange(type.name);
      onOpenChange(false);
    },
  });

  const trimmed = value.trim();
  const options = results.data ?? [];
  const exactMatch = options.some((t) => t.name.toLowerCase() === trimmed.toLowerCase());

  return (
    <SearchDropdown
      label="Ornament type"
      placeholder="Select or type to add…"
      query={value}
      onQueryChange={onChange}
      open={open}
      onOpenChange={onOpenChange}
      items={options}
      keyOf={(t) => t.id}
      renderItem={(t) => <ThemedText variant="body">{t.name}</ThemedText>}
      onSelect={(t) => onChange(t.name)}
      loading={results.isLoading}
      addLabel={trimmed && !exactMatch ? (create.isPending ? "Adding…" : `+ Add "${trimmed}" as a new ornament type`) : undefined}
      onAdd={() => !create.isPending && create.mutate(trimmed)}
      emptyText="No ornament types yet — type a name to add one"
    />
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

  const [schemeQuery, setSchemeQuery] = useState("");
  const debouncedSchemeQuery = useDebouncedValue(schemeQuery);
  const [scheme, setScheme] = useState<Scheme | null>(null);

  // Only one dropdown open at a time: "customer", "scheme", or "orn-<row index>".
  const [openDropdown, setOpenDropdown] = useState<string | null>(null);
  const dropdownProps = (id: string) => ({
    open: openDropdown === id,
    onOpenChange: (o: boolean) => setOpenDropdown(o ? id : null),
  });

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
    setRows((prev) => prev.map((r, idx) => (idx === i ? applyWeightEdit(r, patch) : r)));
  }
  function addRow() {
    setRows((prev) => [...prev, { ...emptyRow }]);
  }
  function removeRow(i: number) {
    setOpenDropdown(null);
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

  const validRows = rows.filter((r) => r.name.trim() && rowPurity(r) && Number(r.grossWeight) > 0 && Number(r.netWeight) > 0);
  const hasLessExceedsGross = rows.some((r) => Number(r.lessWeight) > Number(r.grossWeight));

  // Per-row gold value = NET weight × quantity × today's rate for that
  // purity — same formula (and same net-not-gross basis) as
  // frontend/modules/loans/components/NewLoan.tsx's rowVals.
  function rowValue(r: OrnRow): number {
    const purity = rowPurity(r);
    const rate = purity ? rateForPurityString(k24, purity) : null;
    if (rate == null) return 0;
    return Number(r.netWeight || 0) * Number(r.quantity || 1) * rate;
  }
  function rowTotalWeight(r: OrnRow): number {
    return Number(r.netWeight || 0) * Number(r.quantity || 1);
  }
  const totalGrossValue = validRows.reduce((sum, r) => sum + rowValue(r), 0);
  const totalNetWeight = validRows.reduce((sum, r) => sum + rowTotalWeight(r), 0);
  const eligibleAmount = scheme ? Math.round((totalGrossValue * scheme.ltvPercent) / 100) : 0;
  const principalExceedsEligible = !!scheme && validRows.length > 0 && Number(principal) > eligibleAmount;

  const canSubmit = !!customer && !!scheme && Number(principal) > 0 && validRows.length > 0 && isTodaySet && !hasLessExceedsGross;

  const submit = useMutation({
    mutationFn: () => {
      const due = new Date();
      due.setMonth(due.getMonth() + (scheme?.durationMonths ?? 0));
      const ornaments: CreateOrnamentInput[] = validRows.map((r) => ({
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
        <View style={{ flex: 1, paddingHorizontal: 8, paddingTop: 20 }}>
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
      <View
        style={{ flex: 1, paddingHorizontal: 8, paddingTop: 20 }}
        onTouchStart={() => {
          if (openDropdown) setOpenDropdown(null);
        }}
      >
      <GutterScrollView
        showsVerticalScrollIndicator={false}
        nestedScrollEnabled={true}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={goldRate.isRefetching} onRefresh={() => goldRate.refetch()} />}
      >
        {!isTodaySet ? (
          <Card style={{ backgroundColor: colors.brandPale, borderColor: colors.brandDeep }}>
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
            <SearchDropdown
              label="Search customer"
              placeholder="Name, phone, or code…"
              query={customerQuery}
              onQueryChange={setCustomerQuery}
              {...dropdownProps("customer")}
              items={customerResults.data ?? []}
              keyOf={(c) => c.id}
              renderItem={(c) => (
                <>
                  <ThemedText variant="body">{c.name}</ThemedText>
                  <ThemedText variant="small" color={colors.muted}>
                    {c.code} · {c.phone}
                  </ThemedText>
                </>
              )}
              onSelect={setCustomer}
              loading={customerResults.isLoading}
              emptyText="No customers found"
            />
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
            </>
          ) : (
            <SearchDropdown
              label="Search scheme"
              placeholder="Scheme name…"
              query={schemeQuery}
              onQueryChange={setSchemeQuery}
              {...dropdownProps("scheme")}
              items={schemeResults.data ?? []}
              keyOf={(s) => s.id}
              renderItem={(s) => (
                <>
                  <ThemedText variant="body">{s.name}</ThemedText>
                  <ThemedText variant="small" color={colors.muted}>
                    {s.interestRate}% · {s.durationMonths} months · LTV {s.ltvPercent}%
                  </ThemedText>
                </>
              )}
              onSelect={setScheme}
              loading={schemeResults.isLoading}
              emptyText="No schemes found"
            />
          )}
        </Card>

        <Card>
          <ThemedText variant="h3" style={{ marginBottom: 8 }}>
            Ornaments
          </ThemedText>
          {rows.map((row, i) => (
            <View key={i} style={{ marginBottom: 12, paddingBottom: 12, borderBottomWidth: i < rows.length - 1 ? 1 : 0, borderBottomColor: colors.line }}>
              <OrnamentNameField value={row.name} onChange={(v) => updateRow(i, { name: v })} {...dropdownProps(`orn-${i}`)} />
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
              <View style={styles.weightRow}>
                <GoldTextInput
                  label="Gross Wt (g)"
                  keyboardType="numeric"
                  placeholder="0.00"
                  value={row.grossWeight}
                  onChangeText={(v) => updateRow(i, { grossWeight: v })}
                  containerStyle={styles.weightCell}
                />
                <GoldTextInput
                  label="Less Wt (g)"
                  keyboardType="numeric"
                  placeholder="0.00"
                  value={row.lessWeight}
                  onChangeText={(v) => updateRow(i, { lessWeight: v })}
                  containerStyle={styles.weightCell}
                  invalid={Number(row.lessWeight) > Number(row.grossWeight)}
                />
                <GoldTextInput
                  label="Net Wt (g)"
                  keyboardType="numeric"
                  placeholder="0.00"
                  value={row.netWeight}
                  onChangeText={(v) => updateRow(i, { netWeight: v })}
                  containerStyle={styles.weightCell}
                />
              </View>
              {Number(row.lessWeight) > Number(row.grossWeight) ? (
                <ThemedText variant="small" color={colors.red} style={{ marginTop: -6, marginBottom: 8 }}>
                  Less Wt cannot be greater than Gross Wt
                </ThemedText>
              ) : null}
              <GoldTextInput label="Quantity" keyboardType="numeric" value={row.quantity} onChangeText={(v) => updateRow(i, { quantity: v })} />
              <DocumentField
                label="Ornament photo"
                hint="Photograph the ornament being pledged"
                value={row.img}
                onChange={(url) => updateRow(i, { img: url })}
                allowPdf={false}
              />
              {row.name.trim() && row.purityValue.trim() && Number(row.grossWeight) > 0 && Number(row.netWeight) > 0 ? (
                <ThemedText variant="small" color={colors.muted} style={{ marginBottom: 8 }}>
                  {rowPurity(row) != null
                    ? `Total Wt: ${rowTotalWeight(row).toFixed(2)}g · Value: ${fmt(rowValue(row))}`
                    : row.purityUnit === "karat"
                      ? "Karat must be between 10 and 24"
                      : "Fineness % must be greater than 0 and at most 100"}
                </ThemedText>
              ) : null}
              {rows.length > 1 ? (
                <Pressable onPress={() => removeRow(i)} hitSlop={8} style={styles.removeBtn} accessibilityLabel="Remove ornament">
                  <View style={{ transform: [{ rotate: "45deg" }] }}>
                    <Icon name="plus" size={16} color={colors.red} />
                  </View>
                </Pressable>
              ) : null}
            </View>
          ))}
          <GoldButton title="+ Add ornament" variant="outline" onPress={addRow} />
        </Card>

        <Card style={{ backgroundColor: colors.brandPale, borderColor: colors.brandDeep }}>
          <ThemedText variant="h3" style={{ marginBottom: 10 }}>
            Eligible Loan Amount
          </ThemedText>
          <View style={styles.summaryRow}>
            <ThemedText variant="small" color={colors.muted}>Total Net Wt</ThemedText>
            <ThemedText variant="small">{totalNetWeight.toFixed(2)} g</ThemedText>
          </View>
          <View style={styles.summaryRow}>
            <ThemedText variant="small" color={colors.muted}>Gold Value</ThemedText>
            <ThemedText variant="small">{fmt(totalGrossValue)}</ThemedText>
          </View>
          <View style={styles.summaryRow}>
            <ThemedText variant="small" color={colors.muted}>LTV</ThemedText>
            <ThemedText variant="small">{scheme ? `${scheme.ltvPercent}%` : "—"}</ThemedText>
          </View>
          <View style={[styles.summaryRow, styles.summaryTotal]}>
            <ThemedText variant="body" style={{ fontWeight: "700" }}>Eligible Amount</ThemedText>
            <ThemedText variant="body" color={colors.brandDeep} style={{ fontWeight: "700" }}>
              {fmt(eligibleAmount)}
            </ThemedText>
          </View>
          {!scheme ? (
            <ThemedText variant="small" color={colors.muted} style={{ marginTop: 6 }}>
              Select a scheme to calculate the eligible amount.
            </ThemedText>
          ) : validRows.length === 0 ? (
            <ThemedText variant="small" color={colors.muted} style={{ marginTop: 6 }}>
              Add an ornament with type, purity and weights to calculate.
            </ThemedText>
          ) : null}
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
          {principalExceedsEligible ? (
            <ThemedText variant="small" color={colors.red} style={{ marginTop: -8, marginBottom: 8 }}>
              Principal is above the eligible amount of {fmt(eligibleAmount)}.
            </ThemedText>
          ) : null}
          {scheme && scheme.serviceChargeType && scheme.serviceChargeType !== "None" ? (() => {
            const p = +principal || eligibleAmount || 0;
            const charge = scheme.serviceChargeType === "Flat" ? (scheme.serviceChargeValue ?? 0) : (p * (scheme.serviceChargeValue ?? 0)) / 100;
            const withheld = scheme.serviceChargeMode === "WithheldFromPayout";
            return (
              <ThemedText variant="small" color={colors.muted} style={{ marginTop: -8, marginBottom: 8 }}>
                Service charge {scheme.serviceChargeType === "Flat" ? fmt(charge) : `${scheme.serviceChargeValue}% (${fmt(charge)})`}
                {" "}{withheld
                  ? `withheld from payout — customer receives ${fmt(Math.max(0, p - charge))}, owes interest on the full ${fmt(p)}.`
                  : `added to principal — customer owes and receives ${fmt(p + charge)} in total. The eligible-amount ceiling above must cover this total.`}
              </ThemedText>
            );
          })() : null}
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
      </GutterScrollView>
      </View>
    </ScreenContainer>  );
}

const styles = StyleSheet.create({
  weightRow: { flexDirection: "row", gap: 8 },
  weightCell: { flex: 1 },
  removeBtn: {
    alignSelf: "flex-end",
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.red,
    alignItems: "center",
    justifyContent: "center",
  },
  summaryRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 4 },
  summaryTotal: { borderTopWidth: 1, borderTopColor: colors.line, marginTop: 6, paddingTop: 10 },
});
