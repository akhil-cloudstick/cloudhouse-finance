import React, { useState } from "react";
import { View } from "react-native";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  AccRow,
  BtnRow2,
  C,
  FabMenu,
  Field,
  FlatHeader,
  Input,
  NoticeBanner,
  PillTabs,
  PrimaryButton,
  Screen,
  SearchInput,
  ServerFlatList,
  Sheet,
  Txt,
  WarningBanner,
  openPage,
} from "../../../src/components/ui";
import { AddBankPledgeSheet, BanksSheet, invalidateBankPledgeViews } from "../../../src/components/staff/BankPledgeSheets";
import { useServerList } from "../../../src/hooks/useServerList";
import {
  listBankPledgedLoansPage,
  listBankPledgeHistoryPage,
  releaseBankPledge,
  voidBankPledge,
  type BankPledgeHistoryRow,
  type BankPledgeRecordWithWeights,
} from "../../../src/api/bankPledges";
import { ApiError } from "../../../src/api/client";
import { useAuth } from "../../../src/auth/AuthContext";
import { dmy, inr } from "../../../src/lib/format";
import type { Loan } from "../../../src/types/loan";

// Bank Pledges — prototype #header-bankpledges + #page-bankpledges, Add to
// Bank Pledge and Add Bank sheets. Active = loans currently pledged
// (GET /loans?bankPledgeStatus=Bank Pledged), History = every pledge record
// (GET /loans/bank-pledges/history); both server-searched and paged.

const TABS = ["active", "history"] as const;
type Tab = (typeof TABS)[number];
const TAB_LABELS: Record<Tab, string> = { active: "Active", history: "History" };

// Mirrors the server-side guard on the void endpoint — hiding the button is
// a convenience, the backend rejects other roles regardless.
const VOID_ROLES = ["Administrator", "Management", "Branch Manager"];

const or = (v?: string | null) => (v && v.trim() ? v : "—");
const errMsg = (e: unknown, fallback: string) => (e instanceof ApiError ? e.message : fallback);
const cashLabel = (t?: string) => (t === "CashIn" ? "Cash Added" : "Record Only");
// "Voided" stays the wire value; the UI calls it "Deleted" (matches web).
const statusLabel = (s: string) => (s === "Voided" ? "Deleted" : s);

type PledgeTarget = { loanId: number; loanNumber: string; pledge: BankPledgeRecordWithWeights };
const activePledgeOf = (l: Loan) => l.bankPledges?.find((p) => p.status === "Active") as BankPledgeRecordWithWeights | undefined;
const errText = (msg: string | null) => (msg ? <Txt style={{ fontSize: 12, color: C.red, marginBottom: 10 }}>{msg}</Txt> : null);

export default function BankPledgeScreen() {
  const qc = useQueryClient();
  const { can, employee } = useAuth();
  const canCreatePledge = can("Bank_Pledge_Management", "can_create_bank_pledge");
  const canUpdatePledges = can("Bank_Pledge_Management", "can_update_bank_pledge");
  const canVoid = canUpdatePledges && !!employee?.role && VOID_ROLES.includes(employee.role);
  const canViewBanks = can("Bank_Management", "can_view_bank_module");
  const canViewLoans = can("Loan_Management", "can_view_loan_module");

  const [tab, setTab] = useState<Tab>("active");
  const [addPledge, setAddPledge] = useState(false);
  const [banksOpen, setBanksOpen] = useState(false);
  const [releaseTarget, setReleaseTarget] = useState<PledgeTarget | null>(null);
  const [releaseError, setReleaseError] = useState<string | null>(null);
  const [voidTarget, setVoidTarget] = useState<PledgeTarget | null>(null);
  const [voidReason, setVoidReason] = useState("");
  const [voidError, setVoidError] = useState<string | null>(null);

  const active = useServerList<Loan>({ key: ["bankPledges", "active"], fetchPage: (p) => listBankPledgedLoansPage(p), enabled: tab === "active" });
  const history = useServerList<BankPledgeHistoryRow>({ key: ["bankPledges", "history"], fetchPage: (p) => listBankPledgeHistoryPage(p), enabled: tab === "history" });

  const release = useMutation({
    mutationFn: (t: PledgeTarget) => releaseBankPledge(t.loanId, t.pledge.id),
    onSuccess: () => {
      setReleaseTarget(null);
      invalidateBankPledgeViews(qc);
    },
    onError: (err) => setReleaseError(errMsg(err, "Could not release the pledge.")),
  });
  const voidPledge = useMutation({
    mutationFn: (t: PledgeTarget) => voidBankPledge(t.loanId, t.pledge.id, voidReason.trim()),
    onSuccess: () => {
      setVoidTarget(null);
      setVoidReason("");
      invalidateBankPledgeViews(qc);
    },
    onError: (err) => setVoidError(errMsg(err, "Could not delete the pledge entry — try again.")),
  });

  const openLoan = (id: number) => {
    openPage(`/loans/${id}`);
  };

  const header = (
    <>
      <PillTabs tabs={TABS} value={tab} onChange={setTab} labels={TAB_LABELS} />
    </>
  );

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
        <ServerFlatList
          list={active}
          items={active.items}
          keyOf={(l) => String(l.id)}
          emptyText={active.search ? "No pledges match your search." : "No loans currently bank-pledged."}
          header={
            <>
              {header}
              <SearchInput value={active.search} onChangeText={active.setSearch} placeholder="Search by loan ID, bank, or customer name" style={{ paddingTop: 12, paddingBottom: 8 }} />
            </>
          }
          renderItem={(l, i) => {
            const p = activePledgeOf(l);
            const weight = p?.pledgedNetWeight || l.totalNetWeight;
            const target = p ? { loanId: l.id, loanNumber: l.loanNumber, pledge: p } : null;
            return (
              <AccRow
                defaultOpen={i === 0}
                id={l.loanNumber}
                name={or(l.customer?.name)}
                sub={or(p?.bankName)}
                amount={p ? inr(p.pledgedAmount) : undefined}
                details={[
                  { k: "Weight", v: weight ? `${+Number(weight).toFixed(2)} g` : "—" },
                  { k: "Cash treatment", v: p ? cashLabel(p.cashTreatment) : "—" },
                  { k: "Pledged on", v: dmy(p?.pledgeDate) },
                  { k: "Due date", v: dmy(p?.bankPledgeDueDate) },
                  { k: "Ref no", v: or(p?.referenceNumber) },
                ]}
                actions={[
                  ...(target && canUpdatePledges
                    ? [
                        {
                          label: "Release",
                          onPress: () => {
                            setReleaseError(null);
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
                            setVoidError(null);
                            setVoidReason("");
                            setVoidTarget(target);
                          },
                        },
                      ]
                    : []),
                  ...(canViewLoans && (!target || (!canUpdatePledges && !canVoid)) ? [{ label: "View Loan", onPress: () => openLoan(l.id) }] : []),
                ]}
              />
            );
          }}
        />
      ) : (
        <ServerFlatList
          list={history}
          items={history.items}
          keyOf={(r) => String(r.id)}
          emptyText={history.search ? "No pledge history matches your search." : "No re-pledge records yet."}
          header={
            <>
              {header}
              <SearchInput value={history.search} onChangeText={history.setSearch} placeholder="Search by loan ID, bank, or customer name" style={{ paddingTop: 12, paddingBottom: 8 }} />
            </>
          }
          renderItem={(r) => (
            <AccRow
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
                ...(r.status === "Voided" ? [{ k: "Delete reason", v: or(r.voidReason) }] : []),
              ]}
              actions={canViewLoans ? [{ label: "View Loan", onPress: () => openLoan(r.loanId) }] : undefined}
            />
          )}
        />
      )}

      <AddBankPledgeSheet visible={addPledge} onClose={() => setAddPledge(false)} />
      <BanksSheet visible={banksOpen} onClose={() => setBanksOpen(false)} />

      <Sheet visible={!!releaseTarget} onClose={() => setReleaseTarget(null)} title="Release Bank Pledge" maxHeightPct={60}>
        {releaseTarget ? (
          <>
            <Txt style={{ fontSize: 13, marginTop: 10, marginBottom: 12 }}>
              Release the gold of {releaseTarget.loanNumber} pledged to {releaseTarget.pledge.bankName} for {inr(releaseTarget.pledge.pledgedAmount)}?
            </Txt>
            <NoticeBanner>
              {releaseTarget.pledge.cashTreatment === "CashIn"
                ? `${inr(releaseTarget.pledge.pledgedAmount)} will be booked out of Cash-in-Hand.`
                : "No cash movement will be created — this pledge was recorded only."}
            </NoticeBanner>
            {errText(releaseError)}
            <BtnRow2>
              <PrimaryButton label="Cancel" variant="outline" onPress={() => setReleaseTarget(null)} disabled={release.isPending} />
              <PrimaryButton label="Release" onPress={() => release.mutate(releaseTarget)} loading={release.isPending} />
            </BtnRow2>
          </>
        ) : null}
      </Sheet>

      <Sheet visible={!!voidTarget} onClose={() => setVoidTarget(null)} title="Delete Repledge Record" maxHeightPct={70}>
        {voidTarget ? (
          <>
            <View style={{ marginTop: 10 }}>
              <WarningBanner>
                {`Cancels the ${inr(voidTarget.pledge.pledgedAmount)} pledge of ${voidTarget.loanNumber} to ${voidTarget.pledge.bankName} entered in error.${
                  voidTarget.pledge.cashTreatment === "CashIn"
                    ? ` A compensating cash-out of ${inr(voidTarget.pledge.pledgedAmount)} will be booked.`
                    : " No cash will move — this pledge was recorded only."
                } The record stays in history for audit. Use Release instead if the gold is actually being returned.`}
              </WarningBanner>
            </View>
            <Field label="Reason *">
              <Input value={voidReason} onChangeText={setVoidReason} placeholder="Why this record is being cancelled" maxLength={255} />
            </Field>
            {errText(voidError)}
            <PrimaryButton label="Delete Entry" variant="danger" onPress={() => voidPledge.mutate(voidTarget)} loading={voidPledge.isPending} disabled={!voidReason.trim()} />
          </>
        ) : null}
      </Sheet>
    </Screen>
  );
}
