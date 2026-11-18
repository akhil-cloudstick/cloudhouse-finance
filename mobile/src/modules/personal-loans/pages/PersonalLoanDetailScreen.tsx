import React, { useState } from "react";
import { View } from "react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import * as FileSystem from "expo-file-system/legacy";
import { safeDownload } from "@/common/utils/safeDownload";
import { presentFile } from "@/common/utils/presentFile";
import { AccRow, Buffering, C, Card, ConfirmSheet, EmptyText, FabMenu, FieldGrid, FlatHeader, PillTabs, Screen, ServerFlatList, Sheet, SheetListItem, StatusChip, Txt, WarningBanner, toast, type FabMenuAction } from "@/common/components/ui";
import { ApprovalChainPanel } from "@/common/components/ApprovalChainPanel";
import { isFinalStage, stageByKey, stageByPending, useApprovalWorkflow } from "@/common/services/approvalWorkflowService";
import { useServerList } from "@/common/hooks/use-server-list";
import { useAuth } from "@/common/providers/AuthProvider";
import { ApiError } from "@/common/services/httpClient";
import { getToken } from "@/common/services/tokenStorage";
import { withPrintProgress } from "@/common/components/ui/PrintProgressHost";
import { getCashSummary } from "@/modules/cash/services/cashService";
import { approvePersonalLoan, deletePersonalLoan, getPersonalLoan, getPersonalLoanHistoryPage, getPersonalLoanSchedulePage, listPersonalLoanApprovals, listPersonalLoanPaymentsPage, personalLoanBondUrl } from "@/modules/personal-loans/services/personalLoanService";
import type { PersonalLoan, PersonalLoanHistory, PersonalLoanInstallment, PersonalLoanPayment, PersonalLoanBondLang } from "@/modules/personal-loans/types/personal-loan-types";
import { PersonalLedgerEditSheet } from "@/modules/personal-loans/components/PersonalLedgerEditSheet";
import { CollectSheet, CreatePersonalLoanSheet, PER, RenewSheet, errMsg, invalidateMoney } from "@/modules/personal-loans/pages/PersonalLoansScreen";
import { dmy, inr, todayISO } from "@/common/utils/format";
import { loadErrorText } from "@/common/services/apiErrors";

// Final due date: opened date + tenure instalments (web finalDueDate).
function finalDueDate(l: PersonalLoan): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(l.openedDate || "");
  if (!m || !(l.tenureCount > 0)) return "—";
  const d = new Date(+m[1], +m[2] - 1, +m[3]);
  if (l.frequency === "Monthly") d.setMonth(d.getMonth() + l.tenureCount);
  else d.setDate(d.getDate() + l.tenureCount * (l.frequency === "Weekly" ? 7 : 1));
  const p = (n: number) => String(n).padStart(2, "0");
  return dmy(`${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`);
}

// Languages the backend renders the bond in (GET /personal-loans/:id/bond?lang=).
const BOND_LANGS: { lang: PersonalLoanBondLang; title: string }[] = [
  { lang: "en", title: "English" },
  { lang: "ml", title: "Malayalam" },
];

// Personal loan page: Schedule / Payment History / Schedule History tabs, each paged from the server.
const DETAIL_TABS = ["schedule", "payments", "history"] as const;
type DetailTab = (typeof DETAIL_TABS)[number];

export default function PersonalLoanDetailScreen() {
  const { id: idParam } = useLocalSearchParams<{ id: string }>();
  const loanId = Number(idParam) || null;
  const { can } = useAuth();
  const canUpdate = can("Personal_Loan_Management", "can_update_personal_loan");
  const canViewCash = can("Cash_Management", "can_view_cash_module");
  const visible = loanId != null;
  const id = loanId ?? 0;
  const [collectLoan, setCollectLoan] = useState<PersonalLoan | null>(null);
  const [renewLoan, setRenewLoan] = useState<PersonalLoan | null>(null);
  const [editLoan, setEditLoan] = useState<PersonalLoan | null>(null);
  const onOpenLoan = (x: number) => router.push(`/personal-loans/${x}` as never);
  const [tab, setTab] = useState<DetailTab>("schedule");
  const [bondBusy, setBondBusy] = useState<PersonalLoanBondLang | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [bondOpen, setBondOpen] = useState(false);
  // Editing / deleting a ledger entry recalculates the loan, so each has its own grant (shared with the gold-loan ledger).
  const canEditLedger = can("Loan_Management", "can_edit_ledger_entry");
  const canDeleteLedger = can("Loan_Management", "can_delete_ledger_entry");
  const [editing, setEditing] = useState<{ entry: PersonalLoanPayment; bankId: number | null; mode: "edit" | "delete" } | null>(null);

  const qc = useQueryClient();
  const wf = useApprovalWorkflow();
  const loan = useQuery({ queryKey: ["personalLoan", String(id)], queryFn: () => getPersonalLoan(id), enabled: visible });
  // Approval chain (tenant's "personal_loan" flow) — only for a loan that
  // went through it (approvalStage set).
  const inChain = !!loan.data?.approvalStage;
  const approvals = useQuery({
    queryKey: ["personalLoanApprovals", String(id)],
    queryFn: () => listPersonalLoanApprovals(id),
    enabled: visible && inChain,
  });
  const schedule = useServerList<PersonalLoanInstallment>({
    key: ["personalLoanSchedule", id],
    fetchPage: (p) => getPersonalLoanSchedulePage(id, p.limit, p.offset),
    enabled: visible && tab === "schedule",
  });
  const payments = useServerList<PersonalLoanPayment>({
    key: ["personalLoanPayments", id],
    fetchPage: (p) => listPersonalLoanPaymentsPage(id, p.limit, p.offset),
    enabled: visible && tab === "payments",
  });

  // Event history (created / penal applied / renewed) — web's History tab.
  const history = useServerList<PersonalLoanHistory>({
    key: ["personalLoanHistory", id],
    fetchPage: (p) => getPersonalLoanHistoryPage(id, p.limit, p.offset),
    enabled: visible && tab === "history",
  });
  // Branch balance in hand — the final approval stage pays the loan out of it (web useBalanceInHand).
  const pendingApproval = loan.data?.status === "Pending Approval";
  const balance = useQuery({
    queryKey: ["cash-summary", "pl-approve", loan.data?.branchId],
    queryFn: () => getCashSummary(loan.data!.branchId),
    enabled: visible && pendingApproval && canViewCash && !!loan.data?.branchId,
    retry: false,
  });
  const balanceInHand = balance.data?.expectedCash ?? null;

  async function downloadBond(lang: PersonalLoanBondLang) {
    const l = loan.data;
    if (!l || bondBusy) return;
    setBondBusy(lang);
    try {
      const token = await getToken();
      const targetUri = `${FileSystem.cacheDirectory}bond-${l.loanNumber}-${lang}.pdf`;
      const result = await withPrintProgress(() =>
        safeDownload(personalLoanBondUrl(l.id, lang), targetUri, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        })
      );
      if (result.status < 200 || result.status >= 300) throw new ApiError(result.status, "", undefined);
      await presentFile(result.uri, { mimeType: "application/pdf", title: "Personal loan bond" });
    } catch (e) {
      toast.error(errMsg(e, "Could not download the bond."));
    } finally {
      setBondBusy(null);
    }
  }

  const l = loan.data;
  const title = l ? `${l.loanNumber} — ${l.customer?.name ?? `Customer #${l.customerId}`}` : "Personal Loan";

  // Collect / Renew also while "Pending" (past its schedule + penal), like web.
  const active = l?.status === "Active" || l?.status === "Pending";
  // Terms can be corrected only while nothing is built on them (the server enforces the same).
  const editable = !!l && canUpdate && (l.status === "Active" || l.status === "Pending Approval") && !l.renewedFromLoanId && !l.renewedToLoanId && !l.totalPaid && !l.totalPenalInterestCharged;
  const actions: FabMenuAction[] = l
    ? [
        ...(editable ? [{ label: "Edit", icon: "edit", onPress: () => setEditLoan(l) }] : []),
        ...(canUpdate && active ? [{ label: "Collect", icon: "coin", onPress: () => setCollectLoan(l) }, { label: "Renew", icon: "transfer", onPress: () => setRenewLoan(l) }] : []),
        { label: bondBusy ? "Downloading…" : "Bond", icon: "download", onPress: () => setBondOpen(true) },
        ...(canDeleteLedger ? [{ label: "Delete", icon: "trash", onPress: () => { setDeleteOpen(true); } }] : []),
      ]
    : [];

  async function removeLoan() {
    if (!l) return;
    setDeleting(true);
    try {
      await deletePersonalLoan(l.id);
      invalidateMoney(qc);
      toast.success(`${l.loanNumber} deleted`);
      setDeleteOpen(false);
      router.back();
    } catch (e) {
      setDeleteOpen(false);
      toast.error(errMsg(e, "Could not delete the loan."));
    } finally {
      setDeleting(false);
    }
  }

  const approvalStage = pendingApproval ? stageByPending(wf, "personal_loan", l?.approvalStage) : undefined;
  const approvalIsFinal = !!approvalStage && isFinalStage(wf, "personal_loan", approvalStage.pending);
  const approveBlockedReason =
    l && approvalIsFinal && balanceInHand !== null && l.disbursedAmount > balanceInHand + 0.005
      ? `Balance in hand ${inr(balanceInHand)} is lower than the ${inr(l.disbursedAmount)} to disburse — add cash first.`
      : undefined;

  const detailsCard = l ? (
    <Card style={{ marginBottom: 14 }}>
      <FieldGrid
        items={[
          { k: "Principal", v: inr(l.principalAmount) },
          { k: "Interest", v: `${inr(l.interestAmount)} (${l.interestType === "Flat" ? "Flat" : `${l.interestValue}%`})` },
          { k: "Disbursed", v: inr(l.disbursedAmount) },
          { k: "Outstanding", v: inr(l.outstandingAmount), color: C.brandDeep },
          { k: "Frequency", v: `${l.frequency} · ${inr(l.installmentAmount)}/${PER[l.frequency] ?? l.frequency}` },
          { k: "Total paid", v: inr(l.totalPaid), color: C.green },
          { k: "Due date", v: finalDueDate(l) },
          { k: "Grace period", v: l.gracePeriodDays > 0 ? `${l.gracePeriodDays} days` : "None" },
          { k: "Penal interest rate", v: `${l.penalInterestRate}%${l.penalFlatAmount > 0 ? ` + ${inr(l.penalFlatAmount)} flat` : ""}` },
        ]}
      />
      {inChain ? (
        <View style={{ marginTop: 14 }}>
          <Txt style={{ fontSize: 12, fontWeight: "700", marginBottom: 8 }}>Approval</Txt>
          <ApprovalChainPanel
            flow="personal_loan"
            pending={l.approvalStage}
            status={l.status === "Pending Approval" ? "Pending" : l.status === "Rejected" ? "Rejected" : "Approved"}
            rejectionRemarks={(approvals.data ?? []).find((a) => a.action === "Rejected")?.remarks}
            noun="Personal loan"
            rejectMessage={`Reject ${l.loanNumber}? Nothing is disbursed.`}
            canDecide={canUpdate}
            approveBlockedReason={approveBlockedReason}
            decide={(input) => approvePersonalLoan(l.id, input)}
            onSaved={() => {
              invalidateMoney(qc);
              qc.invalidateQueries({ queryKey: ["personalLoan", String(l.id)] });
              qc.invalidateQueries({ queryKey: ["personalLoanApprovals", String(l.id)] });
              qc.invalidateQueries({ queryKey: ["personalLoanSchedule", l.id] });
            }}
            onError={(m) => toast.error(m)}
          />
          {(approvals.data ?? []).map((a) => (
            <Txt key={a.id} style={{ fontSize: 11, color: C.muted, marginTop: 4 }}>
              {dmy(a.createdAt)} · {a.action} at {stageByKey(wf, "personal_loan", a.stage)?.label ?? a.stage}
              {a.actorRole ? ` by ${a.actorRole}` : ""}
              {a.remarks ? ` — ${a.remarks}` : ""}
            </Txt>
          ))}
        </View>
      ) : null}
      {l.penalCycleCount > 0 ? (
        <View style={{ marginTop: 14 }}>
          <WarningBanner>
            Penal interest applied {l.penalCycleCount} time(s) — {inr(l.totalPenalInterestCharged)} added at {l.penalInterestRate}% p.a.
          </WarningBanner>
        </View>
      ) : null}
    </Card>
  ) : null;

  const header = l ? (
    <View style={{ paddingHorizontal: 16, paddingTop: 12 }}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
        <Txt style={{ fontSize: 11.5, color: C.muted, fontWeight: "600" }}>
          Opened {dmy(l.openedDate)} · {l.tenureCount} installments
        </Txt>
        <StatusChip label={l.status} />
      </View>
      {detailsCard}
      <PillTabs
        tabs={DETAIL_TABS}
        value={tab}
        onChange={setTab}
        labels={{ schedule: "Schedule", payments: "Payment History", history: "History" }}
        style={{ marginHorizontal: -16, marginBottom: 12 }}
      />
    </View>
  ) : null;

  let body: React.ReactNode;
  if (!visible) body = null;
  else if (loan.isLoading) body = <Buffering block />;
  else if (loan.isError || !l) body = <EmptyText>{loadErrorText(loan.error) ?? "This loan no longer exists."}</EmptyText>;
  else if (tab === "schedule")
    body = (
      <ServerFlatList
        list={schedule}
        items={schedule.items}
        gutter={16}
        header={header}
        emptyText="No installments."
        keyOf={(s) => String(s.id)}
        renderItem={(s, i) => {
          const missed = s.status !== "Paid" && s.dueDate.slice(0, 10) < todayISO();
          const value = s.status === "Paid" ? `Paid ${inr(s.paidAmount || s.amount)}` : s.status === "PartiallyPaid" ? `Part ${inr(s.paidAmount)} / ${inr(s.amount)}` : missed ? "Missed" : `Due ${inr(s.amount)}`;
          return (
            <AccRow
              id={`#${s.sequenceNo}`}
              name={dmy(s.dueDate)}
              sub={missed ? "Missed" : s.status}
              amount={value}
              amountColor={s.status === "Paid" ? C.green : missed ? C.red : s.status === "PartiallyPaid" ? C.amber : C.ink}
              details={[
                { k: "Due date", v: dmy(s.dueDate), color: missed ? C.red : undefined },
                { k: "Amount", v: inr(s.amount) },
                { k: "Paid", v: inr(s.paidAmount || 0), color: s.paidAmount ? C.green : C.muted },
              ]}
            />
          );
        }}
      />
    );
  else if (tab === "payments")
    body = (
      <ServerFlatList
        list={payments}
        items={payments.items}
        gutter={16}
        header={
          <>
            {header}
            {payments.pages?.[0] ? (
              <View style={{ marginHorizontal: 16, marginBottom: 14, paddingHorizontal: 12, borderRadius: 10, backgroundColor: C.card, borderWidth: 1, borderColor: C.line }}>
                {([["Debit", payments.pages[0].totalDebit ?? 0, C.red], ["Credit", payments.pages[0].totalCredit ?? 0, C.green]] as const).map(([k, v, color], i) => (
                  <View key={k} style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 9, ...(i > 0 ? { borderTopWidth: 1, borderTopColor: C.line } : null) }}>
                    <Txt style={{ fontSize: 12.5, color: C.muted }}>Total {k.toLowerCase()}</Txt>
                    <Txt style={{ fontSize: 12.5, fontWeight: "700", color }}>{inr(v)}</Txt>
                  </View>
                ))}
              </View>
            ) : null}
          </>
        }
        emptyText="No payments yet."
        keyOf={(p) => p.key ?? String(p.id)}
        renderItem={(p) => {
          // Ledger rows: one per disbursement / charge / payment mode-share. Only the first row of a payment (and the
          // disbursement) can be corrected; a split payment's amount is the sum of its rows.
          const kind = p.kind ?? "payment";
          const isPayment = kind === "payment" && p.id > 0 && (!p.part || p.part.index === 0);
          const isDisbursement = kind === "disbursement";
          const showEdit = canEditLedger && (isPayment || isDisbursement);
          const showDelete = canDeleteLedger && isPayment; // the disbursement is the loan's start and cannot be deleted
          const sameId = (x: PersonalLoanPayment) => x.kind === p.kind && x.id === p.id;
          const bankId = p.bankId ?? payments.items.find((x) => sameId(x) && x.bankId)?.bankId ?? null;
          const entry = isPayment ? { ...p, amount: payments.items.filter((x) => x.kind === "payment" && x.id === p.id).reduce((s, x) => s + x.amount, 0) || p.amount } : p;
          const isDebit = (p.debit ?? 0) > 0;
          const shown = isDebit ? (p.debit ?? 0) : p.credit ?? p.amount;
          return (
            <AccRow
              id={dmy(p.date ?? p.paidOn)}
              name={p.particulars || `Payment${p.reference ? ` · ${p.reference}` : ""}`}
              sub={[p.mode ?? p.method, p.bankName, p.refNo || p.reference].filter(Boolean).join(" · ") || undefined}
              amount={`${isDebit ? "−" : "+"}${inr(shown)}`}
              amountColor={isDebit ? C.red : C.green}
              details={[
                { k: "Debit", v: isDebit ? inr(p.debit) : "—", color: isDebit ? C.red : C.muted },
                { k: "Credit", v: !isDebit ? inr(shown) : "—", color: !isDebit ? C.green : C.muted },
                { k: "Balance", v: inr(p.balance ?? p.runningBalance), color: C.brandDeep },
              ]}
              actions={
                showEdit || showDelete
                  ? [
                      ...(showEdit ? [{ label: "Edit", onPress: () => setEditing({ entry, bankId, mode: "edit" as const }) }] : []),
                      ...(showDelete ? [{ label: "Delete", danger: true, onPress: () => setEditing({ entry, bankId, mode: "delete" as const }) }] : []),
                    ]
                  : undefined
              }
            />
          );
        }}
      />
    );
  else
    body = (
      <ServerFlatList
        list={history}
        items={history.items}
        gutter={16}
        header={header}
        emptyText="No history yet."
        keyOf={(h) => String(h.id)}
        renderItem={(h) => (
          <AccRow
            id={dmy(h.occurredAt)}
            name={h.detail}
            amount={h.amount ? inr(h.amount) : undefined}
            actions={h.relatedLoanId ? [{ label: "View loan", onPress: () => onOpenLoan(h.relatedLoanId!) }] : undefined}
          />
        )}
      />
    );

  return (
    <Screen header={<FlatHeader back title={title} subtitle="Personal loan" />} floating={actions.length ? <FabMenu label="Loan actions" actions={actions} /> : undefined}>
      {body}
      <CreatePersonalLoanSheet visible={!!editLoan} loan={editLoan} onClose={() => setEditLoan(null)} onCreated={() => setEditLoan(null)} />
      <CollectSheet loan={collectLoan} onClose={() => setCollectLoan(null)} />
      <RenewSheet
        loan={renewLoan}
        onClose={() => setRenewLoan(null)}
        onRenewed={(n) => {
          setRenewLoan(null);
          onOpenLoan(n);
        }}
      />
    <ConfirmSheet
      visible={deleteOpen}
      onClose={() => setDeleteOpen(false)}
      title="Delete Personal Loan"
      danger
      message={l ? `Delete ${l.loanNumber} and reverse its cash entry? This can't be undone. It is refused while the loan has payments or is part of a renewal.` : ""}
      confirmLabel="Delete Loan"
      loading={deleting}
      onConfirm={() => void removeLoan()}
    />
    <Sheet visible={bondOpen} onClose={() => setBondOpen(false)} title="Download bond" maxHeightPct={50}>
      {BOND_LANGS.map((o, i) => (
        <SheetListItem key={o.lang} first={i === 0} icon="download" title={o.title} sub={`Bond in ${o.title}`} onPress={() => { setBondOpen(false); void downloadBond(o.lang); }} />
      ))}
    </Sheet>
    <PersonalLedgerEditSheet
      loanId={id}
      entry={editing?.entry ?? null}
      bankId={editing?.bankId}
      minDate={(l?.disbursedAt || l?.openedDate || "").slice(0, 10) || undefined}
      mode={editing?.mode ?? "edit"}
      onClose={() => setEditing(null)}
    />
    </Screen>
  );
}
