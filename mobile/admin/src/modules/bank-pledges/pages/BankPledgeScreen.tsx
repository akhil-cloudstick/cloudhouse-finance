import React, { useState } from "react";
import { View } from "react-native";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  AccRow,
  BtnRow2,
  C,
  FabMenu,
  GroupedFilter,
  emptyGroupedFilter,
  gfDate,
  gfValues,
  type GFSection,
  type GroupedFilterValue,
  Field,
  FlatHeader,
  Input,
  NoticeBanner,
  PillTabs,
  PrimaryButton,
  Screen,
  SearchFilterRow,
  ServerFlatList,
  Sheet,
  Txt,
  WarningBanner,
  openPage,
  toast,
} from "@/common/components/ui";
import { invalidateBankPledgeViews } from "@/modules/bank-pledges/components/bankPledgeViews";
import { BanksSheet } from "@/modules/bank-pledges/components/BanksSheet";
import { AddBankPledgeSheet } from "@/modules/bank-pledges/components/AddBankPledgeSheet";
import { useShowBranchFilter } from "@/common/hooks/use-branch-switch";
import { listBranchesPage } from "@/modules/branches/services/branchService";
import { listCustomersPage } from "@/modules/customers/services/customerService";
import { listBanksPage } from "@/modules/banks/services/bankService";
import { usePersistedState } from "@/common/hooks/use-persisted-state";
import { useServerList } from "@/common/hooks/use-server-list";
import { SplitPaymentInput, type SplitPayment } from "@/common/components/SplitPaymentInput";
import { listBankPledgedLoansPage, listBankPledgeHistoryPage, releaseBankPledge, voidBankPledge } from "@/modules/bank-pledges/services/bankPledgeService";
import { type BankPledgeHistoryRow, type BankPledgeRecordWithWeights } from "@/modules/bank-pledges/types/bank-pledge-types";
import { ApiError } from "@/common/services/httpClient";
import { useAuth } from "@/common/providers/AuthProvider";
import { dmy, inr } from "@/common/utils/format";
import { BankPledgeEditSheet } from "@/modules/loans/components/BankPledgeEditSheet";
import { fmtW, pledgeOrnaments, pledgeOverdue } from "@/modules/loans/utils/pledgeView";
import type { Loan } from "@/modules/loans/types/loan-types";

// Bank Pledges — prototype #header-bankpledges + #page-bankpledges, Add to
// Bank Pledge and Add Bank sheets. Active = loans currently pledged
// (GET /loans?bankPledgeStatus=Bank Pledged), History = every pledge record
// (GET /loans/bank-pledges/history); both server-searched and paged.

const TABS = ["active", "history"] as const;
type Tab = (typeof TABS)[number];
const TAB_LABELS: Record<Tab, string> = { active: "Active", history: "History" };

const FILTER_SECTIONS: GFSection[] = [{ kind: "date", key: "date", label: "Pledge date" }];
const or = (v?: string | null) => (v && v.trim() ? v : "—");
const errMsg = (e: unknown, fallback: string) => (e instanceof ApiError ? e.message : fallback);
const cashLabel = (t?: string) => (t === "CashIn" ? "Cash Added" : "Record Only");
// "Voided" stays the wire value; the UI calls it "Deleted" (matches web).
const statusLabel = (s: string) => (s === "Voided" ? "Deleted" : s);

type PledgeTarget = { loanId: number; loanNumber: string; pledge: BankPledgeRecordWithWeights };
// A loan can carry several active (partial-ornament) pledges — one row each.
const activePledgesOf = (l: Loan) => (l.bankPledges ?? []).filter((p) => p.status === "Active") as BankPledgeRecordWithWeights[];

export default function BankPledgeScreen() {
  const qc = useQueryClient();
  const { can } = useAuth();
  const canCreatePledge = can("Bank_Pledge_Management", "can_create_bank_pledge");
  const canUpdatePledges = can("Bank_Pledge_Management", "can_update_bank_pledge");
  const canVoid = canUpdatePledges;
  // Correcting or erasing a pledge rewrites its ledger lines, so it takes the ledger edit/delete grants too (web).
  const canEditPledge = canUpdatePledges && can("Loan_Management", "can_edit_ledger_entry");
  const canErasePledge = canUpdatePledges && can("Loan_Management", "can_delete_ledger_entry");
  const [editTarget, setEditTarget] = useState<{ loanId: number; pledge: BankPledgeRecordWithWeights; mode: "edit" | "delete" } | null>(null);
  const canViewBanks = can("Bank_Management", "can_view_bank_module");
  const canViewLoans = can("Loan_Management", "can_view_loan_module");

  const [tab, setTab] = useState<Tab>("active");
  const [addPledge, setAddPledge] = useState(false);
  const [banksOpen, setBanksOpen] = useState(false);
  const [releaseTarget, setReleaseTarget] = useState<PledgeTarget | null>(null);
  // How the pledged amount is paid back to the bank (a "CashIn" pledge only).
  const [releasePay, setReleasePay] = useState<SplitPayment | null>(null);
  const [voidTarget, setVoidTarget] = useState<PledgeTarget | null>(null);
  const [voidReason, setVoidReason] = useState("");

  // Pledge date range — the same from/to the web filter sends, for both tabs.
  const [fv, setFv] = usePersistedState<GroupedFilterValue>("bankPledges:filters", emptyGroupedFilter());
  const { from, to } = gfDate(fv, "date");
  const showBranchFilter = useShowBranchFilter();
  const branchIds = showBranchFilter ? gfValues(fv, "branch") : [];
  const customerIds = gfValues(fv, "customer");
  const bankNames = gfValues(fv, "bank");
  const filters = {
    from: from || undefined,
    to: to || undefined,
    branchId: branchIds.join(",") || undefined,
    customerId: customerIds.join(",") || undefined,
    bank: bankNames.join(",") || undefined,
  };
  // Same filters as web: Branch, Customer (narrowed by the chosen branches), Bank, Pledge date.
  const filterSections: GFSection[] = [
    ...(!showBranchFilter ? [] : [{
      kind: "async" as const,
      key: "branch",
      label: "Branch",
      fetchPage: (p: { q?: string; limit: number; offset: number }) =>
        listBranchesPage({ q: p.q, limit: p.limit, offset: p.offset }).then((r) => ({ items: r.items.map((b) => ({ value: String(b.id), label: b.name })), hasMore: r.hasMore })),
    }]),
    {
      kind: "async" as const,
      key: "customer",
      label: "Customer",
      deps: [branchIds.join(",")],
      fetchPage: (p: { q?: string; limit: number; offset: number }) =>
        listCustomersPage({ q: p.q, limit: p.limit, offset: p.offset, customerType: "Borrower", ...(branchIds.length ? { branchIds: branchIds.map(Number) } : {}) }).then((r) => ({
          items: r.items.map((c) => ({ value: String(c.id), label: c.code ? `${c.name} (${c.code})` : c.name })),
          hasMore: r.hasMore,
        })),
    },
    {
      kind: "async" as const,
      key: "bank",
      label: "Bank",
      fetchPage: (p: { q?: string; limit: number; offset: number }) =>
        listBanksPage({ q: p.q, limit: p.limit, offset: p.offset }).then((r) => ({ items: r.items.map((b) => ({ value: b.name, label: b.name })), hasMore: r.hasMore })),
    },
    ...FILTER_SECTIONS,
  ];
  const active = useServerList<Loan, typeof filters>({ key: ["bankPledges", "active"], filters, fetchPage: (p) => listBankPledgedLoansPage(p), enabled: tab === "active" });
  const history = useServerList<BankPledgeHistoryRow, typeof filters>({ key: ["bankPledges", "history"], filters, fetchPage: (p) => listBankPledgeHistoryPage(p), enabled: tab === "history" });

  const closeRelease = () => {
    setReleaseTarget(null);
    setReleasePay(null);
  };
  const release = useMutation({
    mutationFn: (t: PledgeTarget) =>
      releaseBankPledge(t.loanId, t.pledge.id, t.pledge.cashTreatment === "CashIn" && releasePay ? { ...releasePay.split, bankId: releasePay.bankId } : undefined),
    onSuccess: () => {
      closeRelease();
      invalidateBankPledgeViews(qc);
    },
    onError: (err) => toast.error(errMsg(err, "Could not release the pledge.")),
  });
  const voidPledge = useMutation({
    mutationFn: (t: PledgeTarget) => voidBankPledge(t.loanId, t.pledge.id, voidReason.trim()),
    onSuccess: () => {
      setVoidTarget(null);
      setVoidReason("");
      invalidateBankPledgeViews(qc);
    },
    onError: (err) => toast.error(errMsg(err, "Could not delete the pledge entry — try again.")),
  });

  const openLoan = (id: number) => {
    openPage(`/loans/${id}`);
  };

  const filterBtn = <GroupedFilter title="Filter pledges" sections={filterSections} value={fv} onChange={setFv} />;
  const header = (
    <>
      <PillTabs tabs={TABS} value={tab} onChange={setTab} labels={TAB_LABELS} />
    </>
  );

  // One row for one active pledge of a loan (or the placeholder row when the loan lists none).
  const renderActiveRow = (l: Loan, p: BankPledgeRecordWithWeights | undefined, open: boolean) => {
    const weight = p?.pledgedNetWeight || l.totalNetWeight;
    const target = p ? { loanId: l.id, loanNumber: l.loanNumber, pledge: p } : null;
    return (
      <AccRow
        // iPad and bigger: the same columns as the web Bank Pledges table.
        cells={[
          { h: "Loan", v: l.loanNumber, flex: 0.9 },
          { h: "Customer", v: or(l.customer?.name), flex: 1.4 },
          { h: "Bank", v: p?.bankName || "—" },
          { h: "Weight", v: fmtW(weight), sub: p ? pledgeOrnaments(p, l) : undefined, num: true },
          { h: "Pledged Amount", v: p ? inr(p.pledgedAmount) : "—", num: true },
          { h: "Cash", v: p ? cashLabel(p.cashTreatment) : "—" },
          { h: "Pledged On", v: dmy(p?.pledgeDate) },
          { h: "Due", v: p?.bankPledgeDueDate ? dmy(p.bankPledgeDueDate) : "—" },
        ]}
        key={p ? p.id : "none"}
        defaultOpen={open}
        id={l.loanNumber}
        name={or(l.customer?.name)}
        sub={or(p?.bankName)}
        amount={p ? inr(p.pledgedAmount) : undefined}
        details={[
          { k: "Weight", v: weight ? `${+Number(weight).toFixed(2)} g` : "—" },
          { k: "Cash treatment", v: p ? cashLabel(p.cashTreatment) : "—" },
          { k: "Pledged on", v: dmy(p?.pledgeDate) },
          { k: "Due date", v: dmy(p?.bankPledgeDueDate) + (p && pledgeOverdue(p) ? "  · Overdue" : ""), color: p && pledgeOverdue(p) ? C.red : undefined },
          { k: "Gross weight", v: fmtW(p?.pledgedGrossWeight) },
          { k: "Net weight", v: fmtW(p?.pledgedNetWeight) },
          { k: "Interest rate", v: p?.bankInterestRate ? `${p.bankInterestRate}% p.a.` : "—" },
          { k: "Ornaments", v: p ? pledgeOrnaments(p, l) : "—" },
          { k: "Ref no", v: or(p?.referenceNumber) },
        ]}
        actions={[
          ...(target && canUpdatePledges
            ? [
                {
                  label: "Release",
                  onPress: () => {
                    setReleasePay(null);
                    setReleaseTarget(target);
                  },
                },
              ]
            : []),
          ...(target && canVoid
            ? [
                {
                  label: "Delete",
                  danger: true,
                  onPress: () => {
                    setVoidReason("");
                    setVoidTarget(target);
                  },
                },
              ]
            : []),
          ...(target && canEditPledge ? [{ label: "Edit", onPress: () => setEditTarget({ loanId: l.id, pledge: target.pledge, mode: "edit" }) }] : []),
          ...(canViewLoans && (!target || (!canUpdatePledges && !canVoid)) ? [{ label: "View Loan", onPress: () => openLoan(l.id) }] : []),
        ]}
      />
    );
  };

  return (
    <Screen
      header={<FlatHeader title="Bank Pledges" subtitle="Active & history" />}
      floating={
        // One corner button that opens upward into both actions.
        canViewBanks || canCreatePledge ? (
          <FabMenu
            label="Bank actions"
            actions={[
              ...(canCreatePledge ? [{ label: "Add Pledge", icon: "plus", onPress: () => setAddPledge(true) }] : []),
              ...(canViewBanks ? [{ label: "Banks", icon: "coin", onPress: () => setBanksOpen(true) }] : []),
            ]}
          />
        ) : undefined
      }
    >
      {tab === "active" ? (
        <ServerFlatList stickyHeader
          list={active}
          items={active.items}
          keyOf={(l) => String(l.id)}
          emptyText={active.search ? "No pledges match your search." : "No loans currently bank-pledged."}
          header={
            <>
              {header}
              <SearchFilterRow value={active.search} onChangeText={active.setSearch} placeholder="Search by loan ID, bank, or customer name" filter={filterBtn} style={{ paddingTop: 12, paddingBottom: 8 }} />
            </>
          }
          renderItem={(l, i) => {
            const pledges = activePledgesOf(l);
            // No active pledge record on the loan: keep the single placeholder row.
            const rows: (BankPledgeRecordWithWeights | undefined)[] = pledges.length ? pledges : [undefined];
            return <>{rows.map((p, pi) => renderActiveRow(l, p, i === 0 && pi === 0))}</>;
          }}
        />
      ) : (
        <ServerFlatList stickyHeader
          list={history}
          items={history.items}
          keyOf={(r) => String(r.id)}
          emptyText={history.search ? "No pledge history matches your search." : "No re-pledge records yet."}
          header={
            <>
              {header}
              <SearchFilterRow value={history.search} onChangeText={history.setSearch} placeholder="Search by loan ID, bank, or customer name" filter={filterBtn} style={{ paddingTop: 12, paddingBottom: 8 }} />
            </>
          }
          renderItem={(r) => (
            <AccRow
              // iPad and bigger: the same columns as the web Re-pledge history table.
              cells={[
                { h: "Loan", v: r.loanNumber || `#${r.loanId}`, flex: 0.9 },
                { h: "Customer", v: or(r.customerName), flex: 1.4 },
                { h: "Bank", v: or(r.bankName), sub: pledgeOrnaments(r) },
                { h: "Amount", v: inr(r.pledgedAmount), num: true },
                { h: "Cash", v: cashLabel(r.cashTreatment) },
                { h: "Pledged", v: dmy(r.pledgeDate) },
                { h: "Released", v: dmy(r.releaseDate) },
                { h: "Status", v: r.status === "Voided" ? "Deleted" : r.status, chip: true, sub: r.status === "Voided" ? r.voidReason || undefined : undefined },
              ]}
              id={r.loanNumber || `#${r.loanId}`}
              name={or(r.bankName)}
              sub={statusLabel(r.status)}
              status={statusLabel(r.status)}
              statusTone={r.status === "Voided" ? "overdue" : r.status === "Active" ? "active" : "closed"}
              details={[
                { k: "Customer", v: or(r.customerName) },
                { k: "Amount", v: inr(r.pledgedAmount) },
                { k: "Cash treatment", v: cashLabel(r.cashTreatment) },
                { k: "Pledged", v: dmy(r.pledgeDate) },
                { k: "Released", v: dmy(r.releaseDate) },
                { k: "Due date", v: dmy(r.bankPledgeDueDate) },
                { k: "Interest rate", v: r.bankInterestRate ? `${r.bankInterestRate}% p.a.` : "—" },
                { k: "Gross weight", v: fmtW(r.pledgedGrossWeight) },
                { k: "Net weight", v: fmtW(r.pledgedNetWeight) },
                { k: "Ornaments", v: pledgeOrnaments(r) },
                ...(r.status === "Voided" ? [{ k: "Delete reason", v: or(r.voidReason) }] : []),
              ]}
              actions={[
                ...(r.status !== "Voided" && canEditPledge ? [{ label: "Edit", onPress: () => setEditTarget({ loanId: r.loanId, pledge: r, mode: "edit" as const }) }] : []),
                ...(r.status !== "Voided" && canErasePledge ? [{ label: "Delete", danger: true, onPress: () => setEditTarget({ loanId: r.loanId, pledge: r, mode: "delete" as const }) }] : []),
              ]}
            />
          )}
        />
      )}

      <AddBankPledgeSheet visible={addPledge} onClose={() => setAddPledge(false)} />
      <BankPledgeEditSheet loanId={editTarget?.loanId ?? 0} pledge={editTarget?.pledge ?? null} mode={editTarget?.mode ?? "edit"} onClose={() => setEditTarget(null)} />
      <BanksSheet visible={banksOpen} onClose={() => setBanksOpen(false)} />

      <Sheet visible={!!releaseTarget} onClose={closeRelease} title="Release Bank Pledge" maxHeightPct={releaseTarget?.pledge.cashTreatment === "CashIn" ? 88 : 60}>
        {releaseTarget ? (
          <>
            <Txt style={{ fontSize: 13, marginTop: 10, marginBottom: 12 }}>
              Release the gold of {releaseTarget.loanNumber} pledged to {releaseTarget.pledge.bankName} for {inr(releaseTarget.pledge.pledgedAmount)}?
            </Txt>
            <NoticeBanner>
              {releaseTarget.pledge.cashTreatment === "CashIn"
                ? `${inr(releaseTarget.pledge.pledgedAmount)} will be paid back to the bank — choose how below.`
                : "No cash movement will be created — this pledge was recorded only."}
            </NoticeBanner>
            {releaseTarget.pledge.cashTreatment === "CashIn" ? (
              <SplitPaymentInput total={releaseTarget.pledge.pledgedAmount} onChange={setReleasePay} bankLabel="Bank (account it leaves from)" />
            ) : null}
            <BtnRow2>
              <PrimaryButton label="Cancel" variant="outline" onPress={closeRelease} disabled={release.isPending} />
              <PrimaryButton label="Release" onPress={() => release.mutate(releaseTarget)} loading={release.isPending} disabled={releaseTarget.pledge.cashTreatment === "CashIn" && !releasePay?.ready} />
            </BtnRow2>
          </>
        ) : null}
      </Sheet>

      <Sheet visible={!!voidTarget} onClose={() => setVoidTarget(null)} title="Delete Repledge Record" maxHeightPct={70}>
        {voidTarget ? (
          <>
            <View style={{ marginTop: 10 }}>
              <WarningBanner>
                Cancels erroneous pledge.
              </WarningBanner>
            </View>
            <Field label="Reason *">
              <Input value={voidReason} onChangeText={setVoidReason} placeholder="Why this record is being cancelled" maxLength={255} />
            </Field>
            <PrimaryButton label="Delete Entry" variant="danger" onPress={() => voidPledge.mutate(voidTarget)} loading={voidPledge.isPending} disabled={!voidReason.trim()} />
          </>
        ) : null}
      </Sheet>
    </Screen>
  );
}
