import React, { useState } from "react";
import { ScrollView, View, RefreshControl } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useRefetchOnFocus } from "../../../src/hooks/useRefetchOnFocus";
import { ScreenContainer } from "../../../src/components/ScreenContainer";
import { Card } from "../../../src/components/Card";
import { ThemedText } from "../../../src/components/ThemedText";
import { GoldTextInput } from "../../../src/components/GoldTextInput";
import { GoldDatePicker } from "../../../src/components/GoldDatePicker";
import { GoldButton } from "../../../src/components/GoldButton";
import { ChipSelect } from "../../../src/components/ChipSelect";
import { colors } from "../../../src/theme/colors";
import { useRole, useAuth } from "../../../src/auth/AuthContext";
import {
  getLoan,
  approveLoan,
  createExtensionRequest,
  createReleaseRequest,
  completeRelease,
  normalizeSanctionStage,
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
  resolveAuctionDecision,
} from "../../../src/api/auctions";
import {
  pendingDecision,
  hasUndisposedSurplus,
  AUCTION_OUTCOME_LABELS,
  type AuctionDecisionStatus,
  type AuctionSurplusDisposition,
} from "../../../src/types/auction";
import { ApiError } from "../../../src/api/client";
import { statusColors } from "../../../src/theme/colors";
import { printPledgeSlip, printStatement, printIndemnityBond, printPacketLabel } from "../../../src/utils/loanPrint";

// Mirrors frontend/modules/loans/components/Auctions.tsx's role gating —
// who may decide each kind of escalation.
const PARTIAL_DECISION_ROLES = ["Administrator", "Management", "Branch Manager", "Auction Administrator"];
const SHORTFALL_DECISION_ROLES = ["Administrator", "Management", "Branch Manager"];

// Payment types accepted by backend/internal/loan/model.go's PaymentType*
// constants — Auction Sale/Write-Off are system-generated only, never
// staff-entered here (mirrors frontend/components/modals/PaymentModal.tsx).
const PAYMENT_TYPES = ["Interest", "Principal", "Partial", "Full Settlement", "Adjustment", "Waiver"] as const;

// Mirrors frontend/common/components/modals/PaymentModal.tsx's METHODS —
// same fixed choices, kept as a dropdown/chip picker rather than free text
// so a staff-entered method can't drift from what the web app records.
const PAYMENT_METHODS = ["Cash", "UPI", "Bank Transfer", "Cheque"] as const;

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
  // Every auction action button below (mark eligible, issue notice,
  // schedule, record sale, settle, and the shortfall/partial-payment
  // decisions) was rendered with no permission check at all — any signed-in
  // role saw them as active/clickable, unlike the sanction-chain approval
  // buttons above (canActOnStage) or the web app's equivalent (`canAct` in
  // frontend/modules/loans/components/Auctions.tsx:98). Gates the same way
  // web does from here down.
  const { can } = useAuth();
  const canActOnAuction = can("Loan_Management", "can_update_loan");

  const loan = useQuery({ queryKey: ["loan", id], queryFn: () => getLoan(loanId), enabled: !!id });
  const auction = useQuery({
    queryKey: ["auction", id],
    queryFn: () => getAuction(loanId),
    enabled: !!id,
    retry: false,
  });

  // A status change made elsewhere (e.g. approving this loan on the web
  // admin) otherwise never shows up here: react-navigation keeps this
  // screen mounted once visited, and React Query has no browser-focus
  // event to refetch on in React Native — see useRefetchOnFocus's own
  // comment for the full explanation. Refetch every time this screen
  // regains focus, not just on its first mount.
  useRefetchOnFocus(loan.refetch, auction.refetch);

  const [error, setError] = useState<string | null>(null);

  // --- Print / documents state ----------------------------------------------
  const [printingLabel, setPrintingLabel] = useState(false);
  const [printingSlip, setPrintingSlip] = useState(false);
  const [printingStatement, setPrintingStatement] = useState(false);
  const [printingBond, setPrintingBond] = useState(false);

  // --- Auction form state (unchanged from v1) -------------------------------
  const [auctionDate, setAuctionDate] = useState("");
  const [referenceNumber, setReferenceNumber] = useState("");
  const [saleAmount, setSaleAmount] = useState("");
  const [auctionExpenses, setAuctionExpenses] = useState("");
  // --- Surplus disposition (Settle) and escalation-decision form state -----
  const [disposition, setDisposition] = useState<AuctionSurplusDisposition | "">("");
  const [dispositionRemarks, setDispositionRemarks] = useState("");
  const [decision, setDecision] = useState<Exclude<AuctionDecisionStatus, "Pending"> | "">("");
  const [decisionRemarks, setDecisionRemarks] = useState("");

  // --- Payment form state ---------------------------------------------------
  const [paymentType, setPaymentType] = useState<(typeof PAYMENT_TYPES)[number]>("Partial");
  const [paymentAmount, setPaymentAmount] = useState("");
  // Defaults to today, same as the web PaymentModal, but editable so staff
  // can backdate a payment instead of it being silently forced to "today".
  const [paymentDate, setPaymentDate] = useState(new Date().toISOString().slice(0, 10));
  // Defaults to the first option ("Cash"), matching the web modal's
  // `useState(METHODS[0])` — a fixed-choice field reads oddly with nothing
  // selected, and cash is the common case.
  const [paymentMethod, setPaymentMethod] = useState<(typeof PAYMENT_METHODS)[number]>(PAYMENT_METHODS[0]);
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
    mutationFn: () => settleAuction(loanId, disposition as AuctionSurplusDisposition, dispositionRemarks.trim() || undefined),
    onSuccess: () => {
      setDisposition("");
      setDispositionRemarks("");
      onOk();
    },
    onError,
  });
  const decideMutation = useMutation({
    mutationFn: (requestId: number) =>
      resolveAuctionDecision(loanId, requestId, decision as Exclude<AuctionDecisionStatus, "Pending">, decisionRemarks.trim() || undefined),
    onSuccess: () => {
      setDecision("");
      setDecisionRemarks("");
      onOk();
    },
    onError,
  });

  const pay = useMutation({
    mutationFn: () =>
      recordPayment(loanId, {
        amount: Number(paymentAmount),
        type: paymentType,
        paidOn: paymentDate,
        method: paymentMethod || undefined,
        reference: paymentReference || undefined,
        description: paymentDescription || undefined,
      }),
    onSuccess: () => {
      setPaymentAmount("");
      setPaymentDate(new Date().toISOString().slice(0, 10));
      setPaymentMethod(PAYMENT_METHODS[0]);
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
      <ScreenContainer style={{ padding: 0 }}>
        <View style={{ flex: 1, paddingHorizontal: 16, paddingTop: 16 }}>
      <ThemedText color={colors.muted}>Loading…</ThemedText>
        </View>
      </ScreenContainer>    );
  }
  if (loan.isError || !loan.data) {
    return (
      <ScreenContainer style={{ padding: 0 }}>
        <View style={{ flex: 1, paddingHorizontal: 16, paddingTop: 16 }}>
      <ThemedText color={colors.red}>Could not load this loan.</ThemedText>
        </View>
      </ScreenContainer>    );
  }

  const l = loan.data;
  const activePledge = l.bankPledges?.find((p) => p.status === "Active");

  // Mirrors frontend/components/LoanDetail.tsx's role-gating for who may act
  // on the current pending sanction stage — a UX nicety only; the server
  // (Service.Approve) enforces this regardless. The LoanOperator stage is a
  // verification (action "Verified"), the two above it are approvals.
  const pendingStage = normalizeSanctionStage(l.approvalStage);
  const requiredRole = pendingStage ? SANCTION_STAGE_ROLES[pendingStage] : null;
  const isVerifyStage = pendingStage === "LoanOperator";
  const canActOnStage = !!requiredRole && (myRole === "Administrator" || myRole === requiredRole);

  return (
    <ScreenContainer style={{ padding: 0 }}>
      <View style={{ flex: 1, paddingHorizontal: 16, paddingTop: 16 }}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={loan.isRefetching || auction.isRefetching}
            onRefresh={() => {
              loan.refetch();
              auction.refetch();
            }}
          />
        }
      >
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

        {/* --- Print / documents ------------------------------------------- */}
        <Card>
          <ThemedText variant="h3" style={{ marginBottom: 8 }}>
            Print
          </ThemedText>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            <GoldButton
              title={printingLabel ? "Preparing…" : "Print Label"}
              variant="outline"
              onPress={() => {
                setPrintingLabel(true);
                printPacketLabel(l)
                  .catch(() => setError("Could not print the packet label — try again."))
                  .finally(() => setPrintingLabel(false));
              }}
              disabled={printingLabel}
              style={{ height: 36, paddingHorizontal: 12 }}
            />
            <GoldButton
              title={printingSlip ? "Preparing…" : "Print Slip"}
              variant="outline"
              onPress={() => {
                setPrintingSlip(true);
                printPledgeSlip(l).finally(() => setPrintingSlip(false));
              }}
              disabled={printingSlip}
              style={{ height: 36, paddingHorizontal: 12 }}
            />
            <GoldButton
              title={printingStatement ? "Preparing…" : "Print Statement"}
              variant="outline"
              onPress={() => {
                setPrintingStatement(true);
                printStatement(l).finally(() => setPrintingStatement(false));
              }}
              disabled={printingStatement}
              style={{ height: 36, paddingHorizontal: 12 }}
            />
            <GoldButton
              title={printingBond ? "Preparing…" : "Print Pledge Agreement"}
              variant="outline"
              onPress={() => {
                setPrintingBond(true);
                printIndemnityBond(l).finally(() => setPrintingBond(false));
              }}
              disabled={printingBond}
              style={{ height: 36, paddingHorizontal: 12 }}
            />
          </View>
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
                    title={isVerifyStage ? "Verify" : "Approve"}
                    onPress={() => doApprove.mutate({ stage: pendingStage, action: isVerifyStage ? "Verified" : "Approved" })}
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
                {isVerifyStage ? `Awaiting ${requiredRole} verification` : `Awaiting ${requiredRole} approval`}
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
            <GoldDatePicker
              label="Payment date"
              value={paymentDate}
              onChange={setPaymentDate}
              max={new Date().toISOString().slice(0, 10)}
            />
            <ChipSelect options={PAYMENT_METHODS} value={paymentMethod} onChange={setPaymentMethod} label="Method" />
            <GoldTextInput label="Reference" value={paymentReference} onChangeText={setPaymentReference} />
            <GoldTextInput label="Description" value={paymentDescription} onChangeText={setPaymentDescription} />
            <GoldButton
              title="Record Payment"
              onPress={() => pay.mutate()}
              loading={pay.isPending}
              disabled={!paymentAmount || !paymentDate}
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

        {/* --- Auction (7-stage workflow) ------------------------------------------ */}
        {(() => {
          const rec = auction.data;
          const decisionReq = pendingDecision(rec);
          // While an escalation is open the pipeline is frozen server-side —
          // hiding the advance buttons keeps this honest instead of
          // offering actions that would just 409.
          const frozen = !!decisionReq;
          const canDecideThis =
            canActOnAuction &&
            !!myRole &&
            (decisionReq?.kind === "Shortfall"
              ? SHORTFALL_DECISION_ROLES.includes(myRole)
              : PARTIAL_DECISION_ROLES.includes(myRole));
          const balanceDue = l.status === "Auctioned - Balance Due";
          // getAuction only ever returns the loan's ACTIVE case (see
          // backend's loan.Service.getAuctionRecord) — once a case is
          // Settled/Withdrawn it comes back null, same as a loan that
          // never had one. l.status stays "Auctioned"/"Auctioned - Balance
          // Due" forever once gold is sold, including after the case
          // concludes, so treat a null `rec` alongside either of those
          // statuses as "already went through the pipeline", not "never
          // started" — mirrors the same fix in
          // frontend/modules/loans/components/Auctions.tsx.
          const alreadyAuctioned = l.status === "Auctioned" || l.status === "Auctioned - Balance Due";

          return (
            <Card>
              <ThemedText variant="h3" style={{ marginBottom: 8 }}>
                Auction
              </ThemedText>

              {!rec ? (
                alreadyAuctioned ? (
                  <ThemedText variant="small" color={colors.muted}>
                    This loan&apos;s gold was already sold at auction — see Auction History for the outcome.
                  </ThemedText>
                ) : l.status !== "Active" && l.status !== "Closed" ? (
                  canActOnAuction ? (
                    <GoldButton
                      title="Mark auction eligible"
                      onPress={() => eligible.mutate()}
                      loading={eligible.isPending}
                    />
                  ) : (
                    <ThemedText variant="small" color={colors.muted}>
                      Eligible for auction — your role can&apos;t mark it, though.
                    </ThemedText>
                  )
                ) : (
                  <ThemedText variant="small" color={colors.muted}>
                    Not eligible for auction.
                  </ThemedText>
                )
              ) : (
                <>
                  <ThemedText variant="label" style={{ marginBottom: 8 }}>
                    Stage: {rec.stage}
                  </ThemedText>

                  {/* Frozen-pipeline escalation banner + decision — the
                      same guarantee as the web app: a paying customer's
                      gold is never sold while their payment is under
                      review, and a shortfall never resumes/writes off
                      itself without a human ruling. */}
                  {decisionReq ? (
                    <View
                      style={{
                        backgroundColor: statusColors("red").bg,
                        borderColor: statusColors("red").fg,
                        borderWidth: 1,
                        borderRadius: 8,
                        padding: 10,
                        marginBottom: 12,
                      }}
                    >
                      <ThemedText variant="small" color={statusColors("red").fg} style={{ marginBottom: 8 }}>
                        {decisionReq.kind === "Shortfall"
                          ? `Shortfall — awaiting authority. The sale realised ₹${fmt(decisionReq.amountPaid)} and left ₹${fmt(decisionReq.outstandingAtRequest)} owing.`
                          : `Decision pending. ₹${fmt(decisionReq.amountPaid)} was paid, leaving ₹${fmt(decisionReq.outstandingAtRequest)} owing. No notice, schedule, or sale can proceed until this is resolved.`}
                        {!canDecideThis ? " Your role can view this but not decide it." : ""}
                      </ThemedText>
                      {canDecideThis ? (
                        <>
                          <ChipSelect
                            label="Decision"
                            options={
                              decisionReq.kind === "Shortfall"
                                ? (["PursueBalance", "WriteOff"] as const)
                                : (["RemovedFromAuction", "KeepInAuction"] as const)
                            }
                            value={decision || undefined}
                            onChange={setDecision}
                          />
                          <GoldTextInput
                            label={`Remarks${decisionReq.kind === "Shortfall" ? " *" : ""}`}
                            value={decisionRemarks}
                            onChangeText={setDecisionRemarks}
                            placeholder="reason for this decision"
                          />
                          <GoldButton
                            title="Record decision"
                            onPress={() => decideMutation.mutate(decisionReq.id)}
                            loading={decideMutation.isPending}
                            disabled={!decision || (decisionReq.kind === "Shortfall" && !decisionRemarks.trim())}
                          />
                        </>
                      ) : null}
                    </View>
                  ) : null}

                  {balanceDue && !decisionReq ? (
                    <ThemedText variant="small" color={colors.amber} style={{ marginBottom: 12 }}>
                      Balance due after auction — this loan has returned to normal collection. Record payments
                      against it as usual; the auction will close itself once the balance is cleared.
                    </ThemedText>
                  ) : null}

                  {!frozen && canActOnAuction && rec.stage === "AuctionEligible" ? (
                    <GoldButton title="Issue notice" onPress={() => notice.mutate()} loading={notice.isPending} />
                  ) : null}

                  {!frozen && canActOnAuction && rec.stage === "NoticeIssued" ? (
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

                  {!frozen && canActOnAuction && rec.stage === "AuctionScheduled" ? (
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

                  {rec.stage === "Auctioned" ? (
                    <>
                      <ThemedText variant="body" style={{ marginBottom: 8 }}>
                        Sale ₹{fmt(rec.saleAmount)} · {(rec.surplusShortfall ?? 0) >= 0 ? "Surplus" : "Shortfall"} ₹
                        {fmt(Math.abs(rec.surplusShortfall ?? 0))}
                      </ThemedText>
                      {/* Settle is the surplus-DISPOSITION step, so it only
                          applies once the sale actually left a surplus and
                          the loan isn't balance-due — mirrors
                          AuctionModal.tsx's SettleAuctionModalContent
                          exactly (RefundedToCustomer books a real cash-out;
                          RecordedAsIncome books none and needs a stated
                          reason). */}
                      {!frozen && canActOnAuction && !balanceDue && hasUndisposedSurplus(rec) ? (
                        <>
                          <ThemedText variant="small" color={colors.muted} style={{ marginBottom: 8 }}>
                            ₹{fmt(rec.surplusPayableAmount)} surplus is payable back to{" "}
                            {l.customer?.name ?? "the customer"} and has not been disposed of yet.
                          </ThemedText>
                          <ChipSelect
                            label="Surplus disposition"
                            options={["RefundedToCustomer", "RecordedAsIncome"] as const}
                            value={disposition || undefined}
                            onChange={setDisposition}
                          />
                          <GoldTextInput
                            label={`Remarks${disposition === "RecordedAsIncome" ? " *" : ""}`}
                            value={dispositionRemarks}
                            onChangeText={setDispositionRemarks}
                            placeholder="reason / reference"
                          />
                          <GoldButton
                            title="Settle"
                            onPress={() => settle.mutate()}
                            loading={settle.isPending}
                            disabled={!disposition || (disposition === "RecordedAsIncome" && !dispositionRemarks.trim())}
                          />
                        </>
                      ) : !balanceDue && !frozen ? (
                        <ThemedText variant="small" color={colors.muted}>
                          The sale exactly covered the debt — nothing left to settle.
                        </ThemedText>
                      ) : null}
                    </>
                  ) : null}

                  {rec.stage === "Settled" || rec.stage === "Withdrawn" ? (
                    <ThemedText variant="body" color={rec.stage === "Settled" ? colors.green : colors.muted}>
                      {rec.stage === "Settled"
                        ? AUCTION_OUTCOME_LABELS[rec.finalSettlementStatus ?? "Pending"]
                        : "Withdrawn — removed from auction"}
                    </ThemedText>
                  ) : null}
                </>
              )}
            </Card>
          );
        })()}
      </ScrollView>
      </View>
    </ScreenContainer>  );
}
