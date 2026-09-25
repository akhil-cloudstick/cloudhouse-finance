import React, { useState } from "react";
import { RefreshControl, View, Pressable } from "react-native";
import { useRouter } from "expo-router";
import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ScreenContainer } from "../../../src/components/ScreenContainer";
import { ThemedText } from "../../../src/components/ThemedText";
import { GoldTextInput } from "../../../src/components/GoldTextInput";
import { GoldButton } from "../../../src/components/GoldButton";
import { ChipSelect } from "../../../src/components/ChipSelect";
import { BottomSheetModal, SheetScrollView } from "../../../src/components/BottomSheetModal";
import { colors } from "../../../src/theme/colors";
import { useTheme } from "../../../src/theme/ThemeProvider";
import { createBank } from "../../../src/api/banks";
import {
  listBankPledgedLoansPage,
  listBankPledgeHistoryPage,
  releaseBankPledge,
  voidBankPledge,
  type BankPledgeHistoryRow,
  type BankPledgeRecordWithWeights,
} from "../../../src/api/bankPledges";
import { Loan } from "../../../src/types/loan";
import { useDebouncedValue } from "../../../src/hooks/useDebouncedValue";
import { ApiError } from "../../../src/api/client";
import { useRefetchOnFocus, useResetOnBlur } from "../../../src/hooks/useRefetchOnFocus";
import { useAuth } from "../../../src/auth/AuthContext";
import { fmt, fmtDate } from "../../../src/lib/format";
import { ExpandableTable, type TableColumn } from "../../../src/components/ExpandableTable";

const PAGE_SIZE = 10;
const TABS = ["Active", "History"] as const;
type Tab = (typeof TABS)[number];

// Mirrors the server-side guard on PUT /loans/:id/bank-pledge/:pledgeId/void
// (and web BankPledge.tsx) — hiding the button is a convenience, the backend
// rejects other roles regardless.
const VOID_ROLES = ["Administrator", "Management", "Branch Manager"];

const or = (v?: string | null) => (v && v.trim() ? v : "—");
const errMsg = (e: unknown, fallback: string) => (e instanceof ApiError ? e.message : fallback);
const cashLabel = (t?: string) => (t === "CashIn" ? "Cash Added" : "Record Only");
// "Voided" stays the wire value; the UI calls it "Deleted" (matches web).
const statusLabel = (s: string) => (s === "Voided" ? "Deleted" : s);
const statusColor = (s: string) => (s === "Voided" ? colors.red : s === "Active" ? colors.green : colors.ink);

type PledgeTarget = { loanId: number; loanNumber: string; pledge: BankPledgeRecordWithWeights };

function activePledgeOf(l: Loan): BankPledgeRecordWithWeights | undefined {
  return l.bankPledges?.find((p) => p.status === "Active");
}

const ACTIVE_COLUMNS: TableColumn<Loan>[] = [
  { key: "loan", label: "Loan", render: (l) => l.loanNumber },
  { key: "customer", label: "Customer", render: (l) => or(l.customer?.name), weight: 1.3 },
  {
    key: "amount",
    label: "Amount",
    render: (l) => {
      const p = activePledgeOf(l);
      return p ? fmt(p.pledgedAmount) : "—";
    },
  },
];

const HISTORY_COLUMNS: TableColumn<BankPledgeHistoryRow>[] = [
  { key: "loan", label: "Loan", render: (r) => r.loanNumber || `#${r.loanId}` },
  { key: "bank", label: "Bank", render: (r) => or(r.bankName), weight: 1.3 },
  {
    key: "status",
    label: "Status",
    render: (r) => (
      <ThemedText variant="small" color={statusColor(r.status)}>
        {statusLabel(r.status)}
      </ThemedText>
    ),
  },
];

function historyExtraFields(r: BankPledgeHistoryRow) {
  const fields = [
    { label: "Customer", value: or(r.customerName) },
    { label: "Amount", value: fmt(r.pledgedAmount) },
    { label: "Cash", value: cashLabel(r.cashTreatment) },
    { label: "Pledged", value: fmtDate(r.pledgeDate) },
    { label: "Released", value: fmtDate(r.releaseDate) },
  ];
  if (r.status === "Voided") fields.push({ label: "Delete reason", value: or(r.voidReason) });
  return fields;
}

// Staff-facing list of loans re-pledged with external banks (Active) plus
// every pledge ever recorded (History) — ported from the web's
// frontend/modules/loans/components/BankPledge.tsx. Recording a new pledge
// still happens from the loan's own detail screen (loans/[id].tsx).
export default function BankPledgeScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { can, employee } = useAuth();
  const canUpdatePledges = can("Bank_Pledge_Management", "can_update_bank_pledge");
  const canVoid = canUpdatePledges && !!employee?.role && VOID_ROLES.includes(employee.role);
  const canCreateBanks = can("Bank_Management", "can_create_bank");

  const [tab, setTab] = useState<Tab>("Active");
  const [search, setSearch] = useState("");
  const q = useDebouncedValue(search).trim();

  const [releaseTarget, setReleaseTarget] = useState<PledgeTarget | null>(null);
  const [releaseError, setReleaseError] = useState<string | null>(null);
  const [voidTarget, setVoidTarget] = useState<PledgeTarget | null>(null);
  const [voidReason, setVoidReason] = useState("");
  const [voidError, setVoidError] = useState<string | null>(null);

  const [addVisible, setAddVisible] = useState(false);
  const [name, setName] = useState("");
  const [ifsc, setIfsc] = useState("");
  const [accountNo, setAccountNo] = useState("");
  const [phone, setPhone] = useState("");
  const [bankError, setBankError] = useState<string | null>(null);

  const active = useInfiniteQuery({
    queryKey: ["bankPledges", "active", q],
    queryFn: ({ pageParam = 0 }) => listBankPledgedLoansPage({ q: q || undefined, limit: PAGE_SIZE, offset: pageParam }),
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) => (lastPage.hasMore ? allPages.length * PAGE_SIZE : undefined),
    enabled: tab === "Active",
  });
  const history = useInfiniteQuery({
    queryKey: ["bankPledges", "history", q],
    queryFn: ({ pageParam = 0 }) => listBankPledgeHistoryPage({ q: q || undefined, limit: PAGE_SIZE, offset: pageParam }),
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) => (lastPage.hasMore ? allPages.length * PAGE_SIZE : undefined),
    enabled: tab === "History",
  });
  const current = tab === "Active" ? active : history;

  useRefetchOnFocus(current.refetch);

  useResetOnBlur(() => {
    setReleaseTarget(null);
    setReleaseError(null);
    setVoidTarget(null);
    setVoidError(null);
    setAddVisible(false);
  });

  const loans = active.data?.pages.flatMap((p) => p.items) ?? [];
  const records = history.data?.pages.flatMap((p) => p.items) ?? [];

  // A release/void changes the loan, its packet location and (for CashIn)
  // the till — refresh every screen that shows any of those.
  function invalidateAfterChange() {
    for (const key of ["bankPledges", "bankPledgeHistory", "loan", "loans", "loanPacket", "packet", "packets", "cash-summary", "cash-movements"]) {
      queryClient.invalidateQueries({ queryKey: [key] });
    }
  }

  const release = useMutation({
    mutationFn: (t: PledgeTarget) => releaseBankPledge(t.loanId, t.pledge.id),
    onSuccess: () => {
      setReleaseTarget(null);
      invalidateAfterChange();
    },
    onError: (err) => setReleaseError(errMsg(err, "Could not release the pledge.")),
  });

  const voidPledge = useMutation({
    mutationFn: (t: PledgeTarget) => voidBankPledge(t.loanId, t.pledge.id, voidReason.trim()),
    onSuccess: () => {
      setVoidTarget(null);
      setVoidReason("");
      invalidateAfterChange();
    },
    onError: (err) => setVoidError(errMsg(err, "Could not delete the pledge entry — try again.")),
  });

  function openRelease(t: PledgeTarget) {
    setReleaseError(null);
    setReleaseTarget(t);
  }
  function openVoid(t: PledgeTarget) {
    setVoidError(null);
    setVoidReason("");
    setVoidTarget(t);
  }

  function activeExtraFields(l: Loan) {
    const p = activePledgeOf(l);
    const weight = p?.pledgedNetWeight || l.totalNetWeight;
    const fields: { label: string; value: React.ReactNode }[] = [
      { label: "Bank", value: or(p?.bankName) },
      { label: "Weight", value: weight ? `${weight.toFixed(2)} g` : "—" },
      { label: "Cash", value: p ? cashLabel(p.cashTreatment) : "—" },
      { label: "Pledged On", value: fmtDate(p?.pledgeDate) },
      { label: "Due date", value: fmtDate(p?.bankPledgeDueDate) },
      { label: "Ref no", value: or(p?.referenceNumber) },
    ];
    if (p && (canUpdatePledges || canVoid)) {
      const target = { loanId: l.id, loanNumber: l.loanNumber, pledge: p };
      fields.push({
        label: "Actions",
        value: (
          <View style={{ flexDirection: "row", gap: 8, marginTop: 4 }}>
            {canUpdatePledges ? (
              <GoldButton
                title="Release"
                variant="outline"
                onPress={() => openRelease(target)}
                style={{ height: 36, paddingHorizontal: 14 }}
              />
            ) : null}
            {canVoid ? (
              <GoldButton
                title="Delete"
                variant="outline"
                onPress={() => openVoid(target)}
                style={{ height: 36, paddingHorizontal: 14, borderColor: colors.red }}
              />
            ) : null}
          </View>
        ),
      });
    }
    return fields;
  }

  function resetBank() {
    setName("");
    setIfsc("");
    setAccountNo("");
    setPhone("");
    setBankError(null);
  }

  const create = useMutation({
    mutationFn: () =>
      createBank({
        name,
        ifsc: ifsc || undefined,
        accountNo: accountNo || undefined,
        phone: phone || undefined,
      }),
    onSuccess: () => {
      resetBank();
      setAddVisible(false);
      queryClient.invalidateQueries({ queryKey: ["banks"] });
      queryClient.invalidateQueries({ queryKey: ["banks-all"] });
    },
    onError: (err) => setBankError(errMsg(err, "Could not save.")),
  });

  const listError = current.isError ? errMsg(current.error, "Could not load bank pledges.") : null;
  const refreshControl = (
    <RefreshControl
      refreshing={current.isFetching && !current.isFetchingNextPage && !current.isLoading}
      onRefresh={current.refetch}
    />
  );
  const onEndReached = () => {
    if (current.hasNextPage && !current.isFetchingNextPage) current.fetchNextPage();
  };

  // Scrolls away with the rows (both tables' headerContent) so the table's
  // top fade sits right under the app header.
  const listHeader = (
      <View style={{ paddingTop: 20 }}>
        <GoldTextInput label="Search loan no, bank, customer" value={search} onChangeText={setSearch} />
        <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 8 }}>
          <View style={{ flex: 1 }}>
            <ChipSelect options={TABS} value={tab} onChange={setTab} />
          </View>
          {canCreateBanks ? (
            <GoldButton
              title="Add Bank"
              icon="plus"
              variant="outline"
              onPress={() => setAddVisible(true)}
              style={{ height: 36, paddingHorizontal: 12 }}
            />
          ) : null}
        </View>
        {listError ? (
          <ThemedText variant="small" color={colors.red} style={{ marginBottom: 8 }}>
            {listError}
          </ThemedText>
        ) : null}
      </View>
  );

  return (
    <ScreenContainer style={{ paddingHorizontal: 0 }}>
      <View style={{ flex: 1, paddingHorizontal: 16 }}>
        {tab === "Active" ? (
          <ExpandableTable<Loan>
            headerContent={listHeader}
            columns={ACTIVE_COLUMNS}
            visibleCount={ACTIVE_COLUMNS.length}
            data={loans}
            keyExtractor={(l) => String(l.id)}
            extraFields={activeExtraFields}
            onViewDescription={(l) => router.push(`/loans/${l.id}`)}
            loading={active.isLoading}
            emptyText={active.isError ? "Could not load pledges." : "No loans currently bank-pledged."}
            refreshControl={refreshControl}
            onEndReached={onEndReached}
            isFetchingNextPage={active.isFetchingNextPage}
          />
        ) : (
          <ExpandableTable<BankPledgeHistoryRow>
            headerContent={listHeader}
            columns={HISTORY_COLUMNS}
            visibleCount={HISTORY_COLUMNS.length}
            data={records}
            keyExtractor={(r) => String(r.id)}
            extraFields={historyExtraFields}
            onViewDescription={(r) => router.push(`/loans/${r.loanId}`)}
            loading={history.isLoading}
            emptyText={history.isError ? "Could not load history." : "No re-pledge records yet."}
            refreshControl={refreshControl}
            onEndReached={onEndReached}
            isFetchingNextPage={history.isFetchingNextPage}
          />
        )}
      </View>

      <BottomSheetModal visible={!!releaseTarget} onClose={() => setReleaseTarget(null)}>
        {releaseTarget ? (
          <>
            <ThemedText variant="h3" color={colors.brandDeep} style={{ marginBottom: 8 }}>
              Release Bank Pledge
            </ThemedText>
            <ThemedText variant="body" style={{ marginBottom: 8 }}>
              Release the gold of {releaseTarget.loanNumber} pledged to {releaseTarget.pledge.bankName} for{" "}
              {fmt(releaseTarget.pledge.pledgedAmount)}?
            </ThemedText>
            <ThemedText
              variant="small"
              color={releaseTarget.pledge.cashTreatment === "CashIn" ? colors.amber : colors.muted}
              style={{ marginBottom: 12 }}
            >
              {releaseTarget.pledge.cashTreatment === "CashIn"
                ? `${fmt(releaseTarget.pledge.pledgedAmount)} will be booked out of Cash-in-Hand.`
                : "No cash movement will be created — this pledge was recorded only."}
            </ThemedText>
            {releaseError ? (
              <ThemedText variant="small" color={colors.red} style={{ marginBottom: 8 }}>
                {releaseError}
              </ThemedText>
            ) : null}
            <View style={{ flexDirection: "row", gap: 8 }}>
              <View style={{ flex: 1 }}>
                <GoldButton title="Cancel" variant="outline" onPress={() => setReleaseTarget(null)} disabled={release.isPending} />
              </View>
              <View style={{ flex: 1 }}>
                <GoldButton title="Release" onPress={() => release.mutate(releaseTarget)} loading={release.isPending} />
              </View>
            </View>
          </>
        ) : null}
      </BottomSheetModal>

      <BottomSheetModal visible={!!voidTarget} onClose={() => setVoidTarget(null)}>
        {voidTarget ? (
          <SheetScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
            <ThemedText variant="h3" color={colors.brandDeep} style={{ marginBottom: 4 }}>
              Delete Repledge Record
            </ThemedText>
            <ThemedText variant="small" color={colors.muted} style={{ marginBottom: 12 }}>
              Cancels the {fmt(voidTarget.pledge.pledgedAmount)} pledge of {voidTarget.loanNumber} to{" "}
              {voidTarget.pledge.bankName} entered in error.
              {voidTarget.pledge.cashTreatment === "CashIn"
                ? ` A compensating cash-out of ${fmt(voidTarget.pledge.pledgedAmount)} will be booked.`
                : " No cash will move — this pledge was recorded only."}{" "}
              The record stays in history for audit. Use Release instead if the gold is actually being returned.
            </ThemedText>
            <GoldTextInput
              label="Reason *"
              value={voidReason}
              onChangeText={setVoidReason}
              placeholder="why this record is being cancelled"
              maxLength={255}
            />
            {voidError ? (
              <ThemedText variant="small" color={colors.red} style={{ marginBottom: 8 }}>
                {voidError}
              </ThemedText>
            ) : null}
            <GoldButton
              title="Delete Entry"
              onPress={() => voidPledge.mutate(voidTarget)}
              loading={voidPledge.isPending}
              disabled={!voidReason.trim()}
            />
          </SheetScrollView>
        ) : null}
      </BottomSheetModal>

      <BottomSheetModal visible={addVisible} onClose={() => { resetBank(); setAddVisible(false); }}>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <ThemedText variant="h3" color={colors.brandDeep}>
            Add Bank
          </ThemedText>
          <Pressable onPress={() => { resetBank(); setAddVisible(false); }} hitSlop={10}>
            <ThemedText variant="h3" color={colors.muted}>
              ×
            </ThemedText>
          </Pressable>
        </View>
        <SheetScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
          <GoldTextInput label="Name" value={name} onChangeText={setName} />
          <GoldTextInput label="IFSC" value={ifsc} onChangeText={setIfsc} />
          <GoldTextInput label="Account no." value={accountNo} onChangeText={setAccountNo} />
          <GoldTextInput label="Phone" keyboardType="phone-pad" value={phone} onChangeText={setPhone} />
          {bankError ? (
            <ThemedText variant="small" color={colors.red} style={{ marginBottom: 8 }}>
              {bankError}
            </ThemedText>
          ) : null}
          <GoldButton title="Save" onPress={() => create.mutate()} loading={create.isPending} disabled={!name} />
        </SheetScrollView>
      </BottomSheetModal>
    </ScreenContainer>
  );
}
