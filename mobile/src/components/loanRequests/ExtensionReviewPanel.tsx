import React, { useState } from "react";
import { View } from "react-native";
import { useMutation } from "@tanstack/react-query";
import { ThemedText } from "../ThemedText";
import { GoldTextInput } from "../GoldTextInput";
import { GoldButton } from "../GoldButton";
import { Icon } from "../Icon";
import { colors } from "../../theme/colors";
import { useAuth } from "../../auth/AuthContext";
import {
  approveExtensionRequest,
  extensionStageKeyFor,
  EXTENSION_STAGES,
  EXTENSION_STAGE_LABELS,
  EXTENSION_STAGE_ROLES,
  EXTENSION_STAGE_PERMISSIONS,
} from "../../api/loans";
import { LoanRequest } from "../../types/loan";
import { ApiError } from "../../api/client";

/* The 3-stage Loan Officer -> Branch Manager -> Management review for one
 * Pending Extension request — mirrors frontend/common/components/modals/
 * ExtensionReviewModal.tsx exactly. Self-contained (reads its own
 * permissions via useAuth) so it can be dropped into the loan detail
 * screen's Extension card AND the standalone Requests list's review sheet
 * without either owning its state. */
export function ExtensionReviewPanel({
  request,
  onSaved,
  onError,
}: {
  request: LoanRequest;
  onSaved: () => void;
  onError: (message: string) => void;
}) {
  const { can } = useAuth();
  const canDecide = can("Loan_Management", "can_update_loan");
  const [remarks, setRemarks] = useState("");

  const stageKey = extensionStageKeyFor(request.approvalStage || "");
  const requiredRole = stageKey ? EXTENSION_STAGE_ROLES[stageKey] : null;
  const canActOnStage = !!stageKey && can("Loan_Extension_Approval", EXTENSION_STAGE_PERMISSIONS[stageKey]);

  const decide = useMutation({
    mutationFn: (action: "Approved" | "Rejected") =>
      approveExtensionRequest(request.id, { stage: stageKey!, action, remarks: remarks.trim() || undefined }),
    onSuccess: () => {
      setRemarks("");
      onSaved();
    },
    onError: (err) => onError(err instanceof ApiError ? err.message : "Could not record the decision — try again."),
  });

  return (
    <View>
      <ThemedText variant="body">Requested {request.requestedExtensionMonths ?? "—"} month(s)</ThemedText>
      {request.detail ? (
        <ThemedText variant="small" color={colors.muted} style={{ marginTop: 4, marginBottom: 8 }}>
          {request.detail}
        </ThemedText>
      ) : null}

      <View style={{ flexDirection: "row", marginTop: 8, marginBottom: 10 }}>
        {EXTENSION_STAGES.map((s) => {
          const idx = EXTENSION_STAGES.indexOf(s);
          const currentIdx = stageKey ? EXTENSION_STAGES.indexOf(stageKey) : EXTENSION_STAGES.length;
          const done = idx < currentIdx;
          const active = idx === currentIdx;
          return (
            <View key={s} style={{ flex: 1, alignItems: "center" }}>
              <View
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: 5,
                  marginBottom: 4,
                  backgroundColor: done ? colors.green : active ? colors.brandDeep : colors.line,
                }}
              />
              <ThemedText variant="small" color={active ? colors.brandDeep : colors.muted} style={{ textAlign: "center" }}>
                {EXTENSION_STAGE_LABELS[s]}
              </ThemedText>
            </View>
          );
        })}
      </View>

      {request.status === "Rejected" ? (
        <ThemedText variant="small" color={colors.red} style={{ marginBottom: 8 }}>
          Rejected
        </ThemedText>
      ) : stageKey ? (
        <View style={{ flexDirection: "row", gap: 6, alignItems: "flex-start", marginBottom: 8 }}>
          <Icon name="clock" size={13} color={colors.muted} />
          <ThemedText variant="small" color={colors.muted} style={{ flex: 1 }}>
            {canActOnStage ? "Awaiting your" : "Awaiting"} {requiredRole} approval
          </ThemedText>
        </View>
      ) : null}

      {request.status === "Pending" && stageKey && canActOnStage && canDecide ? (
        <>
          <GoldTextInput label="Remarks (optional, for Reject)" value={remarks} onChangeText={setRemarks} />
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
                title={`Approve (${EXTENSION_STAGE_LABELS[stageKey]})`}
                onPress={() => decide.mutate("Approved")}
                loading={decide.isPending}
              />
            </View>
          </View>
        </>
      ) : null}
    </View>
  );
}
