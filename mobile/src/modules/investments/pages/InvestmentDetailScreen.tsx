import React, { useState } from "react";
import { View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AccRow, Buffering, C, EmptyText, FieldGrid, FlatHeader, NoticeBanner, PillTabs, PrimaryButton, Screen, SectionTitle, ServerFlatList, StatusChip, Txt, toast } from "@/common/components/ui";
import { ActionGroup, type GroupAction } from "@/common/components/ActionGroup";
import { useServerList } from "@/common/hooks/use-server-list";
import { useAuth } from "@/common/providers/AuthProvider";
import { getInvestment, getInvestmentSchedulePage, getInvestmentLedgerPage } from "@/modules/investments/services/investmentService";
import { InvestmentLedgerEditSheet } from "@/modules/investments/components/InvestmentLedgerEditSheet";
import { type InvestmentPayout, type InvestmentLedgerRow } from "@/modules/investments/types/investment-types";
import { previewInvestmentBondPdf, previewInvestmentStatementPdf } from "@/modules/investments/utils/investmentBond";
import { AddCashSheet, CloseRenewSheet, CreateInvestmentSheet, MarkPaidSheet, PayInterestSheet, WithdrawSheet } from "@/modules/investments/pages/InvestmentsScreen";
import { dmy, inr } from "@/common/utils/format";
import { isUserCancel, loadErrorText, userMessage } from "@/common/services/apiErrors";

const errMsg = (err: unknown, fallback: string) => userMessage(err, fallback);


// ---------------------------------------------------------------------------
// Detail (prototype #inv-detail-modal) + schedule / transactions (paged)
// ---------------------------------------------------------------------------
export default function InvestmentDetailScreen() {
  const { id: idParam } = useLocalSearchParams<{ id: string }>();
  const investmentId = Number(idParam) || null;
  const canUpdate = useAuth().can("Investment_Management", "can_update_investment");
  const canExport = useAuth().can("Ledger_Export", "can_export_ledger");
  const qc = useQueryClient();
  const visible = investmentId != null;
  const id = investmentId ?? 0;
  const [action, setAction] = useState<"addCash" | "withdraw" | "mature" | "payInterest" | "edit" | null>(null);
  const [payout, setPayout] = useState<InvestmentPayout | null>(null);
  const [printing, setPrinting] = useState(false);

  const investment = useQuery({ queryKey: ["investment", String(id)], queryFn: () => getInvestment(id), enabled: visible });
  const inv = investment.data;
  const isLive = inv?.engine === "Live";

  const schedule = useServerList<InvestmentPayout>({
    key: ["investmentSchedule", id],
    fetchPage: (p) => getInvestmentSchedulePage(id, p.limit, p.offset),
    enabled: visible && !!inv && !isLive,
  });
  // The ledger (every deposit, withdrawal and payout with its running balance) — the Live engine's only list, and a
  // second tab on a scheduled investment. Rows carry what Edit / Delete need.
  const [view, setView] = useState<"schedule" | "ledger">("schedule");
  const showLedger = isLive || view === "ledger";
  const ledger = useServerList<InvestmentLedgerRow>({
    key: ["investmentLedger", id],
    fetchPage: (p) => getInvestmentLedgerPage(id, p.limit, p.offset).then((r) => ({ ...r, items: r.items ?? [] })),
    enabled: visible && !!inv && showLedger,
  });
  const auth = useAuth();
  // Editing / deleting a ledger entry recalculates the investment, so each has its own grant (shared with the gold-loan ledger).
  const canEditLedger = auth.can("Loan_Management", "can_edit_ledger_entry");
  const canDeleteLedger = auth.can("Loan_Management", "can_delete_ledger_entry");
  const [editing, setEditing] = useState<{ row: InvestmentLedgerRow; mode: "edit" | "delete" } | null>(null);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["investment", String(id)] });
    qc.invalidateQueries({ queryKey: ["investmentLedger", id] });
    qc.invalidateQueries({ queryKey: ["investmentSchedule", id] });
    qc.invalidateQueries({ queryKey: ["investments"] });
    for (const key of ["investmentTransactions", "ledger", "cash-summary", "cash-movements"]) qc.invalidateQueries({ queryKey: [key] });
  };

  async function printStatement() {
    if (!inv) return;
    setPrinting(true);
    try {
      await previewInvestmentStatementPdf(inv.id, inv.investmentNumber);
    } catch (e) {
      if (isUserCancel(e)) return;
      toast.error("Preview failed", errMsg(e, "Could not open the statement."));
    } finally {
      setPrinting(false);
    }
  }

  async function printBond() {
    if (!inv) return;
    setPrinting(true);
    try {
      await previewInvestmentBondPdf(inv.id, inv.investmentNumber);
    } catch (e) {
      if (isUserCancel(e)) return;
      toast.error("Preview failed", errMsg(e, "Could not open the agreement."));
    } finally {
      setPrinting(false);
    }
  }

  const canEditInv = !!inv && canUpdate && inv.status === "Active" && !inv.renewedFromInvestmentId && !inv.renewedToInvestmentId && !inv.totalInterestPaid && !inv.interestWithdrawn;
  const canCash = !!inv && canUpdate && isLive && (inv.status === "Active" || inv.status === "Matured");
  const groupActions: GroupAction[] = inv
    ? [
        ...(canExport ? [{ key: "statement", label: "Print statement", icon: "doc" as const, busy: printing, onPress: printStatement }] : []),
        ...(inv.plan?.productType === "Bond" ? [{ key: "agreement", label: "Print agreement", icon: "note" as const, busy: printing, onPress: printBond }] : []),
        ...(canEditInv ? [{ key: "edit", label: "Edit investment", icon: "edit" as const, onPress: () => setAction("edit") }] : []),
        ...(canCash && inv.status === "Active" ? [{ key: "addCash", label: "Add cash", icon: "plus" as const, onPress: () => setAction("addCash") }] : []),
        ...(canCash ? [{ key: "withdraw", label: "Withdraw", icon: "wallet" as const, onPress: () => setAction("withdraw") }] : []),
      ]
    : [];

  const title = inv ? `${inv.investmentNumber} — ${inv.customer?.name ?? `Customer #${inv.customerId}`}` : "Investment";

  const header = inv ? (
    <View style={{ paddingHorizontal: 16, paddingTop: 12 }}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
        <Txt style={{ fontSize: 11.5, color: C.muted, fontWeight: "600" }}>Started {dmy(inv.startDate)}</Txt>
        <StatusChip label={inv.status} />
      </View>
      <FieldGrid
        style={{ marginBottom: 16 }}
        items={[
          { k: "Plan", v: inv.plan?.name ?? "—" },
          { k: "Principal", v: inr(inv.principalAmount) },
          { k: "Rate", v: `${inv.interestRatePercent}% p.a. ${inv.interestRateType}` },
          { k: "Maturity", v: dmy(inv.maturityDate) },
          { k: "Tenure", v: `${inv.tenureMonths} months` },
          { k: "Payout", v: isLive ? "Single payout" : inv.payoutFrequency },
          ...(isLive
            ? [
                { k: "Outstanding principal", v: inr(inv.outstandingPrincipal) },
                { k: "Outstanding interest", v: inr(inv.outstandingInterest), color: C.brandDeep },
              ]
            : [{ k: "Interest paid", v: inr(inv.totalInterestPaid), color: C.green }]),
        ]}
      />
      {inv.renewedFromInvestmentId || inv.renewedToInvestmentId ? (
        <NoticeBanner>
          {[
            inv.renewedFromInvestmentId ? `Renewed from Investment #${inv.renewedFromInvestmentId}` : null,
            inv.renewedToInvestmentId ? `Renewed to Investment #${inv.renewedToInvestmentId}` : null,
          ]
            .filter(Boolean)
            .join(" · ")}
        </NoticeBanner>
      ) : null}
      <ActionGroup actions={groupActions} style={{ marginBottom: 10 }} />
      {canUpdate && !isLive && (inv.status === "Active" || inv.status === "Matured") ? (
        <PrimaryButton label="Pay Interest" variant="outline" onPress={() => setAction("payInterest")} style={{ marginBottom: 10 }} />
      ) : null}
      {canUpdate && inv.status === "Matured" ? <PrimaryButton label="Close / Renew" onPress={() => setAction("mature")} style={{ marginBottom: 10 }} /> : null}
      {isLive ? (
        <SectionTitle flush style={{ marginTop: 8 }}>
          Ledger
        </SectionTitle>
      ) : (
        <PillTabs tabs={["schedule", "ledger"] as const} value={view} onChange={setView} labels={{ schedule: "Payout schedule", ledger: "Ledger" }} />
      )}
    </View>
  ) : null;

  let body: React.ReactNode = null;
  if (!visible) body = null;
  else if (investment.isLoading) body = <Buffering block />;
  else if (investment.isError || !inv) body = <EmptyText>{loadErrorText(investment.error) ?? "This investment no longer exists."}</EmptyText>;
  else if (showLedger)
    body = (
      <ServerFlatList
        list={ledger}
        items={ledger.items}
        gutter={16}
        header={header}
        emptyText="No ledger entries yet."
        keyOf={(r) => r.id}
        renderItem={(r) => {
          const isDebit = r.debitOrCredit === "debit";
          const canE = !!r.editable && canEditLedger;
          const canD = !!r.deletable && canDeleteLedger;
          return (
            <AccRow
              id={r.type}
              idColor={isDebit ? C.red : C.green}
              name={dmy(r.date)}
              sub={[r.method, r.reference].filter(Boolean).join(" · ") || r.description || undefined}
              amount={`${isDebit ? "−" : "+"}${inr(r.amount)}`}
              amountColor={isDebit ? C.red : C.green}
              details={[
                { k: "Description", v: r.description || "—" },
                { k: "Principal", v: inr(r.principalAmount) },
                { k: "Interest", v: inr(r.interestAmount) },
                { k: "Balance", v: inr(r.runningBalance), color: C.brandDeep },
              ]}
              actions={
                canE || canD
                  ? [
                      ...(canE ? [{ label: "Edit", onPress: () => setEditing({ row: r, mode: "edit" as const }) }] : []),
                      ...(canD ? [{ label: "Delete", danger: true, onPress: () => setEditing({ row: r, mode: "delete" as const }) }] : []),
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
        list={schedule}
        items={schedule.items}
        gutter={16}
        header={header}
        emptyText="No payouts scheduled."
        keyOf={(p) => String(p.id)}
        renderItem={(p) => (
          <AccRow
            id={`#${p.sequenceNo}`}
            name={dmy(p.dueDate)}
            sub={p.isPrincipalReturn ? "Principal return" : "Interest payout"}
            amount={inr(p.amount)}
            status={p.status}
            details={[
              { k: "Due date", v: dmy(p.dueDate) },
              { k: "Paid on", v: p.paidAt ? dmy(p.paidAt) : "—" },
            ]}
            actions={canUpdate && p.status === "Pending" ? [{ label: "Mark Paid", primary: true, onPress: () => setPayout(p) }] : undefined}
          />
        )}
      />
    );

  return (
    <Screen header={<FlatHeader back title={title} subtitle="Investment details" />}>
      {body}
      {inv ? (
        <>
          <CreateInvestmentSheet visible={action === "edit"} investment={inv} onClose={() => setAction(null)} onCreated={() => setAction(null)} />
          <AddCashSheet inv={inv} visible={action === "addCash"} onClose={() => setAction(null)} onDone={invalidate} />
          <WithdrawSheet inv={inv} visible={action === "withdraw"} onClose={() => setAction(null)} onDone={invalidate} />
          <CloseRenewSheet inv={inv} visible={action === "mature"} onClose={() => setAction(null)} onDone={invalidate} />
          <PayInterestSheet inv={inv} visible={action === "payInterest"} onClose={() => setAction(null)} onDone={invalidate} />
          <MarkPaidSheet inv={inv} payout={payout} onClose={() => setPayout(null)} onDone={invalidate} />
          <InvestmentLedgerEditSheet
            investmentId={inv.id}
            row={editing?.row ?? null}
            mode={editing?.mode ?? "edit"}
            live={isLive}
            minDate={inv.startDate?.slice(0, 10) || undefined}
            onClose={() => setEditing(null)}
          />
        </>
      ) : null}
    </Screen>
  );
}

