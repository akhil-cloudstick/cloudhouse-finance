import React, { useEffect, useState } from "react";
import { View } from "react-native";
import { useMutation } from "@tanstack/react-query";
import { ThemedText } from "../ThemedText";
import { GoldTextInput } from "../GoldTextInput";
import { GoldDatePicker } from "../GoldDatePicker";
import { GoldButton } from "../GoldButton";
import { GoldCheckbox } from "../GoldCheckbox";
import { Icon } from "../Icon";
import { colors } from "../../theme/colors";
import { fmt } from "../../lib/format";
import { useAuth } from "../../auth/AuthContext";
import { verifyReleaseChecklist, recordReleasePayment, approveReleaseRequest, RELEASE_STAGE_PERMISSIONS } from "../../api/loans";
import { LoanRequest, Loan } from "../../types/loan";
import { ApiError } from "../../api/client";

// Mirrors frontend/common/components/modals/ReleaseReviewModal.tsx's
// checklistItems exactly (paymentVerified isn't here: it's read-only,
// rendered separately above the Record Payment fields).
const RELEASE_CHECKLIST_ITEMS: Array<["packetVerified" | "bankPledgeVerified" | "customerConfirmed", string, string]> = [
  ["packetVerified", "Packet Location", "Pledged gold's packet location has been physically confirmed"],
  ["bankPledgeVerified", "Bank Pledge", "No active bank pledge remains against this loan"],
  ["customerConfirmed", "Customer Confirmation", "Customer has confirmed the release in person"],
];

/* The verification checklist + Record Payment + Manager/Management approval
 * chain for one Pending Release request — mirrors frontend/common/
 * components/modals/ReleaseReviewModal.tsx exactly, including the
 * Charges-folded-into-Payment math (see backend's RecordReleasePayment).
 * Self-contained (reads its own permissions via useAuth) so it can be
 * dropped into the loan detail screen's Release card AND the standalone
 * Requests list's review sheet without either owning its state — only
 * `loan` (for the live outstanding balance) has to come from the caller,
 * since where that's fetched from differs between the two call sites. */
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
  const canRecordPayment = request.approvalStage === "" || request.approvalStage === "PendingManager";

  const [charges, setCharges] = useState(String(request.charges || 0));
  const [notes, setNotes] = useState(request.verificationNotes || "");
  const [discount, setDiscount] = useState("0");
  const [payment, setPayment] = useState("0");
  const [dueDate, setDueDate] = useState(request.paymentDueDate || "");
  const [decisionRemarks, setDecisionRemarks] = useState("");
  // Seeds Charges/Notes/Due Date from `request` the FIRST time this panel
  // sees it (by id), not on every refetch — otherwise a background refetch
  // mid-edit would stomp on whatever staff is typing.
  const [seenId, setSeenId] = useState(request.id);

  useEffect(() => {
    if (request.id !== seenId) {
      setCharges(String(request.charges || 0));
      setNotes(request.verificationNotes || "");
      setDueDate(request.paymentDueDate || "");
      setSeenId(request.id);
    }
  }, [request, seenId]);

  const checklistComplete =
    request.paymentVerified && request.packetVerified && request.bankPledgeVerified && request.customerConfirmed;
  // Discount+Payment together need to cover the loan's outstanding balance
  // PLUS whatever part of Charges hasn't been collected yet — Payment gets
  // that still-unapplied charge folded directly into it server-side (see
  // backend's RecordReleasePayment).
  const unappliedCharges = Math.max(0, (+charges || 0) - request.chargesApplied);
  const settlementTarget = (loan.totalOutstandingBalance ?? loan.outstandingAmount) + unappliedCharges;
  const alreadyRecorded = request.recordedDiscount + request.recordedPayment;
  const remaining = settlementTarget - alreadyRecorded - (+discount || 0) - (+payment || 0);
  const needsDueDate = remaining > 0.01;

  function reportError(err: unknown) {
    onError(err instanceof ApiError ? err.message : "Something went wrong — try again.");
  }

  const saveCharges = useMutation({
    mutationFn: () => verifyReleaseChecklist(request.id, { charges: +charges || 0, verificationNotes: notes }),
    onSuccess: onSaved,
    onError: reportError,
  });

  const toggleChecklist = useMutation({
    mutationFn: (input: Parameters<typeof verifyReleaseChecklist>[1]) => verifyReleaseChecklist(request.id, input),
    onSuccess: onSaved,
    onError: reportError,
  });

  const savePayment = useMutation({
    mutationFn: () =>
      recordReleasePayment(request.id, {
        discount: +discount || 0,
        payment: +payment || 0,
        dueDate: needsDueDate ? dueDate : undefined,
      }),
    onSuccess: () => {
      setDiscount("0");
      setPayment("0");
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
    onError: reportError,
  });

  return (
    <View>
      <View style={{ flexDirection: "row", marginBottom: 10 }}>
        <View style={{ flex: 1 }}>
          <ThemedText variant="small" color={colors.muted}>
            Outstanding
          </ThemedText>
          <ThemedText variant="body">{fmt(loan.totalOutstandingBalance ?? loan.outstandingAmount)}</ThemedText>
        </View>
        <View style={{ flex: 1 }}>
          <ThemedText variant="small" color={colors.muted}>
            Final Settlement
          </ThemedText>
          <ThemedText variant="body" color={colors.goldDeep}>
            {fmt(settlementTarget)}
          </ThemedText>
        </View>
      </View>

      <GoldTextInput
        label="Charges (₹)"
        keyboardType="numeric"
        value={charges}
        onChangeText={setCharges}
        onBlur={() => saveCharges.mutate()}
        editable={canDecide && request.status === "Pending"}
      />

      <ThemedText variant="label" color={colors.muted} style={{ marginTop: 4, marginBottom: 10 }}>
        Verification Checklist
      </ThemedText>

      <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 10 }}>
        <GoldCheckbox value={request.paymentVerified} disabled />
        <View style={{ flex: 1, marginLeft: 10 }}>
          <ThemedText variant="body">Record Payment</ThemedText>
          <ThemedText variant="small" color={colors.muted}>
            {canRecordPayment
              ? "Enter a discount and/or payment against the final settlement"
              : "Past the Manager review stage — recorded through Complete Release instead"}
          </ThemedText>
        </View>
      </View>

      {alreadyRecorded > 0 ? (
        <ThemedText variant="small" color={colors.muted} style={{ marginBottom: canRecordPayment ? 6 : 10 }}>
          Already recorded: {fmt(request.recordedDiscount)} discount + {fmt(request.recordedPayment)} payment.
          {canRecordPayment ? " The fields below are for an ADDITIONAL amount, on top of that." : ""}
        </ThemedText>
      ) : null}

      {/* Past the Manager stage, RecordReleasePayment itself is refused
          server-side — the Discount/Payment/Due-Date inputs and Save button
          would just be dead weight here, not a form staff can actually
          still submit. */}
      {canRecordPayment ? (
        <View style={{ marginBottom: 10 }}>
          <GoldTextInput
            label="Discount (₹)"
            keyboardType="numeric"
            value={discount}
            onChangeText={(v) => {
              setDiscount(v);
              // Payment re-prefills with whatever's left of the final
              // settlement (minus anything already recorded before) after
              // this discount, each time Discount changes — staff can still
              // edit Payment by hand afterward, this only recomputes the
              // starting point.
              setPayment(String(Math.max(0, +(settlementTarget - alreadyRecorded - (+v || 0)).toFixed(2))));
            }}
          />
          <GoldTextInput label="Payment (₹)" keyboardType="numeric" value={payment} onChangeText={setPayment} />
          {needsDueDate ? (
            <GoldDatePicker label="Due Date" value={dueDate} onChange={setDueDate} min={new Date().toISOString().slice(0, 10)} />
          ) : null}
          <GoldButton
            title="Save Payment"
            onPress={() => savePayment.mutate()}
            loading={savePayment.isPending}
            disabled={needsDueDate && !dueDate}
          />
        </View>
      ) : null}

      {RELEASE_CHECKLIST_ITEMS.map(([field, label, hint]) => (
        <View key={field} style={{ flexDirection: "row", alignItems: "center", marginBottom: 10 }}>
          <GoldCheckbox
            value={request[field]}
            onValueChange={(v) => toggleChecklist.mutate({ [field]: v })}
            disabled={toggleChecklist.isPending || !canVerifyChecklist || request.status !== "Pending"}
          />
          <View style={{ flex: 1, marginLeft: 10 }}>
            <ThemedText variant="body">{label}</ThemedText>
            <ThemedText variant="small" color={colors.muted}>
              {hint}
            </ThemedText>
          </View>
        </View>
      ))}

      <GoldTextInput
        label="Verification Notes"
        value={notes}
        onChangeText={setNotes}
        onBlur={() => saveCharges.mutate()}
        placeholder="optional"
        editable={canDecide && request.status === "Pending"}
      />

      {request.status !== "Pending" ? null : !checklistComplete ? (
        <View style={{ flexDirection: "row", gap: 6, alignItems: "flex-start", marginTop: 8, marginBottom: 8 }}>
          <Icon name="shield" size={13} color={colors.amber} />
          <ThemedText variant="small" color={colors.amber} style={{ flex: 1 }}>
            All four checklist items must be ticked before this can be approved.
          </ThemedText>
        </View>
      ) : (
        <View style={{ flexDirection: "row", gap: 6, alignItems: "flex-start", marginTop: 8, marginBottom: 8 }}>
          <Icon name="clock" size={13} color={colors.muted} />
          <ThemedText variant="small" color={colors.muted} style={{ flex: 1 }}>
            Awaiting {stage} approval — same chain used for loan sanctioning.
          </ThemedText>
        </View>
      )}

      {request.status === "Pending" && canActOnStage && canDecide ? (
        <>
          <GoldTextInput label="Remarks (optional, for Reject)" value={decisionRemarks} onChangeText={setDecisionRemarks} />
          <View style={{ flexDirection: "row", gap: 8 }}>
            <View style={{ flex: 1 }}>
              <GoldButton
                title="Reject"
                variant="outline"
                style={{ borderColor: colors.red }}
                onPress={() => decide.mutate("Rejected")}
                loading={decide.isPending}
              />
            </View>
            <View style={{ flex: 1 }}>
              <GoldButton
                title={`Approve (${stage})`}
                onPress={() => decide.mutate("Approved")}
                loading={decide.isPending}
                disabled={!checklistComplete}
              />
            </View>
          </View>
        </>
      ) : null}
    </View>
  );
}
