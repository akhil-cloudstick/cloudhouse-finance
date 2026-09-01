import React, { useState } from "react";
import { View, ScrollView, RefreshControl, Pressable, StyleSheet } from "react-native";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ScreenContainer } from "../../../src/components/ScreenContainer";
import { Card } from "../../../src/components/Card";
import { ThemedText } from "../../../src/components/ThemedText";
import { GoldTextInput } from "../../../src/components/GoldTextInput";
import { GoldButton } from "../../../src/components/GoldButton";
import { Pager } from "../../../src/components/Pager";
import { ChipSelect } from "../../../src/components/ChipSelect";
import { colors, statusColors, StatusTone } from "../../../src/theme/colors";
import { getCashSummary, listCashMovementsPage, createCashMovement, listExpensesPage, createExpense, approveExpense, rejectExpense } from "../../../src/api/cash";
import { CashMovement, Expense } from "../../../src/types/cash";
import { useAuth } from "../../../src/auth/AuthContext";
import { ApiError } from "../../../src/api/client";
import { useRefetchOnFocus } from "../../../src/hooks/useRefetchOnFocus";
import { fmt } from "../../../src/lib/format";
import { ExpandableTable, defaultVisibleCount, type TableColumn, type ExtraField } from "../../../src/components/ExpandableTable";

const PAGE_SIZE = 10;
const MOVEMENT_TYPES = ["in", "out"] as const;

function StatusPill({ label, tone }: { label: string; tone: StatusTone }) {
  const t = statusColors(tone);
  return (
    <ThemedText
      variant="label"
      numberOfLines={1}
      style={{ backgroundColor: t.bg, color: t.fg, paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6, alignSelf: "flex-start", fontSize: 11.5 }}
    >
      {label}
    </ThemedText>
  );
}

function fmtDate(d: string) {
  return new Date(d).toLocaleDateString("en-IN");
}

const MOVEMENT_COLUMNS: TableColumn<CashMovement>[] = [
  { key: "amount", label: "Amount", render: (m) => fmt(m.amount) },
  { key: "type", label: "Type", render: (m) => <StatusPill label={`Cash ${m.type}`} tone={m.type === "in" ? "green" : "amber"} /> },
  { key: "purpose", label: "Purpose", render: (m) => m.purpose, weight: 1.4 },
];
// 3 columns + 4 detail-only fields (Date/Source/Bank/Branch) = 7 total —
// "large", but there are only 3 columns to begin with, so all 3 stay
// visible either way (defaultVisibleCount only ever trims, never adds).
const MOVEMENT_VISIBLE = Math.min(MOVEMENT_COLUMNS.length, defaultVisibleCount(MOVEMENT_COLUMNS.length + 4));
function movementExtraFields(m: CashMovement) {
  return [
    { label: "Date", value: fmtDate(m.occurredOn) },
    { label: "Source", value: m.source },
    { label: "Bank", value: m.bank || "—" },
    { label: "Branch", value: m.branch?.name || "—" },
  ];
}

// --- Two tables on one screen, tab-switched (Cash Movements / Expenses) ---
// used to be two separate routes (/cash/movements, /cash/expenses) reached
// via nav buttons — merged in place per the approved table redesign.
export default function CashScreen() {
  const queryClient = useQueryClient();
  const { employee } = useAuth();
  const isAdmin = employee?.role === "Administrator";
  const today = new Date().toISOString().slice(0, 10);

  const [tab, setTab] = useState<"movements" | "expenses">("movements");
  const [showForm, setShowForm] = useState(false);
  const [movementsPage, setMovementsPage] = useState(1);
  const [expensesPage, setExpensesPage] = useState(1);

  // Movement form state
  const [mType, setMType] = useState<(typeof MOVEMENT_TYPES)[number]>("in");
  const [mSource, setMSource] = useState("");
  const [mPurpose, setMPurpose] = useState("");
  const [mAmount, setMAmount] = useState("");
  // Expense form state
  const [eCategory, setECategory] = useState("");
  const [eAmount, setEAmount] = useState("");
  const [eMode, setEMode] = useState("");
  const [ePayee, setEPayee] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  const summary = useQuery({
    queryKey: ["cash-summary", employee?.branchId, today],
    queryFn: () => getCashSummary(employee!.branchId, today),
    enabled: !!employee,
  });
  const movements = useQuery({
    queryKey: ["cash-movements", movementsPage],
    queryFn: () => listCashMovementsPage({ limit: PAGE_SIZE, offset: (movementsPage - 1) * PAGE_SIZE }),
    enabled: tab === "movements",
  });
  const expenses = useQuery({
    queryKey: ["expenses", expensesPage],
    queryFn: () => listExpensesPage({ limit: PAGE_SIZE, offset: (expensesPage - 1) * PAGE_SIZE }),
    enabled: tab === "expenses",
  });

  useRefetchOnFocus(summary.refetch, movements.refetch, expenses.refetch);

  const movementItems = movements.data?.items ?? [];
  const expenseItems = expenses.data?.items ?? [];

  const createMovement = useMutation({
    mutationFn: () => createCashMovement({ type: mType, source: mSource, purpose: mPurpose, amount: Number(mAmount), bank: undefined }),
    onSuccess: () => {
      setMSource(""); setMPurpose(""); setMAmount(""); setShowForm(false); setFormError(null);
      setMovementsPage(1);
      queryClient.invalidateQueries({ queryKey: ["cash-movements"] });
      queryClient.invalidateQueries({ queryKey: ["cash-summary"] });
    },
    onError: (err) => setFormError(err instanceof ApiError ? err.message : "Could not save."),
  });
  const createExp = useMutation({
    mutationFn: () => createExpense({ category: eCategory, amount: Number(eAmount), mode: eMode, payee: ePayee, branchId: employee!.branchId }),
    onSuccess: () => {
      setECategory(""); setEAmount(""); setEMode(""); setEPayee(""); setShowForm(false); setFormError(null);
      setExpensesPage(1);
      queryClient.invalidateQueries({ queryKey: ["expenses"] });
      queryClient.invalidateQueries({ queryKey: ["cash-summary"] });
    },
    onError: (err) => setFormError(err instanceof ApiError ? err.message : "Could not save."),
  });
  const approve = useMutation({
    mutationFn: (id: number) => approveExpense(id, employee?.name),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["expenses"] }),
  });
  const reject = useMutation({
    mutationFn: (id: number) => rejectExpense(id, "Rejected from mobile app", employee?.name),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["expenses"] }),
  });

  const EXPENSE_COLUMNS: TableColumn<Expense>[] = [
    { key: "amount", label: "Amount", render: (e) => fmt(e.amount) },
    { key: "status", label: "Status", render: (e) => <StatusPill label={e.status} tone={e.status === "Approved" ? "green" : e.status === "Rejected" ? "red" : "amber"} /> },
    { key: "category", label: "Category", render: (e) => e.category, weight: 1.4 },
  ];
  const EXPENSE_VISIBLE = Math.min(EXPENSE_COLUMNS.length, defaultVisibleCount(EXPENSE_COLUMNS.length + 4));
  function expenseExtraFields(e: Expense): ExtraField[] {
    const fields: ExtraField[] = [
      { label: "Date", value: fmtDate(e.occurredOn) },
      { label: "Payee", value: e.payee },
      { label: "Mode", value: e.mode },
      { label: "Branch", value: e.branch?.name || "—" },
    ];
    // Admin approve/reject lives inline in the expand strip rather than
    // behind a "View Description" button — there's no per-expense detail
    // screen to navigate to, this IS the detail.
    if (isAdmin && e.status === "Pending") {
      fields.push({
        label: "Action",
        value: (
          <View style={{ flexDirection: "row", gap: 8, marginTop: 2 }}>
            <Pressable onPress={() => approve.mutate(e.id)} style={styles.smallApprove}>
              <ThemedText variant="small" color={colors.card}>Approve</ThemedText>
            </Pressable>
            <Pressable onPress={() => reject.mutate(e.id)} style={styles.smallReject}>
              <ThemedText variant="small" color={colors.red}>Reject</ThemedText>
            </Pressable>
          </View>
        ),
      });
    }
    return fields;
  }

  return (
    <ScreenContainer style={{ padding: 0 }}>
      <View style={{ flex: 1, paddingHorizontal: 16, paddingTop: 16 }}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={summary.isRefetching} onRefresh={summary.refetch} />}
      >
        <Card>
          <ThemedText variant="h3" style={{ marginBottom: 8 }}>
            Today's cash summary
          </ThemedText>
          {summary.isLoading ? (
            <ThemedText color={colors.muted}>Loading…</ThemedText>
          ) : summary.isError || !summary.data ? (
            <ThemedText color={colors.red}>Could not load today's summary.</ThemedText>
          ) : (
            <>
              <ThemedText variant="body">Opening cash: {fmt(summary.data.openingCash)}</ThemedText>
              <ThemedText variant="body" color={colors.green}>
                Cash in: {fmt(summary.data.collections)}
              </ThemedText>
              <ThemedText variant="body">Cash out: {fmt(summary.data.disbursements)}</ThemedText>
              <ThemedText variant="body">Expenses (cash): {fmt(summary.data.cashExpenses)}</ThemedText>
              <ThemedText variant="h3" color={colors.goldDeep} style={{ marginTop: 8 }}>
                Expected cash in hand: {fmt(summary.data.expectedCash)}
              </ThemedText>
            </>
          )}
        </Card>

        {/* --- Table tab switch: this screen holds two tables --- */}
        <View style={styles.tableTabs}>
          <Pressable
            onPress={() => { setTab("movements"); setShowForm(false); setFormError(null); }}
            style={[styles.tableTab, tab === "movements" && styles.tableTabOn]}
          >
            <ThemedText variant="small" numberOfLines={1} color={tab === "movements" ? colors.card : colors.muted}>
              Cash Movements
            </ThemedText>
          </Pressable>
          <Pressable
            onPress={() => { setTab("expenses"); setShowForm(false); setFormError(null); }}
            style={[styles.tableTab, tab === "expenses" && styles.tableTabOn]}
          >
            <ThemedText variant="small" numberOfLines={1} color={tab === "expenses" ? colors.card : colors.muted}>
              Expenses
            </ThemedText>
          </Pressable>
        </View>

        <GoldButton
          title={showForm ? "Cancel" : tab === "movements" ? "Add cash movement" : "Add expense"}
          variant="outline"
          onPress={() => setShowForm((v) => !v)}
          style={{ marginBottom: 12 }}
        />

        {showForm ? (
          <Card>
            {tab === "movements" ? (
              <>
                <ChipSelect label="Type" options={MOVEMENT_TYPES} value={mType} onChange={setMType} />
                <GoldTextInput label="Source" value={mSource} onChangeText={setMSource} />
                <GoldTextInput label="Purpose" value={mPurpose} onChangeText={setMPurpose} />
                <GoldTextInput label="Amount" keyboardType="numeric" value={mAmount} onChangeText={setMAmount} />
                {formError ? <ThemedText variant="small" color={colors.red} style={{ marginBottom: 8 }}>{formError}</ThemedText> : null}
                <GoldButton title="Save" onPress={() => createMovement.mutate()} loading={createMovement.isPending} disabled={!mSource || !mPurpose || !mAmount} />
              </>
            ) : (
              <>
                <GoldTextInput label="Category" value={eCategory} onChangeText={setECategory} />
                <GoldTextInput label="Amount" keyboardType="numeric" value={eAmount} onChangeText={setEAmount} />
                <GoldTextInput label="Mode (Cash/UPI/...)" value={eMode} onChangeText={setEMode} />
                <GoldTextInput label="Payee" value={ePayee} onChangeText={setEPayee} />
                {formError ? <ThemedText variant="small" color={colors.red} style={{ marginBottom: 8 }}>{formError}</ThemedText> : null}
                <GoldButton title="Save" onPress={() => createExp.mutate()} loading={createExp.isPending} disabled={!eCategory || !eAmount || !eMode || !ePayee} />
              </>
            )}
          </Card>
        ) : null}

        {tab === "movements" ? (
          <>
            <ExpandableTable<CashMovement>
              columns={MOVEMENT_COLUMNS}
              visibleCount={MOVEMENT_VISIBLE}
              data={movementItems}
              keyExtractor={(m) => String(m.id)}
              extraFields={movementExtraFields}
              emptyText={movements.isLoading ? "Loading…" : movements.isError ? "Could not load cash movements." : "No movements yet."}
            />
            <Pager page={movementsPage} hasMore={!!movements.data?.hasMore} onChange={setMovementsPage} loading={movements.isFetching} />
          </>
        ) : (
          <>
            <ExpandableTable<Expense>
              columns={EXPENSE_COLUMNS}
              visibleCount={EXPENSE_VISIBLE}
              data={expenseItems}
              keyExtractor={(e) => String(e.id)}
              extraFields={expenseExtraFields}
              emptyText={expenses.isLoading ? "Loading…" : expenses.isError ? "Could not load expenses." : "No expenses yet."}
            />
            <Pager page={expensesPage} hasMore={!!expenses.data?.hasMore} onChange={setExpensesPage} loading={expenses.isFetching} />
          </>
        )}
      </ScrollView>
      </View>
    </ScreenContainer>  );
}

const styles = StyleSheet.create({
  tableTabs: { flexDirection: "row", gap: 8, marginTop: 4, marginBottom: 12 },
  tableTab: {
    flex: 1,
    alignItems: "center",
    paddingVertical: 9,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.card,
  },
  tableTabOn: { backgroundColor: colors.goldDeep, borderColor: colors.goldDeep },
  smallApprove: { backgroundColor: colors.green, borderRadius: 7, paddingHorizontal: 10, paddingVertical: 6 },
  smallReject: { borderWidth: 1, borderColor: colors.red, borderRadius: 7, paddingHorizontal: 10, paddingVertical: 6 },
});
