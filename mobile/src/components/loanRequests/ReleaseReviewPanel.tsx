import React, { useEffect, useState } from "react";
import { View } from "react-native";
import { usePathname } from "expo-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  AccBtn,
  BtnRow2,
  C,
  Card,
  CheckItem,
  DateField,
  Field,
  FieldGrid,
  FieldRow,
  Input,
  PaymentSplit,
  PrimaryButton,
  ReviewWarning,
  SectionTitle,
  SheetListItem,
  TextField,
  Txt,
  WarningBanner,
  ZERO_SPLIT,
  isBalanced,
  type SplitAmounts,
  SheetFooter,
  Stepper,
  ConfirmSheet,
  toast,
  openPage,
} from "../ui";
import { inr, todayISO } from "../../lib/format";
import { useAuth } from "../../auth/AuthContext";
import { verifyReleaseChecklist, recordReleasePayment, approveReleaseRequest } from "../../api/loans";
import { isFinalStage, stageByPending, stageIndex, canActAtStage, stepperSteps, useApprovalWorkflow } from "../../api/approvalWorkflow";
import { listPackets } from "../../api/packets";
import { printReleaseAgreementPdf, printPartialReleaseReceiptPdf, RELEASE_AGREEMENT_LANGS, DOC_LANG_LABELS, type DocLang } from "../../utils/loanPrint";
import { LoanRequest, Loan } from "../../types/loan";
import { ApiError } from "../../api/client";


// Mirrors backend partialReleaseDrift: what the remaining collateral can't
// cover at the scheme LTV. ApproveReleaseRequest refuses a partial release
// with drift > 0.01 (ErrDriftPaymentRequired); the backend stays the authority.
function partialReleaseDrift(outstanding: number, remainingGoldValue: number, ltvPercent: number) {
  return outstanding - (remainingGoldValue * ltvPercent) / 100;
}

/* Review for one Pending Release request, mirroring frontend/common/
 * components/modals/ReleaseReviewModal.tsx: "customer has seen the gold",
 * Record Payment (with a mode split), and the Manager → Management approval.
 * Final approval completes the release server-side (full: closes the loan;
 * partial: hands back only the selected ornaments). Drawn as the prototype's
 * #release-review-modal body. Used by the loan detail screen's release sheet
 * and the Requests list sheet — props API unchanged. */
export function ReleaseReviewPanel({ request, loan, onSaved, onError }: { request: LoanRequest; loan: Loan; onSaved: () => void; onError: (message: string) => void }) {
  const pathname = usePathname();
  // The Bank Pledge action this would link to is already on this very
  // screen when the panel is embedded in the loan detail page — so that
  // link is only shown from elsewhere (the Requests screen).
  const onThisLoanPage = pathname === `/loans/${loan.id}`;
  const { can, employee } = useAuth();
  const canDecide = can("Loan_Management", "can_update_loan");
  const canVerifyChecklist = can("Release_Approval", "can_verify_release_checklist");
  // Tenant-configured "loan_release" chain. An empty approvalStage is the
  // PendingManager position (it doubles as "awaiting payment"), which the
  // request can sit on even when the Manager stage is switched off.
  const wf = useApprovalWorkflow();
  const pendingValue = request.approvalStage || "PendingManager";
  const stageDef = stageByPending(wf, "loan_release", pendingValue);
  const stage = stageDef?.key ?? "Manager";
  const stageLabel = stageDef?.label ?? "Manager";
  const isFinal = isFinalStage(wf, "loan_release", pendingValue);
  const steps = stepperSteps(wf, "loan_release", pendingValue);
  const canActOnStage = !!stageDef && canActAtStage(employee?.role, stageDef);
  // RecordReleasePayment is refused past the Manager stage.
  const canRecordPayment = request.approvalStage === "" || request.approvalStage === "PendingManager";
  const isPending = request.status === "Pending";

  const [charges, setCharges] = useState(String(request.charges || 0));
  const [notes, setNotes] = useState(request.verificationNotes || "");
  const [discount, setDiscount] = useState("0");
  const [amount, setAmount] = useState("");
  const [split, setSplit] = useState<SplitAmounts>(ZERO_SPLIT);
  const [reference, setReference] = useState("");
  const [dueDate, setDueDate] = useState(request.paymentDueDate || "");
  // Language being fetched ("partial" for the partial-release receipt).
  const [downloading, setDownloading] = useState<DocLang | "partial" | null>(null);
  // Seed editable fields only when a different request arrives, so a
  // background refetch never stomps on what staff is typing.
  const [seenId, setSeenId] = useState(request.id);
  useEffect(() => {
    if (request.id !== seenId) {
      setCharges(String(request.charges || 0));
      setNotes(request.verificationNotes || "");
      setDueDate(request.paymentDueDate || "");
      setSeenId(request.id);
    }
  }, [request, seenId]);

  // Gold can't be shown to the customer while it's pledged to a bank or in a locker.
  const packet = useQuery({
    queryKey: ["packets", "forLoan", loan.id],
    queryFn: () => listPackets({ loanId: loan.id }),
    enabled: isPending,
  });
  const packetRecord = packet.data?.[0];
  const packetStatus = packetRecord?.status;
  const bankPledged = loan.bankPledgeStatus === "Bank Pledged" || !!loan.bankPledges?.some((p) => p.status === "Active");
  const inLocker = packetStatus === "Locker Stored";
  const goldStillHeld = bankPledged || inLocker;
  const goldHeldReason = bankPledged ? "pledged to a bank" : "checked into a locker";

  const outstanding = loan.totalOutstandingBalance ?? loan.outstandingAmount;
  const ltv = loan.schemeLtvPercent ?? loan.scheme?.ltvPercent ?? 0;
  const selectedIds = new Set((request.ornamentSelections ?? []).map((s) => s.ornamentId));
  const pledged = (loan.ornaments ?? []).filter((o) => !o.releasedAt);
  const selectedOrnaments = pledged.filter((o) => selectedIds.has(o.id));
  // A full release covers every still-pledged ornament.
  const shownOrnaments = request.isPartial ? selectedOrnaments : pledged;
  const remainingGoldValue = request.isPartial ? pledged.filter((o) => !selectedIds.has(o.id)).reduce((s, o) => s + o.goldValue, 0) : 0;
  const drift = request.isPartial ? partialReleaseDrift(outstanding, remainingGoldValue, ltv) : 0;

  const unappliedCharges = Math.max(0, (+charges || 0) - request.chargesApplied);
  // What still has to come in for the release condition: the whole balance
  // for a full release, only the drift for a partial one.
  const required = (request.isPartial ? Math.max(0, drift) : outstanding) + unappliedCharges;
  const paymentConditionMet = !!request.paymentRecorded || (request.isPartial ? drift <= 0.01 : outstanding <= 0.01);
  const shortAfter = required - (+discount || 0) - (+amount || 0);
  const needsDueDate = !request.isPartial && shortAfter > 0.01;
  // Blocked outright while the gold is at a bank or in a locker — it has to
  // come back (bank pledge released / packet checked out) first.
  const canApprove = !goldStillHeld && !!request.customerSawGold && paymentConditionMet;

  // Prefill the amount (and an all-cash split) with what's required, once per request.
  const [prefilledFor, setPrefilledFor] = useState<number | null>(null);
  useEffect(() => {
    if (prefilledFor !== request.id && canRecordPayment && isPending) {
      const amt = Math.max(0, +required.toFixed(2));
      setAmount(String(amt));
      setSplit({ ...ZERO_SPLIT, cashAmount: amt });
      setPrefilledFor(request.id);
    }
  }, [prefilledFor, request.id, canRecordPayment, isPending, required]);

  function setAmountAndSplit(v: string) {
    setAmount(v);
    setSplit({ ...ZERO_SPLIT, cashAmount: +v || 0 });
  }

  function reportError(err: unknown) {
    onError(err instanceof ApiError ? err.message : "Something went wrong — try again.");
  }

  // A partial release gets the backend's partial-release receipt (English
  // only); a full release gets the FORM 7 agreement in the chosen language.
  async function downloadReleaseAgreement(lang: DocLang | "partial") {
    if (downloading) return;
    setDownloading(lang);
    try {
      if (lang === "partial") await printPartialReleaseReceiptPdf(request.id);
      else await printReleaseAgreementPdf(loan.id, loan.loanNumber, lang);
    } catch (err) {
      onError(err instanceof ApiError ? err.message : "Could not download the Release Agreement — try again.");
    } finally {
      setDownloading(null);
    }
  }

  const saveVerification = useMutation({
    mutationFn: (input: Parameters<typeof verifyReleaseChecklist>[1]) => verifyReleaseChecklist(request.id, input),
    onSuccess: onSaved,
    onError: reportError,
  });

  const amt = +amount || 0;
  const splitOk = amt <= 0 || isBalanced(split, amt);

  const savePayment = useMutation({
    mutationFn: () =>
      recordReleasePayment(request.id, {
        amount: amt,
        discount: +discount || 0,
        ...(amt > 0 ? split : ZERO_SPLIT),
        reference: reference.trim() || undefined,
        dueDate: needsDueDate ? dueDate : undefined,
      }),
    onSuccess: () => {
      setDiscount("0");
      setReference("");
      setPrefilledFor(null);
      onSaved();
    },
    onError: reportError,
  });

  // Reject goes through a themed confirm (with the reason) first.
  const [confirmReject, setConfirmReject] = useState(false);
  const decide = useMutation({
    mutationFn: ({ action, note }: { action: "Approved" | "Rejected"; note?: string }) =>
      approveReleaseRequest(request.id, {
        stage,
        action,
        remarks: note?.trim() || undefined,
      }),
    onSuccess: (_d, v) => {
      setConfirmReject(false);
      toast.success(v.action === "Rejected" ? "Release request rejected" : "Release approved");
      onSaved();
    },
    onError: (err) => {
      setConfirmReject(false);
      if (err instanceof ApiError && err.status === 409 && /drift|top-up/i.test(err.rawMessage)) {
        onError("The balance has grown past what the remaining gold covers — collect the shortfall through Payment Reception, then approve again.");
      } else reportError(err);
    },
  });

  const sawGoldDisabled = saveVerification.isPending || !canDecide || !canVerifyChecklist || !isPending || !!request.locked || goldStillHeld;

  return (
    <View>
      {request.status === "Approved" ? (
        <View style={{ marginBottom: 10 }}>
          {request.isPartial ? (
            <SheetListItem
              first
              icon="doc"
              title="Partial Release Receipt"
              sub={downloading === "partial" ? "Preparing…" : "Download the partial-release receipt"}
              onPress={() => downloadReleaseAgreement("partial")}
            />
          ) : (
            RELEASE_AGREEMENT_LANGS.map((lang, i) => (
              <SheetListItem
                key={lang}
                first={i === 0}
                icon="doc"
                title={`Release Agreement — ${DOC_LANG_LABELS[lang]}`}
                sub={downloading === lang ? "Preparing…" : "Gold handed back to the customer"}
                onPress={() => downloadReleaseAgreement(lang)}
              />
            ))
          )}
        </View>
      ) : null}

      <FieldGrid
        style={{ marginBottom: 14 }}
        items={[
          { k: "Outstanding principal", v: inr(loan.outstandingAmount) },
          { k: "Outstanding interest", v: inr(loan.outstandingInterest ?? 0) },
          { k: "Penal interest", v: inr(loan.outstandingPenalInterest ?? 0) },
          {
            k: request.isPartial ? "Required to release" : "Final settlement",
            v: inr(required),
            color: C.brandDeep,
          },
        ]}
      />

      <SectionTitle flush style={{ marginTop: 0 }}>
        {request.isPartial ? `Ornaments in this request · ${selectedOrnaments.length} of ${pledged.length || selectedIds.size}` : "Ornaments in this request"}
      </SectionTitle>
      {shownOrnaments.length === 0 ? (
        <Txt style={{ fontSize: 12, color: C.muted, marginBottom: 14 }}>No ornaments still pledged.</Txt>
      ) : (
        shownOrnaments.map((o) => (
          <Card key={o.id} style={{ marginHorizontal: 0, marginTop: 0, marginBottom: 10 }}>
            <FieldGrid
              items={[
                { k: "Ornament", v: o.name },
                { k: "Purity", v: o.purity },
                { k: "Net weight", v: `${o.netWeight.toFixed(2)} g` },
                { k: "Gold value", v: inr(o.goldValue) },
              ]}
            />
          </Card>
        ))
      )}

      <TextField
        label="Charges (₹)"
        keyboardType="numeric"
        value={charges}
        onChangeText={setCharges}
        onBlur={() => saveVerification.mutate({ charges: +charges || 0 })}
        editable={canDecide && isPending && canRecordPayment}
      />
      <TextField
        label="Verification notes"
        placeholder="Notes from physical verification"
        value={notes}
        onChangeText={setNotes}
        onBlur={() => saveVerification.mutate({ verificationNotes: notes })}
        editable={canDecide && isPending}
      />

      <View style={sawGoldDisabled ? { opacity: 0.6 } : null}>
        <CheckItem
          variant="confirm"
          checked={!!request.customerSawGold}
          onPress={() => {
            if (!sawGoldDisabled)
              saveVerification.mutate({
                customerSawGold: !request.customerSawGold,
              });
          }}
          title="Customer has seen the gold"
          sub="Required before this request can be approved"
        />
      </View>
      {goldStillHeld && isPending ? (
        <View style={{ marginBottom: 6 }}>
          <WarningBanner>
            Release is blocked — this loan&apos;s gold is still {goldHeldReason}. {bankPledged ? "Release the bank pledge first." : "Check the packet out of the locker first."}
          </WarningBanner>
          {bankPledged ? (
            onThisLoanPage ? (
              <Txt style={{ fontSize: 12, color: C.muted, marginBottom: 14 }}>Use Loan Actions → Bank Pledge on this page.</Txt>
            ) : (
              <AccBtn label="Go to Bank Pledge" onPress={() => openPage(`/loans/${loan.id}?action=bank`)} style={{ marginBottom: 14 }} />
            )
          ) : (
            <AccBtn
              label={packetRecord ? `Go to Packet ${packetRecord.code}` : "Go to Lockers"}
              onPress={() => (packetRecord ? openPage(`/packets/${packetRecord.id}`) : openPage("/packets?tab=lockers"))}
              style={{ marginBottom: 14 }}
            />
          )}
        </View>
      ) : null}

      <SectionTitle flush style={{ marginTop: 0 }}>
        Payment — collect balance to settle this release
      </SectionTitle>
      {request.recordedDiscount + request.recordedPayment > 0 ? (
        <Txt style={{ fontSize: 12, color: C.muted, marginBottom: 10 }}>
          Already recorded: {inr(request.recordedDiscount)} discount + {inr(request.recordedPayment)} payment.
        </Txt>
      ) : null}
      {canRecordPayment && isPending ? (
        <View style={{ marginBottom: 6 }}>
          <FieldRow>
            <Field label="Discount (₹)">
              <Input
                keyboardType="numeric"
                value={discount}
                onChangeText={(v) => {
                  setDiscount(v);
                  setAmountAndSplit(String(Math.max(0, +(required - (+v || 0)).toFixed(2))));
                }}
              />
            </Field>
            <Field label="Amount (₹)">
              <Input keyboardType="numeric" value={amount} onChangeText={setAmountAndSplit} />
            </Field>
          </FieldRow>
          {amt > 0 ? <PaymentSplit amount={amt} value={split} onChange={setSplit} /> : null}
          {split.cashAmount !== amt ? <TextField label="Reference" placeholder="Transaction / cheque reference (optional)" value={reference} onChangeText={setReference} /> : null}
          {needsDueDate ? <DateField label="Due date for remaining balance" value={dueDate} onChange={setDueDate} min={todayISO()} /> : null}
          <AccBtn
            label={savePayment.isPending ? "Recording…" : request.paymentRecorded ? "Record Additional Payment" : "Record Payment"}
            primary
            onPress={() => savePayment.mutate()}
            disabled={savePayment.isPending || amt + (+discount || 0) <= 0 || !splitOk || (needsDueDate && !dueDate)}
            style={{ marginBottom: 14 }}
          />
        </View>
      ) : !request.paymentRecorded && isPending ? (
        <Txt style={{ fontSize: 12, color: C.muted, marginBottom: 14 }}>Payment is recorded at the Manager stage.</Txt>
      ) : null}

      {isPending && steps.length ? <Stepper steps={steps} current={Math.max(0, stageIndex(wf, "loan_release", pendingValue))} /> : null}

      {!isPending ? null : !canApprove ? (
        <ReviewWarning>
          {goldStillHeld
            ? `Blocked until the gold is no longer ${goldHeldReason}.`
            : !request.customerSawGold && !paymentConditionMet
              ? "Confirm the customer has seen the gold and record the payment before approving."
              : !request.customerSawGold
                ? "Confirm the customer has seen the gold before approving."
                : "Record the payment before approving."}
        </ReviewWarning>
      ) : (
        <Txt style={{ fontSize: 12, color: C.muted, marginBottom: 12 }}>
          Awaiting {stageLabel} approval.
          {isFinal ? " Final approval releases the gold." : ""}
        </Txt>
      )}

      {isPending && canActOnStage && canDecide ? (
        <>
          <SheetFooter>
            <BtnRow2>
              {!request.locked ? (
                <PrimaryButton
                  label="Reject"
                  variant="reject"
                  onPress={() => setConfirmReject(true)}
                  disabled={decide.isPending}
                />
              ) : null}
              <PrimaryButton
                label="Approve"
                onPress={() => decide.mutate({ action: "Approved" })}
                loading={decide.isPending && decide.variables?.action === "Approved"}
                disabled={!canApprove || decide.isPending}
              />
            </BtnRow2>
          </SheetFooter>
          <ConfirmSheet
            visible={confirmReject}
            onClose={() => setConfirmReject(false)}
            title="Reject Release"
            danger
            message="Reject this release request? The gold stays pledged and the loan stays open."
            remarks={{ label: "Reason (optional)", placeholder: "Why is this request being rejected?" }}
            confirmLabel="Reject Request"
            loading={decide.isPending && decide.variables?.action === "Rejected"}
            onConfirm={(note) => decide.mutate({ action: "Rejected", note })}
          />
        </>
      ) : null}
    </View>
  );
}
