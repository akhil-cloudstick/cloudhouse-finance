import React, { useEffect, useState } from "react";
import { View } from "react-native";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ThemedText } from "../ThemedText";
import { GoldTextInput } from "../GoldTextInput";
import { GoldDatePicker } from "../GoldDatePicker";
import { GoldButton } from "../GoldButton";
import { GoldCheckbox } from "../GoldCheckbox";
import { ChipSelect } from "../ChipSelect";
import { Icon } from "../Icon";
import { colors } from "../../theme/colors";
import { fmt } from "../../lib/format";
import { useAuth } from "../../auth/AuthContext";
import { verifyReleaseChecklist, recordReleasePayment, approveReleaseRequest, RELEASE_STAGE_PERMISSIONS } from "../../api/loans";
import { recordPayment } from "../../api/payments";
import { listPackets } from "../../api/packets";
import { splitForMode, PaymentMode } from "../../api/investments";
import {
  printReleaseAgreementPdf,
  printPartialReleaseReceiptPdf,
  RELEASE_AGREEMENT_LANGS,
  DOC_LANG_LABELS,
  type DocLang,
} from "../../utils/loanPrint";
import { LoanRequest, Loan } from "../../types/loan";
import { ApiError } from "../../api/client";

const MODES: PaymentMode[] = ["Cash", "UPI", "Bank Transfer", "Cheque"];

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
 * partial: hands back only the selected ornaments). Used by the loan detail
 * Release card and the Requests list sheet. */
export function ReleaseReviewPanel({
  request,
  loan,
  onSaved,
  onError,
}: {
  request: LoanRequest;
  loan: Loan;
  onSaved: () => void;
  onError: (message: string) => void;
}) {
  const { can } = useAuth();
  const canDecide = can("Loan_Management", "can_update_loan");
  const canVerifyChecklist = can("Release_Approval", "can_verify_release_checklist");
  const stage: "Manager" | "Management" = request.approvalStage === "PendingManagement" ? "Management" : "Manager";
  const canActOnStage = can("Release_Approval", RELEASE_STAGE_PERMISSIONS[stage]);
  // RecordReleasePayment is refused past the Manager stage.
  const canRecordPayment = request.approvalStage === "" || request.approvalStage === "PendingManager";
  const isPending = request.status === "Pending";

  const [charges, setCharges] = useState(String(request.charges || 0));
  const [notes, setNotes] = useState(request.verificationNotes || "");
  const [discount, setDiscount] = useState("0");
  const [amount, setAmount] = useState("");
  const [mode, setMode] = useState<PaymentMode>("Cash");
  const [reference, setReference] = useState("");
  const [dueDate, setDueDate] = useState(request.paymentDueDate || "");
  const [decisionRemarks, setDecisionRemarks] = useState("");
  // Language being fetched ("partial" for the partial-release receipt).
  const [downloading, setDownloading] = useState<DocLang | "partial" | null>(null);
  const [showTopUp, setShowTopUp] = useState(false);
  const [topUp, setTopUp] = useState("");
  // Seed editable fields only when a different request arrives, so a
  // background refetch never stomps on what staff is typing.
  const [seenId, setSeenId] = useState(request.id);
  useEffect(() => {
    if (request.id !== seenId) {
      setCharges(String(request.charges || 0));
      setNotes(request.verificationNotes || "");
      setDueDate(request.paymentDueDate || "");
      setShowTopUp(false);
      setSeenId(request.id);
    }
  }, [request, seenId]);

  // Gold can't be shown to the customer while it's pledged to a bank or in a locker.
  const packet = useQuery({
    queryKey: ["packets", "forLoan", loan.id],
    queryFn: () => listPackets({ loanId: loan.id }),
    enabled: isPending,
  });
  const packetStatus = packet.data?.[0]?.status;
  const goldStillHeld = loan.bankPledgeStatus === "Bank Pledged" || packetStatus === "Locker Stored";
  const goldHeldReason = loan.bankPledgeStatus === "Bank Pledged" ? "pledged to a bank" : "checked into a locker";

  const outstanding = loan.totalOutstandingBalance ?? loan.outstandingAmount;
  const ltv = loan.schemeLtvPercent ?? loan.scheme?.ltvPercent ?? 0;
  const selectedIds = new Set((request.ornamentSelections ?? []).map((s) => s.ornamentId));
  const pledged = (loan.ornaments ?? []).filter((o) => !o.releasedAt);
  const selectedOrnaments = pledged.filter((o) => selectedIds.has(o.id));
  const remainingGoldValue = request.isPartial ? pledged.filter((o) => !selectedIds.has(o.id)).reduce((s, o) => s + o.goldValue, 0) : 0;
  const drift = request.isPartial ? partialReleaseDrift(outstanding, remainingGoldValue, ltv) : 0;

  const unappliedCharges = Math.max(0, (+charges || 0) - request.chargesApplied);
  // What still has to come in for the release condition: the whole balance
  // for a full release, only the drift for a partial one.
  const required = (request.isPartial ? Math.max(0, drift) : outstanding) + unappliedCharges;
  const paymentConditionMet = !!request.paymentRecorded || (request.isPartial ? drift <= 0.01 : outstanding <= 0.01);
  const shortAfter = required - (+discount || 0) - (+amount || 0);
  const needsDueDate = !request.isPartial && shortAfter > 0.01;
  const canApprove = !!request.customerSawGold && paymentConditionMet;

  // Prefill the amount with what's required, once per request.
  const [prefilledFor, setPrefilledFor] = useState<number | null>(null);
  useEffect(() => {
    if (prefilledFor !== request.id && canRecordPayment && isPending) {
      setAmount(String(Math.max(0, +required.toFixed(2))));
      setPrefilledFor(request.id);
    }
  }, [prefilledFor, request.id, canRecordPayment, isPending, required]);

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

  const savePayment = useMutation({
    mutationFn: () => {
      const amt = +amount || 0;
      return recordReleasePayment(request.id, {
        amount: amt,
        discount: +discount || 0,
        ...splitForMode(mode, amt),
        reference: reference.trim() || undefined,
        dueDate: needsDueDate ? dueDate : undefined,
      });
    },
    onSuccess: () => {
      setDiscount("0");
      setReference("");
      setPrefilledFor(null);
      onSaved();
    },
    onError: reportError,
  });

  // Top-up for a partial release whose drift grew after the request: a plain
  // loan payment (not against the request), then approve again.
  const saveTopUp = useMutation({
    mutationFn: () => {
      const amt = +topUp || 0;
      return recordPayment(loan.id, { amount: amt, type: "Partial", paidOn: new Date().toISOString().slice(0, 10), ...splitForMode(mode, amt) });
    },
    onSuccess: () => {
      setTopUp("");
      setShowTopUp(false);
      onSaved();
    },
    onError: reportError,
  });

  const decide = useMutation({
    mutationFn: (action: "Approved" | "Rejected") =>
      approveReleaseRequest(request.id, { stage, action, remarks: decisionRemarks.trim() || undefined }),
    onSuccess: () => {
      setDecisionRemarks("");
      onSaved();
    },
    onError: (err) => {
      if (err instanceof ApiError && err.status === 409 && /drift|top-up/i.test(err.message)) {
        setShowTopUp(true);
        setTopUp(String(Math.max(0, +drift.toFixed(2))));
        onError("The balance has drifted above what the remaining gold supports — record a top-up payment below, then approve again.");
      } else reportError(err);
    },
  });

  const sawGoldDisabled = saveVerification.isPending || !canDecide || !canVerifyChecklist || !isPending || !!request.locked || goldStillHeld;

  return (
    <View>
      {request.isPartial ? (
        <View style={{ flexDirection: "row", marginBottom: 10 }}>
          <ThemedText variant="label" color={colors.brandDeep} style={{ backgroundColor: colors.brandPale, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 }}>
            Partial release · {selectedOrnaments.length} of {pledged.length || selectedIds.size} ornaments
          </ThemedText>
        </View>
      ) : null}

      {request.status === "Approved" ? (
        request.isPartial ? (
          <GoldButton
            title={downloading ? "Preparing…" : "Partial Release Receipt"}
            icon="download"
            variant="outline"
            onPress={() => downloadReleaseAgreement("partial")}
            loading={!!downloading}
            style={{ marginBottom: 12 }}
          />
        ) : (
          <View style={{ gap: 8, marginBottom: 12 }}>
            {RELEASE_AGREEMENT_LANGS.map((lang) => (
              <View key={lang}>
                <GoldButton
                  title={downloading === lang ? "Preparing…" : `Release Agreement — ${DOC_LANG_LABELS[lang]}`}
                  icon="download"
                  variant="outline"
                  onPress={() => downloadReleaseAgreement(lang)}
                  loading={downloading === lang}
                  disabled={!!downloading}
                />
              </View>
            ))}
          </View>
        )
      ) : null}

      <View style={{ flexDirection: "row", flexWrap: "wrap", marginBottom: 6 }}>
        {[
          ["Outstanding Principal", fmt(loan.outstandingAmount)],
          ["Outstanding Interest", fmt(loan.outstandingInterest ?? 0)],
          ["Penal Interest", fmt(loan.outstandingPenalInterest ?? 0)],
          [request.isPartial ? "Required to Release" : "Final Settlement", fmt(required)],
        ].map(([k, v]) => (
          <View key={k} style={{ width: "50%", marginBottom: 8 }}>
            <ThemedText variant="small" color={colors.muted}>{k}</ThemedText>
            <ThemedText variant="body">{v}</ThemedText>
          </View>
        ))}
      </View>

      {request.isPartial && selectedOrnaments.length > 0 ? (
        <View style={{ marginBottom: 12, borderWidth: 1, borderColor: colors.line, borderRadius: 12, overflow: "hidden" }}>
          {selectedOrnaments.map((o, i) => (
            <View key={o.id} style={{ flexDirection: "row", paddingVertical: 8, paddingHorizontal: 10, borderTopWidth: i ? 1 : 0, borderTopColor: colors.line }}>
              <ThemedText variant="small" style={{ flex: 1.4 }}>{o.name}</ThemedText>
              <ThemedText variant="small" style={{ flex: 0.8 }}>{o.purity}</ThemedText>
              <ThemedText variant="small" style={{ flex: 0.8 }}>{o.netWeight.toFixed(2)}g</ThemedText>
              <ThemedText variant="small" style={{ flex: 1, textAlign: "right" }}>{fmt(o.goldValue)}</ThemedText>
            </View>
          ))}
        </View>
      ) : null}

      <GoldTextInput
        label="Charges (₹)"
        keyboardType="numeric"
        value={charges}
        onChangeText={setCharges}
        onBlur={() => saveVerification.mutate({ charges: +charges || 0 })}
        editable={canDecide && isPending && canRecordPayment}
      />

      <ThemedText variant="label" color={colors.muted} style={{ marginTop: 4, marginBottom: 10 }}>
        Verification
      </ThemedText>
      <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 10 }}>
        <GoldCheckbox
          value={!!request.customerSawGold}
          onValueChange={(v) => saveVerification.mutate({ customerSawGold: v })}
          disabled={sawGoldDisabled}
        />
        <View style={{ flex: 1, marginLeft: 10 }}>
          <ThemedText variant="body">Customer has seen the gold</ThemedText>
          <ThemedText variant="small" color={colors.muted}>
            Confirm the customer has been shown the pledged ornaments
          </ThemedText>
        </View>
      </View>
      {goldStillHeld && isPending ? (
        <View style={{ flexDirection: "row", gap: 6, marginBottom: 10 }}>
          <Icon name="shield" size={13} color={colors.red} />
          <ThemedText variant="small" color={colors.red} style={{ flex: 1 }}>
            This loan&apos;s gold is still {goldHeldReason}, so it can&apos;t be shown to the customer yet — release it from{" "}
            {loan.bankPledgeStatus === "Bank Pledged" ? "Bank Pledge" : "Packets"} first.
          </ThemedText>
        </View>
      ) : null}

      <ThemedText variant="label" color={colors.muted} style={{ marginTop: 4, marginBottom: 8 }}>
        Payment
      </ThemedText>
      {request.recordedDiscount + request.recordedPayment > 0 ? (
        <ThemedText variant="small" color={colors.muted} style={{ marginBottom: 8 }}>
          Already recorded: {fmt(request.recordedDiscount)} discount + {fmt(request.recordedPayment)} payment.
        </ThemedText>
      ) : null}
      {canRecordPayment && isPending ? (
        <View style={{ marginBottom: 10 }}>
          <View style={{ flexDirection: "row", gap: 8 }}>
            <GoldTextInput
              label="Discount (₹)"
              keyboardType="numeric"
              value={discount}
              onChangeText={(v) => {
                setDiscount(v);
                setAmount(String(Math.max(0, +(required - (+v || 0)).toFixed(2))));
              }}
              containerStyle={{ flex: 1 }}
            />
            <GoldTextInput label="Amount (₹)" keyboardType="numeric" value={amount} onChangeText={setAmount} containerStyle={{ flex: 1 }} />
          </View>
          <ChipSelect label="Mode" options={MODES} value={mode} onChange={setMode} />
          {mode !== "Cash" ? <GoldTextInput label="Reference (optional)" value={reference} onChangeText={setReference} /> : null}
          {needsDueDate ? (
            <GoldDatePicker label="Due date for the remaining balance" value={dueDate} onChange={setDueDate} min={new Date().toISOString().slice(0, 10)} />
          ) : null}
          <GoldButton
            title={request.paymentRecorded ? "Record Additional Payment" : "Record Payment"}
            onPress={() => savePayment.mutate()}
            loading={savePayment.isPending}
            disabled={(+amount || 0) + (+discount || 0) <= 0 || (needsDueDate && !dueDate)}
          />
        </View>
      ) : !request.paymentRecorded && isPending ? (
        <ThemedText variant="small" color={colors.muted} style={{ marginBottom: 10 }}>
          Payment is recorded at the Manager stage.
        </ThemedText>
      ) : null}

      {showTopUp && isPending ? (
        <View style={{ marginBottom: 10, padding: 12, borderRadius: 12, backgroundColor: colors.brandPale }}>
          <ThemedText variant="body" style={{ marginBottom: 8 }}>Top-up payment</ThemedText>
          <GoldTextInput label="Amount (₹)" keyboardType="numeric" value={topUp} onChangeText={setTopUp} />
          <ChipSelect label="Mode" options={MODES} value={mode} onChange={setMode} />
          <GoldButton title="Record Top-Up" onPress={() => saveTopUp.mutate()} loading={saveTopUp.isPending} disabled={!(+topUp > 0)} />
        </View>
      ) : null}

      <GoldTextInput
        label="Verification Notes"
        value={notes}
        onChangeText={setNotes}
        onBlur={() => saveVerification.mutate({ verificationNotes: notes })}
        placeholder="optional"
        editable={canDecide && isPending}
      />

      {!isPending ? null : !canApprove ? (
        <View style={{ flexDirection: "row", gap: 6, alignItems: "flex-start", marginTop: 8, marginBottom: 8 }}>
          <Icon name="shield" size={13} color={colors.amber} />
          <ThemedText variant="small" color={colors.amber} style={{ flex: 1 }}>
            {!request.customerSawGold && !paymentConditionMet
              ? "Confirm the customer has seen the gold and record the payment before approving."
              : !request.customerSawGold
                ? "Confirm the customer has seen the gold before approving."
                : "Record the payment before approving."}
          </ThemedText>
        </View>
      ) : (
        <View style={{ flexDirection: "row", gap: 6, alignItems: "flex-start", marginTop: 8, marginBottom: 8 }}>
          <Icon name="clock" size={13} color={colors.muted} />
          <ThemedText variant="small" color={colors.muted} style={{ flex: 1 }}>
            Awaiting {stage} approval.{stage === "Management" ? " Final approval releases the gold." : ""}
          </ThemedText>
        </View>
      )}

      {isPending && canActOnStage && canDecide ? (
        <>
          {!request.locked ? (
            <GoldTextInput label="Remarks (optional, for Reject)" value={decisionRemarks} onChangeText={setDecisionRemarks} />
          ) : null}
          <View style={{ flexDirection: "row", gap: 8 }}>
            {!request.locked ? (
              <View style={{ flex: 1 }}>
                <GoldButton
                  title="Reject"
                  variant="outline"
                  style={{ borderColor: colors.red }}
                  onPress={() => decide.mutate("Rejected")}
                  loading={decide.isPending}
                />
              </View>
            ) : null}
            <View style={{ flex: 1 }}>
              <GoldButton
                title={`Approve (${stage})`}
                onPress={() => decide.mutate("Approved")}
                loading={decide.isPending}
                disabled={!canApprove}
              />
            </View>
          </View>
        </>
      ) : null}
    </View>
  );
}
