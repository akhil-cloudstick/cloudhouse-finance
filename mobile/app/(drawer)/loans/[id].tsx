import React, { useState } from "react";
import { ScrollView, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ScreenContainer } from "../../../src/components/ScreenContainer";
import { Card } from "../../../src/components/Card";
import { ThemedText } from "../../../src/components/ThemedText";
import { GoldTextInput } from "../../../src/components/GoldTextInput";
import { GoldButton } from "../../../src/components/GoldButton";
import { ChipSelect } from "../../../src/components/ChipSelect";
import { colors } from "../../../src/theme/colors";
import { useRole } from "../../../src/auth/AuthContext";
import {
  getLoan,
  approveLoan,
  listLoanApprovals,
  getLoanOperatorApprovalLimit,
  createExtensionRequest,
  createReleaseRequest,
  completeRelease,
  SANCTION_STAGES,
  SANCTION_STAGE_LABELS,
  SANCTION_STAGE_ROLES,
  type SanctionStage,
} from "../../../src/api/loans";
import { recordPayment } from "../../../src/api/payments";
import { recordBankPledge, releaseBankPledge } from "../../../src/api/bankPledges";
import { fmt } from "../../../src/lib/format";
import {
  getAuction,
  markAuctionEligible,
  issueAuctionNotice,
  scheduleAuction,
  recordAuctionSale,
  settleAuction,
} from "../../../src/api/auctions";
import { ApiError } from "../../../src/api/client";

// Payment types accepted by backend/internal/loan/model.go's PaymentType*
// constants — Auction Sale/Write-Off are system-generated only, never
// staff-entered here (mirrors frontend/components/modals/PaymentModal.tsx).
const PAYMENT_TYPES = ["Interest", "Principal", "Partial", "Full Settlement", "Adjustment", "Waiver"] as const;

// v2: adds Payments, Extension/Release requests, Bank Pledge, and the
// sanction-chain Approval workflow alongside the existing auction section —
// brings this screen to parity with frontend/components/LoanDetail.tsx
// (print label/slip and the release verification-checklist/approval-chain
// UI for staff processing an already-submitted release request are still
// gaps; see the file's top-level doc comment for what's covered).
export default function LoanDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const loanId = Number(id);
  const queryClient = useQueryClient();
  const myRole = useRole();

  const loan = useQuery({ queryKey: ["loan", id], queryFn: () => getLoan(loanId), enabled: !!id });
  const auction = useQuery({
    queryKey: ["auction", id],
    queryFn: () => getAuction(loanId),
    enabled: !!id,
    retry: false,
  });
  const approvals = useQuery({
    queryKey: ["loanApprovals", id],
    queryFn: () => listLoanApprovals(loanId),
    enabled: !!id,
  });
  // Mirrors LoanDetail.tsx:68-72 — lets the UI mirror the backend's
  // Loan-Operator-limit escalation instead of always gating the
  // LoanOperator stage to that role only.
  const operatorLimit = useQuery({
    queryKey: ["loanOperatorApprovalLimit"],
    queryFn: getLoanOperatorApprovalLimit,
  });

  const [error, setError] = useState<string | null>(null);

  // --- Auction form state (unchanged from v1) -------------------------------
  const [auctionDate, setAuctionDate] = useState("");
  const [referenceNumber, setReferenceNumber] = useState("");
  const [saleAmount, setSaleAmount] = useState("");
  const [auctionExpenses, setAuctionExpenses] = useState("");

  // --- Payment form state ---------------------------------------------------
  const [paymentType, setPaymentType] = useState<(typeof PAYMENT_TYPES)[number]>("Partial");
  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("");
  const [paymentReference, setPaymentReference] = useState("");
  const [paymentDescription, setPaymentDescription] = useState("");

  // --- Extension/Release request form state ---------------------------------
  const [extensionMonths, setExtensionMonths] = useState("");
  const [extensionDetail, setExtensionDetail] = useState("");
  const [releaseDetail, setReleaseDetail] = useState("");

  // --- Bank pledge form state -------------------------------------------------
  const [pledgeBankName, setPledgeBankName] = useState("");
  const [pledgeAmount, setPledgeAmount] = useState("");
  const [pledgeDate, setPledgeDate] = useState("");
  const [pledgeReference, setPledgeReference] = useState("");
  const [pledgeCashTreatment, setPledgeCashTreatment] = useState<"CashIn" | "RecordOnly">("RecordOnly");

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ["auction", id] });
    queryClient.invalidateQueries({ queryKey: ["loan", id] });
    queryClient.invalidateQueries({ queryKey: ["loanApprovals", id] });
  }
  function onError(err: unknown) {
    setError(err instanceof ApiError ? err.message : "Could not complete that action.");
  }
  function onOk() {
    setError(null);
    invalidate();
  }

  const eligible = useMutation({ mutationFn: () => markAuctionEligible(loanId), onSuccess: onOk, onError });
  const notice = useMutation({ mutationFn: () => issueAuctionNotice(loanId), onSuccess: onOk, onError });
  const schedule = useMutation({
    mutationFn: () => scheduleAuction(loanId, auctionDate, referenceNumber || undefined),
    onSuccess: onOk,
    onError,
  });
  const sale = useMutation({
    mutationFn: () => recordAuctionSale(loanId, Number(saleAmount), auctionExpenses ? Number(auctionExpenses) : undefined),
    onSuccess: onOk,
    onError,
  });
  const settle = useMutation({
    mutationFn: (status: string) => settleAuction(loanId, status),
    onSuccess: onOk,
    onError,
  });

  const pay = useMutation({
    mutationFn: () =>
      recordPayment(loanId, {
        amount: Number(paymentAmount),
        type: paymentType,
        paidOn: new Date().toISOString().slice(0, 10),
        method: paymentMethod || undefined,
        reference: paymentReference || undefined,
        description: paymentDescription || undefined,
      }),
    onSuccess: () => {
      setPaymentAmount("");
      setPaymentMethod("");
      setPaymentReference("");
      setPaymentDescription("");
      onOk();
    },
    onError,
  });

  const requestExtension = useMutation({
    mutationFn: () =>
      createExtensionRequest(loanId, {
        months: Number(extensionMonths),
        detail: extensionDetail || undefined,
        requestedBy: "Staff",
      }),
    onSuccess: () => {
      setExtensionMonths("");
      setExtensionDetail("");
      onOk();
    },
    onError,
  });

  const requestRelease = useMutation({
    mutationFn: () => createReleaseRequest(loanId, { detail: releaseDetail || undefined, requestedBy: "Staff" }),
    onSuccess: () => {
      setReleaseDetail("");
      onOk();
    },
    onError,
  });

  const doCompleteRelease = useMutation({ mutationFn: () => completeRelease(loanId), onSuccess: onOk, onError });

  const doApprove = useMutation({
    mutationFn: (vars: { stage: SanctionStage; action: "Approved" | "Rejected" | "Verified" }) =>
      approveLoan(loanId, vars),
    onSuccess: onOk,
    onError,
  });

  const doRecordPledge = useMutation({
    mutationFn: () =>
      recordBankPledge(loanId, {
        bankName: pledgeBankName,
        pledgedAmount: Number(pledgeAmount),
        pledgeDate: pledgeDate || new Date().toISOString().slice(0, 10),
        referenceNumber: pledgeReference || undefined,
        cashTreatment: pledgeCashTreatment,
      }),
    onSuccess: () => {
      setPledgeBankName("");
      setPledgeAmount("");
      setPledgeDate("");
      setPledgeReference("");
      onOk();
    },
    onError,
  });

  const doReleasePledge = useMutation({
    mutationFn: (pledgeId: number) => releaseBankPledge(loanId, pledgeId),
    onSuccess: onOk,
    onError,
  });

  if (loan.isLoading) {
    return (
      <ScreenContainer>
        <ThemedText color={colors.muted}>Loading…</ThemedText>
      </ScreenContainer>
    );
  }
  if (loan.isError || !loan.data) {
    return (
      <ScreenContainer>
        <ThemedText color={colors.red}>Could not load this loan.</ThemedText>
      </ScreenContainer>
    );
  }

  const l = loan.data;
  const activePledge = l.bankPledges?.find((p) => p.status === "Active");

  // Mirrors frontend/components/LoanDetail.tsx:141-163's role-gating logic
  // for who may act on the current pending sanction stage — a UX nicety
  // only; the server (Service.Approve) enforces this regardless.
  const pendingStageIndex = SANCTION_STAGES.indexOf(l.approvalStage as SanctionStage);
  const pendingStage = pendingStageIndex >= 0 ? SANCTION_STAGES[pendingStageIndex] : null;
  const requiredRole = pendingStage ? SANCTION_STAGE_ROLES[pendingStage] : null;
  const operatorVerified = !!approvals.data?.some((r) => r.stage === "LoanOperator" && r.action === "Verified");
  const operatorLimitExceeded =
    pendingStage === "LoanOperator" && operatorLimit.data != null && l.principalAmount > operatorLimit.data.maxAmount;
  const canVerify = operatorLimitExceeded && myRole === "Loan Operator" && !operatorVerified;
  const canActOnStage =
    !!requiredRole &&
    (myRole === "Administrator" ||
      (myRole === requiredRole && !operatorLimitExceeded) ||
      (operatorLimitExceeded && operatorVerified && (myRole === "Branch Manager" || myRole === "Management")));

  return (
    <ScreenContainer>
      <ScrollView showsVerticalScrollIndicator={false}>
        <Card>
          <ThemedText variant="h2" color={colors.goldDeep}>
            {l.loanNumber}
          </ThemedText>
          <ThemedText variant="body" style={{ marginTop: 8 }}>
            {l.customer?.name ?? `Customer #${l.customerId}`}
          </ThemedText>
          <ThemedText variant="label" style={{ marginTop: 12 }}>
            Status: {l.status}
          </ThemedText>
          <ThemedText variant="body" style={{ marginTop: 4 }}>
            Principal {fmt(l.principalAmount)}
          </ThemedText>
          <ThemedText variant="body" color={colors.muted}>
            Outstanding {fmt(l.outstandingAmount)}
          </ThemedText>
          {l.outstandingInterest != null && (
            <ThemedText variant="small" color={colors.muted} style={{ marginTop: 4 }}>
              Outstanding interest {fmt(l.outstandingInterest)}
              {l.outstandingPenalInterest ? ` · Penal ${fmt(l.outstandingPenalInterest)}` : ""}
            </ThemedText>
          )}
          {l.settlementAmount != null && (
            <ThemedText variant="small" color={colors.muted} style={{ marginTop: 4 }}>
              Final settlement {fmt(l.settlementAmount)}
            </ThemedText>
          )}
          <ThemedText variant="small" color={colors.muted} style={{ marginTop: 8 }}>
            Due {new Date(l.dueDate).toDateString()}
          </ThemedText>
        </Card>

        {error ? (
          <Card>
            <ThemedText variant="small" color={colors.red}>
              {error}
            </ThemedText>
          </Card>
        ) : null}

        {/* --- Sanction-chain approval, only while a stage is pending -------- */}
        {pendingStage ? (
          <Card>
            <ThemedText variant="h3" style={{ marginBottom: 8 }}>
              Approval — {SANCTION_STAGE_LABELS[pendingStage]}
            </ThemedText>
            {l.approvalWarning ? (
              <ThemedText variant="small" color={colors.gold} style={{ marginBottom: 8 }}>
                {l.approvalWarning}
              </ThemedText>
            ) : null}
            {canActOnStage ? (
              <View style={{ flexDirection: "row", gap: 8 }}>
                <View style={{ flex: 1 }}>
                  <GoldButton
                    title="Approve"
                    onPress={() => doApprove.mutate({ stage: pendingStage, action: "Approved" })}
                    loading={doApprove.isPending}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <GoldButton
                    title="Reject"
                    variant="outline"
                    onPress={() => doApprove.mutate({ stage: pendingStage, action: "Rejected" })}
                    loading={doApprove.isPending}
                  />
                </View>
              </View>
            ) : canVerify ? (
              <View style={{ flexDirection: "row", gap: 8 }}>
                <View style={{ flex: 1 }}>
                  <GoldButton
                    title="Verify & Escalate"
                    onPress={() => doApprove.mutate({ stage: pendingStage, action: "Verified" })}
                    loading={doApprove.isPending}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <GoldButton
                    title="Reject"
                    variant="outline"
                    onPress={() => doApprove.mutate({ stage: pendingStage, action: "Rejected" })}
                    loading={doApprove.isPending}
                  />
                </View>
              </View>
            ) : (
              <ThemedText variant="small" color={colors.muted}>
                {operatorLimitExceeded
                  ? operatorVerified
                    ? "Verified by Loan Operator — awaiting Branch Manager or Management approval"
                    : "Principal exceeds the Loan Operator's approval limit — awaiting Loan Operator verification"
                  : `Awaiting ${requiredRole} approval`}
              </ThemedText>
            )}
          </Card>
        ) : null}

        {/* --- Payments ------------------------------------------------------- */}
        {l.status !== "Closed" ? (
          <Card>
            <ThemedText variant="h3" style={{ marginBottom: 8 }}>
              Record Payment
            </ThemedText>
            <ChipSelect options={PAYMENT_TYPES} value={paymentType} onChange={setPaymentType} label="Type" />
            <GoldTextInput
              label="Amount"
              keyboardType="numeric"
              value={paymentAmount}
              onChangeText={setPaymentAmount}
            />
            <GoldTextInput label="Method (e.g. Cash, UPI)" value={paymentMethod} onChangeText={setPaymentMethod} />
            <GoldTextInput label="Reference" value={paymentReference} onChangeText={setPaymentReference} />
            <GoldTextInput label="Description" value={paymentDescription} onChangeText={setPaymentDescription} />
            <GoldButton
              title="Record Payment"
              onPress={() => pay.mutate()}
              loading={pay.isPending}
              disabled={!paymentAmount}
            />
          </Card>
        ) : null}

        {/* --- Extension request ----------------------------------------------- */}
        {l.status !== "Closed" ? (
          <Card>
            <ThemedText variant="h3" style={{ marginBottom: 8 }}>
              Request Extension
            </ThemedText>
            <GoldTextInput
              label="Months"
              keyboardType="numeric"
              value={extensionMonths}
              onChangeText={setExtensionMonths}
            />
            <GoldTextInput label="Detail" value={extensionDetail} onChangeText={setExtensionDetail} />
            <GoldButton
              title="Submit Extension Request"
              onPress={() => requestExtension.mutate()}
              loading={requestExtension.isPending}
              disabled={!extensionMonths}
            />
          </Card>
        ) : null}

        {/* --- Release request / complete release -------------------------------- */}
        {l.status !== "Closed" ? (
          <Card>
            <ThemedText variant="h3" style={{ marginBottom: 8 }}>
              Release
            </ThemedText>
            {l.status === "Closure Requested" ? (
              <>
                <ThemedText variant="small" color={colors.muted} style={{ marginBottom: 8 }}>
                  {l.totalOutstandingBalance != null && l.totalOutstandingBalance > 0.01
                    ? "Final settlement must be fully paid first."
                    : l.bankPledgeStatus === "Bank Pledged"
                      ? "Release the bank pledge first."
                      : "Ready to complete — hands the gold back and closes the loan."}
                </ThemedText>
                <GoldButton
                  title="Complete Release"
                  onPress={() => doCompleteRelease.mutate()}
                  loading={doCompleteRelease.isPending}
                  disabled={
                    (l.totalOutstandingBalance ?? 0) > 0.01 || l.bankPledgeStatus === "Bank Pledged"
                  }
                />
              </>
            ) : (
              <>
                <GoldTextInput label="Detail" value={releaseDetail} onChangeText={setReleaseDetail} />
                <GoldButton
                  title="Submit Release Request"
                  onPress={() => requestRelease.mutate()}
                  loading={requestRelease.isPending}
                />
                <ThemedText variant="small" color={colors.muted} style={{ marginTop: 8 }}>
                  Verification-checklist and Manager/Management approval-chain steps for a submitted release
                  request aren't in this build yet — process those from the web app.
                </ThemedText>
              </>
            )}
          </Card>
        ) : null}

        {/* --- Bank Pledge ------------------------------------------------------ */}
        <Card>
          <ThemedText variant="h3" style={{ marginBottom: 8 }}>
            Bank Pledge
          </ThemedText>
          {activePledge ? (
            <>
              <ThemedText variant="body">{activePledge.bankName}</ThemedText>
              <ThemedText variant="small" color={colors.muted}>
                Pledged ₹{activePledge.pledgedAmount.toLocaleString("en-IN")} on {activePledge.pledgeDate}
                {activePledge.referenceNumber ? ` · Ref ${activePledge.referenceNumber}` : ""}
              </ThemedText>
              <ThemedText variant="small" color={colors.muted} style={{ marginBottom: 8 }}>
                {activePledge.cashTreatment === "CashIn"
                  ? "Added to Cash-in-Hand"
                  : "Record only — no cash effect"}
              </ThemedText>
              <GoldButton
                title="Release from Bank"
                variant="outline"
                onPress={() => doReleasePledge.mutate(activePledge.id)}
                loading={doReleasePledge.isPending}
              />
            </>
          ) : l.status !== "Closed" ? (
            <>
              <GoldTextInput label="Bank Name" value={pledgeBankName} onChangeText={setPledgeBankName} />
              <GoldTextInput
                label="Pledged Amount"
                keyboardType="numeric"
                value={pledgeAmount}
                onChangeText={setPledgeAmount}
              />
              <GoldTextInput
                label="Pledge Date (YYYY-MM-DD)"
                value={pledgeDate}
                onChangeText={setPledgeDate}
              />
              <GoldTextInput label="Reference Number" value={pledgeReference} onChangeText={setPledgeReference} />
              <ChipSelect
                options={["RecordOnly", "CashIn"] as const}
                value={pledgeCashTreatment}
                onChange={setPledgeCashTreatment}
                label="Cash Treatment"
              />
              <GoldButton
                title="Repledge to Bank"
                onPress={() => doRecordPledge.mutate()}
                loading={doRecordPledge.isPending}
                disabled={!pledgeBankName || !pledgeAmount}
              />
            </>
          ) : (
            <ThemedText variant="small" color={colors.muted}>
              Gold is {l.bankPledgeStatus === "Released" ? "released to customer" : "held in-house"} —{" "}
              {l.bankPledgeStatus}
            </ThemedText>
          )}
        </Card>

        {/* --- Auction (7-stage workflow, unchanged from v1) ----------------------- */}
        <Card>
          <ThemedText variant="h3" style={{ marginBottom: 8 }}>
            Auction
          </ThemedText>

          {!auction.data ? (
            <GoldButton
              title="Mark auction eligible"
              onPress={() => eligible.mutate()}
              loading={eligible.isPending}
            />
          ) : (
            <>
              <ThemedText variant="label" style={{ marginBottom: 8 }}>
                Stage: {auction.data.stage}
              </ThemedText>

              {auction.data.stage === "AuctionEligible" ? (
                <GoldButton title="Issue notice" onPress={() => notice.mutate()} loading={notice.isPending} />
              ) : null}

              {auction.data.stage === "NoticeIssued" ? (
                <>
                  <GoldTextInput
                    label="Auction date (YYYY-MM-DD)"
                    value={auctionDate}
                    onChangeText={setAuctionDate}
                  />
                  <GoldTextInput
                    label="Reference number"
                    value={referenceNumber}
                    onChangeText={setReferenceNumber}
                  />
                  <GoldButton
                    title="Schedule auction"
                    onPress={() => schedule.mutate()}
                    loading={schedule.isPending}
                    disabled={!auctionDate}
                  />
                </>
              ) : null}

              {auction.data.stage === "AuctionScheduled" ? (
                <>
                  <GoldTextInput
                    label="Sale amount"
                    keyboardType="numeric"
                    value={saleAmount}
                    onChangeText={setSaleAmount}
                  />
                  <GoldTextInput
                    label="Auction expenses"
                    keyboardType="numeric"
                    value={auctionExpenses}
                    onChangeText={setAuctionExpenses}
                  />
                  <GoldButton
                    title="Record sale"
                    onPress={() => sale.mutate()}
                    loading={sale.isPending}
                    disabled={!saleAmount}
                  />
                </>
              ) : null}

              {auction.data.stage === "Auctioned" ? (
                <>
                  <ThemedText variant="body" style={{ marginBottom: 8 }}>
                    Sale ₹{auction.data.saleAmount?.toLocaleString("en-IN")} · Surplus/Shortfall{" "}
                    ₹{auction.data.surplusShortfall?.toLocaleString("en-IN")}
                  </ThemedText>
                  <GoldButton
                    title="Settle to customer"
                    onPress={() => settle.mutate("SettledToCustomer")}
                    loading={settle.isPending}
                  />
                  <GoldButton
                    title="Settle to loan company"
                    variant="outline"
                    onPress={() => settle.mutate("SettledToLoanCo")}
                    loading={settle.isPending}
                  />
                </>
              ) : null}

              {auction.data.stage === "Settled" ? (
                <ThemedText variant="body" color={colors.green}>
                  Settled — {auction.data.finalSettlementStatus}
                </ThemedText>
              ) : null}
            </>
          )}
        </Card>
      </ScrollView>
    </ScreenContainer>
  );
}
