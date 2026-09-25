import React, { useEffect, useState } from "react";
import { useLocalSearchParams } from "expo-router";
import { View, RefreshControl, Pressable, StyleSheet } from "react-native";
import { useQuery, useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ScreenContainer } from "../../../src/components/ScreenContainer";
import { Card } from "../../../src/components/Card";
import { ThemedText } from "../../../src/components/ThemedText";
import { GoldTextInput } from "../../../src/components/GoldTextInput";
import { GoldButton } from "../../../src/components/GoldButton";
import { statusColors, StatusTone } from "../../../src/theme/colors";
import type { Colors } from "../../../src/theme/colors";
import { useTheme, useThemedStyles } from "../../../src/theme/ThemeProvider";
import {
  getCashSummary,
  listCashMovementsPage,
  createCashMovement,
  listExpensesPage,
  createExpense,
  approveExpense,
  rejectExpense,
  listGoldSalesPage,
  createGoldSale,
} from "../../../src/api/cash";
import { CashMovement, Expense, GoldSale } from "../../../src/types/cash";
import { useAuth } from "../../../src/auth/AuthContext";
import { ApiError } from "../../../src/api/client";
import { useRefetchOnFocus, useResetOnBlur } from "../../../src/hooks/useRefetchOnFocus";
import { Loading } from "../../../src/components/Loading";
import { fmt } from "../../../src/lib/format";
import { ExpandableTable, defaultVisibleCount, type TableColumn, type ExtraField } from "../../../src/components/ExpandableTable";

const PAGE_SIZE = 10;

// Three dedicated actions replace the old single "Add cash movement" toggle
// with an in/out chip — mirrors the web Cash module's "Take Cash Out" /
// "Add Cash" / "Gold Sale Amount" action menu (frontend/modules/cash/
// components/Cash.tsx), plus the existing "Record Expense".
type CashAction = "addCash" | "takeCashOut" | "goldSale" | "expense" | null;

function StatusPill({ label, tone }: { label: string; tone: StatusTone }) {
  const { colors } = useTheme();
  const t = statusColors(tone, colors);
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
    // The mode this specific row was recorded in — for a payment split
    // across cash/UPI/bank/cheque, each mode books its own CashMovement
    // row (sharing transactionGroupId), so this is what surfaces that
    // distribution here rather than only a single lump amount.
    { label: "Mode", value: m.mode || "—" },
    { label: "Bank", value: m.bank || "—" },
    { label: "Branch", value: m.branch?.name || "—" },
  ];
}

// --- Two tables on one screen, tab-switched (Cash Movements / Expenses) ---
// used to be two separate routes (/cash/movements, /cash/expenses) reached
// via nav buttons — merged in place per the approved table redesign.
export default function CashScreen() {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const queryClient = useQueryClient();
  const { employee } = useAuth();
  const isAdmin = employee?.role === "Administrator";
  const today = new Date().toISOString().slice(0, 10);

  const [tab, setTab] = useState<"movements" | "expenses" | "goldSales">("movements");

  // Dashboard tiles deep-link here with ?tab=…; `t` re-applies it per tap.
  const params = useLocalSearchParams<{ tab?: string; t?: string }>();
  useEffect(() => {
    if (params.tab === "movements" || params.tab === "expenses" || params.tab === "goldSales") setTab(params.tab);
  }, [params.tab, params.t]);
  const [action, setAction] = useState<CashAction>(null);

  // Add Cash form state (createCashMovement type "in")
  const [mSource, setMSource] = useState("");
  const [mPurpose, setMPurpose] = useState("");
  const [mAmount, setMAmount] = useState("");
  // Expense form state
  const [eCategory, setECategory] = useState("");
  const [eAmount, setEAmount] = useState("");
  const [eMode, setEMode] = useState("");
  const [ePayee, setEPayee] = useState("");
  // Gold Sale form state
  const [gType, setGType] = useState("");
  const [gSold, setGSold] = useState("");
  const [gCost, setGCost] = useState("");
  const [gRemarks, setGRemarks] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  function closeForm() {
    setAction(null);
    setFormError(null);
  }

  const summary = useQuery({
    queryKey: ["cash-summary", employee?.branchId, today],
    queryFn: () => getCashSummary(employee!.branchId, today),
    enabled: !!employee,
  });
  const movements = useInfiniteQuery({
    queryKey: ["cash-movements"],
    queryFn: ({ pageParam = 0 }) => listCashMovementsPage({ limit: PAGE_SIZE, offset: pageParam }),
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) => (lastPage.hasMore ? allPages.length * PAGE_SIZE : undefined),
    enabled: tab === "movements",
  });
  const expenses = useInfiniteQuery({
    queryKey: ["expenses"],
    queryFn: ({ pageParam = 0 }) => listExpensesPage({ limit: PAGE_SIZE, offset: pageParam }),
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) => (lastPage.hasMore ? allPages.length * PAGE_SIZE : undefined),
    enabled: tab === "expenses",
  });
  const goldSales = useInfiniteQuery({
    queryKey: ["gold-sales"],
    queryFn: ({ pageParam = 0 }) => listGoldSalesPage({ limit: PAGE_SIZE, offset: pageParam }),
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) => (lastPage.hasMore ? allPages.length * PAGE_SIZE : undefined),
    enabled: tab === "goldSales",
  });

  useRefetchOnFocus(summary.refetch, movements.refetch, expenses.refetch, goldSales.refetch);

  useResetOnBlur(() => {
    closeForm();
  });

  const movementItems = movements.data?.pages.flatMap((p) => p.items) ?? [];
  const expenseItems = expenses.data?.pages.flatMap((p) => p.items) ?? [];
  const goldSaleItems = goldSales.data?.pages.flatMap((p) => p.items) ?? [];

  const addCash = useMutation({
    mutationFn: () => createCashMovement({ type: "in", source: mSource, purpose: mPurpose, amount: Number(mAmount), bank: undefined }),
    onSuccess: () => {
      setMSource(""); setMPurpose(""); setMAmount(""); closeForm();
      queryClient.invalidateQueries({ queryKey: ["cash-movements"] });
      queryClient.invalidateQueries({ queryKey: ["cash-summary"] });
    },
    onError: (err) => setFormError(err instanceof ApiError ? err.message : "Could not save."),
  });
  const takeCashOut = useMutation({
    mutationFn: () => createCashMovement({ type: "out", source: mSource, purpose: mPurpose, amount: Number(mAmount), bank: undefined }),
    onSuccess: () => {
      setMSource(""); setMPurpose(""); setMAmount(""); closeForm();
      queryClient.invalidateQueries({ queryKey: ["cash-movements"] });
      queryClient.invalidateQueries({ queryKey: ["cash-summary"] });
    },
    onError: (err) => setFormError(err instanceof ApiError ? err.message : "Could not save."),
  });
  const createExp = useMutation({
    mutationFn: () => createExpense({ category: eCategory, amount: Number(eAmount), mode: eMode, payee: ePayee, branchId: employee!.branchId }),
    onSuccess: () => {
      setECategory(""); setEAmount(""); setEMode(""); setEPayee(""); closeForm();
      queryClient.invalidateQueries({ queryKey: ["expenses"] });
      queryClient.invalidateQueries({ queryKey: ["cash-summary"] });
    },
    onError: (err) => setFormError(err instanceof ApiError ? err.message : "Could not save."),
  });
  const createGold = useMutation({
    mutationFn: () =>
      createGoldSale({
        ornamentType: gType,
        soldAmount: Number(gSold),
        costAmount: Number(gCost || 0),
        branchId: employee!.branchId,
        remarks: gRemarks.trim() || undefined,
      }),
    onSuccess: () => {
      setGType(""); setGSold(""); setGCost(""); setGRemarks(""); closeForm();
      queryClient.invalidateQueries({ queryKey: ["gold-sales"] });
      queryClient.invalidateQueries({ queryKey: ["cash-movements"] });
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

  const GOLD_SALE_COLUMNS: TableColumn<GoldSale>[] = [
    { key: "ornamentType", label: "Ornament", render: (g) => g.ornamentType, weight: 1.3 },
    { key: "soldAmount", label: "Sold For", render: (g) => fmt(g.soldAmount) },
    {
      key: "profit",
      label: "Profit/Loss",
      render: (g) => (
        <ThemedText variant="small" color={g.profit >= 0 ? colors.green : colors.red}>
          {g.profit >= 0 ? "+" : "−"}{fmt(Math.abs(g.profit))}
        </ThemedText>
      ),
    },
  ];
  const GOLD_SALE_VISIBLE = Math.min(GOLD_SALE_COLUMNS.length, defaultVisibleCount(GOLD_SALE_COLUMNS.length + 4));
  function goldSaleExtraFields(g: GoldSale): ExtraField[] {
    return [
      { label: "Date", value: fmtDate(g.soldOn) },
      { label: "Cost", value: fmt(g.costAmount) },
      { label: "Branch", value: g.branch?.name || "—" },
      { label: "Remarks", value: g.remarks || "—" },
    ];
  }

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

  // Summary, tab switch, actions and the open form scroll away WITH the table
  // (ExpandableTable's headerContent) — as a fixed block above it they left
  // the table almost no room and the page couldn't scroll.
  const pageHeader = (
    <View>
        <Card>
          <ThemedText variant="h3" style={{ marginBottom: 8 }}>
            Today's cash summary
          </ThemedText>
          {summary.isLoading ? (
            <Loading />
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
              <ThemedText variant="h3" color={colors.brandDeep} style={{ marginTop: 8 }}>
                Expected cash in hand: {fmt(summary.data.expectedCash)}
              </ThemedText>
            </>
          )}
        </Card>

        {/* --- Table tab switch: this screen holds three tables --- */}
        <View style={styles.tableTabs}>
          <Pressable
            onPress={() => { setTab("movements"); closeForm(); }}
            style={[styles.tableTab, tab === "movements" && styles.tableTabOn]}
          >
            <ThemedText variant="small" numberOfLines={1} color={tab === "movements" ? colors.card : colors.muted}>
              Movements
            </ThemedText>
          </Pressable>
          <Pressable
            onPress={() => { setTab("expenses"); closeForm(); }}
            style={[styles.tableTab, tab === "expenses" && styles.tableTabOn]}
          >
            <ThemedText variant="small" numberOfLines={1} color={tab === "expenses" ? colors.card : colors.muted}>
              Expenses
            </ThemedText>
          </Pressable>
          <Pressable
            onPress={() => { setTab("goldSales"); closeForm(); }}
            style={[styles.tableTab, tab === "goldSales" && styles.tableTabOn]}
          >
            <ThemedText variant="small" numberOfLines={1} color={tab === "goldSales" ? colors.card : colors.muted}>
              Gold Sales
            </ThemedText>
          </Pressable>
        </View>

        {/* --- Actions: a dedicated button per action, matching the web's
         * "Take Cash Out" / "Add Cash" / "Gold Sale Amount" / "Record
         * Expense" set — rather than one generic form with an in/out toggle. */}
        <View style={styles.actionRow}>
          <Pressable style={styles.actionBtn} onPress={() => setAction((a) => (a === "addCash" ? null : "addCash"))}>
            <ThemedText variant="small" color={colors.brandDeep}>Add Cash</ThemedText>
          </Pressable>
          <Pressable style={styles.actionBtn} onPress={() => setAction((a) => (a === "takeCashOut" ? null : "takeCashOut"))}>
            <ThemedText variant="small" color={colors.brandDeep}>Take Cash Out</ThemedText>
          </Pressable>
          <Pressable style={styles.actionBtn} onPress={() => setAction((a) => (a === "goldSale" ? null : "goldSale"))}>
            <ThemedText variant="small" color={colors.brandDeep}>Gold Sale</ThemedText>
          </Pressable>
          <Pressable style={styles.actionBtn} onPress={() => setAction((a) => (a === "expense" ? null : "expense"))}>
            <ThemedText variant="small" color={colors.brandDeep}>Record Expense</ThemedText>
          </Pressable>
        </View>

        {action === "addCash" || action === "takeCashOut" ? (
          <Card>
            <ThemedText variant="h3" style={{ marginBottom: 8 }}>
              {action === "addCash" ? "Add Cash" : "Take Cash Out"}
            </ThemedText>
            <GoldTextInput label="Source / Purpose" value={mSource} onChangeText={setMSource} />
            <GoldTextInput label="Purpose" value={mPurpose} onChangeText={setMPurpose} />
            <GoldTextInput label="Amount" keyboardType="numeric" value={mAmount} onChangeText={setMAmount} />
            {formError ? <ThemedText variant="small" color={colors.red} style={{ marginBottom: 8 }}>{formError}</ThemedText> : null}
            <GoldButton
              title="Save"
              onPress={() => (action === "addCash" ? addCash.mutate() : takeCashOut.mutate())}
              loading={action === "addCash" ? addCash.isPending : takeCashOut.isPending}
              disabled={!mSource || !mPurpose || !mAmount}
            />
          </Card>
        ) : null}

        {action === "expense" ? (
          <Card>
            <ThemedText variant="h3" style={{ marginBottom: 8 }}>Record Expense</ThemedText>
            <GoldTextInput label="Category" value={eCategory} onChangeText={setECategory} />
            <GoldTextInput label="Amount" keyboardType="numeric" value={eAmount} onChangeText={setEAmount} />
            <GoldTextInput label="Mode (Cash/UPI/...)" value={eMode} onChangeText={setEMode} />
            <GoldTextInput label="Payee" value={ePayee} onChangeText={setEPayee} />
            {formError ? <ThemedText variant="small" color={colors.red} style={{ marginBottom: 8 }}>{formError}</ThemedText> : null}
            <GoldButton title="Save" onPress={() => createExp.mutate()} loading={createExp.isPending} disabled={!eCategory || !eAmount || !eMode || !ePayee} />
          </Card>
        ) : null}

        {action === "goldSale" ? (
          <Card>
            <ThemedText variant="h3" style={{ marginBottom: 8 }}>Gold Sale Amount</ThemedText>
            <GoldTextInput label="Ornament Type" value={gType} onChangeText={setGType} placeholder="e.g. Chain, Bangle, Studs" />
            <GoldTextInput label="Sold For (₹)" keyboardType="numeric" value={gSold} onChangeText={setGSold} />
            <GoldTextInput label="Cost to Acquire (₹)" keyboardType="numeric" value={gCost} onChangeText={setGCost} />
            <GoldTextInput label="Remarks (optional)" value={gRemarks} onChangeText={setGRemarks} />
            {formError ? <ThemedText variant="small" color={colors.red} style={{ marginBottom: 8 }}>{formError}</ThemedText> : null}
            <GoldButton title="Save" onPress={() => createGold.mutate()} loading={createGold.isPending} disabled={!gType || !gSold} />
          </Card>
        ) : null}
    </View>
  );

  return (
    <ScreenContainer style={{ padding: 0 }}>
      {tab === "movements" ? (
        <View style={{ flex: 1, paddingHorizontal: 16, paddingTop: 20 }}>
          <ExpandableTable<CashMovement>
            columns={MOVEMENT_COLUMNS}
            visibleCount={MOVEMENT_VISIBLE}
            data={movementItems}
            keyExtractor={(m) => String(m.id)}
            extraFields={movementExtraFields}
            loading={movements.isLoading}
            emptyText={movements.isError ? "Could not load cash movements." : "No movements yet."}
            refreshControl={
              <RefreshControl
                refreshing={summary.isRefetching || (movements.isRefetching && !movements.isFetchingNextPage)}
                onRefresh={() => { summary.refetch(); movements.refetch(); }}
              />
            }
            onEndReached={() => {
              if (movements.hasNextPage && !movements.isFetchingNextPage) movements.fetchNextPage();
            }}
            isFetchingNextPage={movements.isFetchingNextPage}
            headerContent={pageHeader}
          />
        </View>
      ) : tab === "expenses" ? (
        <View style={{ flex: 1, paddingHorizontal: 16, paddingTop: 20 }}>
          <ExpandableTable<Expense>
            columns={EXPENSE_COLUMNS}
            visibleCount={EXPENSE_VISIBLE}
            data={expenseItems}
            keyExtractor={(e) => String(e.id)}
            extraFields={expenseExtraFields}
            loading={expenses.isLoading}
            emptyText={expenses.isError ? "Could not load expenses." : "No expenses yet."}
            refreshControl={
              <RefreshControl
                refreshing={summary.isRefetching || (expenses.isRefetching && !expenses.isFetchingNextPage)}
                onRefresh={() => { summary.refetch(); expenses.refetch(); }}
              />
            }
            onEndReached={() => {
              if (expenses.hasNextPage && !expenses.isFetchingNextPage) expenses.fetchNextPage();
            }}
            isFetchingNextPage={expenses.isFetchingNextPage}
            headerContent={pageHeader}
          />
        </View>
      ) : (
        <View style={{ flex: 1, paddingHorizontal: 16, paddingTop: 20 }}>
          <ExpandableTable<GoldSale>
            columns={GOLD_SALE_COLUMNS}
            visibleCount={GOLD_SALE_VISIBLE}
            data={goldSaleItems}
            keyExtractor={(g) => String(g.id)}
            extraFields={goldSaleExtraFields}
            loading={goldSales.isLoading}
            emptyText={goldSales.isError ? "Could not load gold sales." : 'No gold sales recorded yet. Use "Gold Sale".'}
            refreshControl={
              <RefreshControl
                refreshing={summary.isRefetching || (goldSales.isRefetching && !goldSales.isFetchingNextPage)}
                onRefresh={() => { summary.refetch(); goldSales.refetch(); }}
              />
            }
            onEndReached={() => {
              if (goldSales.hasNextPage && !goldSales.isFetchingNextPage) goldSales.fetchNextPage();
            }}
            isFetchingNextPage={goldSales.isFetchingNextPage}
            headerContent={pageHeader}
          />
        </View>
      )}
    </ScreenContainer>
  );
}

const makeStyles = (c: Colors) => StyleSheet.create({
  tableTabs: { flexDirection: "row", gap: 8, marginTop: 4, marginBottom: 12 },
  tableTab: {
    flex: 1,
    alignItems: "center",
    paddingVertical: 9,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: c.line,
    backgroundColor: c.card,
  },
  tableTabOn: { backgroundColor: c.brandDeep, borderColor: c.brandDeep },
  actionRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 12 },
  actionBtn: {
    borderWidth: 1,
    borderColor: c.brandDeep,
    backgroundColor: c.brandPale,
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  smallApprove: { backgroundColor: c.green, borderRadius: 7, paddingHorizontal: 10, paddingVertical: 6 },
  smallReject: { borderWidth: 1, borderColor: c.red, borderRadius: 7, paddingHorizontal: 10, paddingVertical: 6 },
});
