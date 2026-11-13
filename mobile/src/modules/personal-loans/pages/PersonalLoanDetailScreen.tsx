import React, { useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import * as FileSystem from "expo-file-system/legacy";
import { presentFile } from "@/common/utils/presentFile";
import { AccRow, Buffering, C, Card, ConfirmSheet, EmptyText, FabMenu, FieldGrid, FlatHeader, PillTabs, PIcon, Screen, ServerFlatList, Sheet, SheetListItem, StatusChip, Txt, WarningBanner, toast, type FabMenuAction } from "@/common/components/ui";
import { ApprovalChainPanel } from "@/common/components/ApprovalChainPanel";
import { stageByKey, useApprovalWorkflow } from "@/common/services/approvalWorkflowService";
import { useServerList } from "@/common/hooks/use-server-list";
import { useAuth } from "@/common/providers/AuthProvider";
import { ApiError } from "@/common/services/httpClient";
import { getToken } from "@/common/services/tokenStorage";
import { withPrintProgress } from "@/common/components/ui/PrintProgressHost";
import { approvePersonalLoan, deletePersonalLoan, getPersonalLoan, getPersonalLoanSchedulePage, listPersonalLoanApprovals, listPersonalLoanPaymentsPage, personalLoanBondUrl } from "@/modules/personal-loans/services/personalLoanService";
import type { PersonalLoan, PersonalLoanInstallment, PersonalLoanPayment, PersonalLoanBondLang } from "@/modules/personal-loans/types/personal-loan-types";
import { PersonalLedgerEditSheet } from "@/modules/personal-loans/components/PersonalLedgerEditSheet";
import { CollectSheet, CreatePersonalLoanSheet, PER, RenewSheet, errMsg } from "@/modules/personal-loans/pages/PersonalLoansScreen";
import { dmy, inr, todayISO } from "@/common/utils/format";
import { loadErrorText } from "@/common/services/apiErrors";

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
  const [error, setError] = useState<string | null>(null);
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

  // Renewal chain: one hop each way (renewedFromLoanId / renewedToLoanId).
  const olderId = loan.data?.renewedFromLoanId ?? null;
  const newerId = loan.data?.renewedToLoanId ?? null;
  const older = useQuery({ queryKey: ["personalLoan", String(olderId)], queryFn: () => getPersonalLoan(olderId!), enabled: visible && tab === "history" && !!olderId });
  const newer = useQuery({ queryKey: ["personalLoan", String(newerId)], queryFn: () => getPersonalLoan(newerId!), enabled: visible && tab === "history" && !!newerId });

  async function downloadBond(lang: PersonalLoanBondLang) {
    const l = loan.data;
    if (!l || bondBusy) return;
    setBondBusy(lang);
    setError(null);
    try {
      const token = await getToken();
      const targetUri = `${FileSystem.cacheDirectory}bond-${l.loanNumber}-${lang}.pdf`;
      const result = await withPrintProgress(() =>
        FileSystem.downloadAsync(personalLoanBondUrl(l.id, lang), targetUri, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        })
      );
      if (result.status < 200 || result.status >= 300) throw new ApiError(result.status, "", undefined);
      await presentFile(result.uri, { mimeType: "application/pdf", title: "Personal loan bond" });
    } catch (e) {
      setError(errMsg(e, "Could not download the bond."));
    } finally {
      setBondBusy(null);
    }
  }

  const l = loan.data;
  const title = l ? `${l.loanNumber} — ${l.customer?.name ?? `Customer #${l.customerId}`}` : "Personal Loan";

  const active = l?.status === "Active";
  // Terms can be corrected only while nothing is built on them (the server enforces the same).
  const editable = !!l && canUpdate && (l.status === "Active" || l.status === "Pending Approval") && !l.renewedFromLoanId && !l.renewedToLoanId && !l.totalPaid && !l.totalPenalInterestCharged;
  const actions: FabMenuAction[] = l
    ? [
        ...(editable ? [{ label: "Edit", icon: "edit", onPress: () => setEditLoan(l) }] : []),
        ...(canUpdate && active ? [{ label: "Collect", icon: "coin", onPress: () => setCollectLoan(l) }, { label: "Renew", icon: "transfer", onPress: () => setRenewLoan(l) }] : []),
        { label: bondBusy ? "Downloading…" : "Bond", icon: "download", onPress: () => setBondOpen(true) },
        ...(canDeleteLedger ? [{ label: "Delete", icon: "trash", onPress: () => { setError(null); setDeleteOpen(true); } }] : []),
      ]
    : [];

  async function removeLoan() {
    if (!l) return;
    setDeleting(true);
    try {
      await deletePersonalLoan(l.id);
      qc.invalidateQueries({ queryKey: ["personalLoans"] });
      toast.success(`${l.loanNumber} deleted`);
      setDeleteOpen(false);
      router.back();
    } catch (e) {
      setDeleteOpen(false);
      setError(errMsg(e, "Could not delete the loan."));
    } finally {
      setDeleting(false);
    }
  }

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
            decide={(input) => approvePersonalLoan(l.id, input)}
            onSaved={() => {
              setError(null);
              qc.invalidateQueries({ queryKey: ["personalLoans"] });
              qc.invalidateQueries({ queryKey: ["personalLoan", String(l.id)] });
              qc.invalidateQueries({ queryKey: ["personalLoanApprovals", String(l.id)] });
              qc.invalidateQueries({ queryKey: ["personalLoanSchedule", l.id] });
            }}
            onError={setError}
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
      {error ? <Txt style={{ fontSize: 12, color: C.red, marginBottom: 10 }}>{error}</Txt> : null}
      <PillTabs
        tabs={DETAIL_TABS}
        value={tab}
        onChange={setTab}
        labels={{ schedule: "Schedule", payments: "Payment History", history: "Schedule History" }}
      />
    </View>
  ) : null;

  const chainRow = (x: PersonalLoan, label: string, first: boolean) => (
    <Pressable
      key={x.id}
      onPress={() => onOpenLoan(x.id)}
      style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 11, borderTopWidth: first ? 0 : 1, borderTopColor: C.line }}
    >
      <View style={{ flex: 1, minWidth: 0 }}>
        <Txt style={{ fontWeight: "700", fontSize: 12.5 }}>{x.loanNumber}</Txt>
        <Txt style={{ fontSize: 11, color: C.muted, marginTop: 1 }}>
          {label} · Opened {dmy(x.openedDate)}
        </Txt>
      </View>
      <PIcon name="chevright" color={C.muted} />
    </Pressable>
  );

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
        header={header}
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
      <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 24 }}>
        {header}
        <View style={{ paddingHorizontal: 16 }}>
          {(olderId && older.isLoading) || (newerId && newer.isLoading) ? (
            <Buffering block />
          ) : (
            <>
              {older.data && olderId ? chainRow(older.data, "Renewed into this loan", true) : null}
              <View style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 11, borderTopWidth: older.data && olderId ? 1 : 0, borderTopColor: C.line }}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Txt style={{ fontWeight: "700", fontSize: 12.5 }}>{l.loanNumber} (this loan)</Txt>
                  <Txt style={{ fontSize: 11, color: C.muted, marginTop: 1 }}>Opened {dmy(l.openedDate)}</Txt>
                </View>
                <StatusChip label={l.status} />
              </View>
              {newer.data && newerId ? chainRow(newer.data, "Renewed from this loan", false) : null}
              {!olderId && !newerId ? <Txt style={{ paddingVertical: 12, paddingHorizontal: 2, color: C.muted, fontSize: 12.5 }}>No prior renewals for this loan.</Txt> : null}
            </>
          )}
        </View>
      </ScrollView>
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
