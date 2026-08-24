import React, { useCallback, useEffect, useState } from "react";
import { View, ScrollView, ActivityIndicator, StyleSheet } from "react-native";
import { useLocalSearchParams, useNavigation } from "expo-router";
import { ScreenContainer } from "../../../src/components/ScreenContainer";
import { Card } from "../../../src/components/Card";
import { ThemedText } from "../../../src/components/ThemedText";
import { FloatingHeader } from "../../../src/components/FloatingHeader";
import { BottomSheetModal } from "../../../src/components/BottomSheetModal";
import { NotificationList } from "../../../src/components/NotificationList";
import { GoldButton } from "../../../src/components/GoldButton";
import { GoldTextInput } from "../../../src/components/GoldTextInput";
import { Icon } from "../../../src/components/Icon";
import { PaySheet } from "../../../src/components/PaySheet";
import { colors, statusColors, StatusTone } from "../../../src/theme/colors";
import * as loansApi from "../../../src/api/loans";
import { Loan, LoanRequest } from "../../../src/api/loans";
import * as paymentsApi from "../../../src/api/payments";
import { LoanPayment } from "../../../src/api/payments";
import { ApiError } from "../../../src/api/client";

function money(n: number | undefined | null): string {
  return `₹${(n ?? 0).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
}

function toneForStatus(status: string): StatusTone {
  const s = status.toLowerCase();
  if (s.includes("closed")) return "green";
  if (s.includes("overdue") || s.includes("default")) return "red";
  if (s.includes("due soon")) return "amber";
  if (s.includes("active")) return "blue";
  return "muted";
}

// Extension: Loan Officer -> Branch Manager -> Management (3 stages).
// Release: Manager -> Management (2 stages, existing/unchanged chain).
// Mirrors backend/internal/loan/model.go's ApprovalStagePendingLoanOfficer/
// PendingBranchManager/PendingManagement (Extension) and
// ApprovalStagePendingManager/PendingManagement (Release).
const EXTENSION_STAGES = ["Loan Officer", "Branch Manager", "Management"];
const RELEASE_STAGES = ["Manager", "Management"];

function stagesFor(type: LoanRequest["type"]): string[] {
  return type === "Extension" ? EXTENSION_STAGES : RELEASE_STAGES;
}

// Maps the request's current approvalStage to the index of the stage that
// is (or was) pending — everything before it is Approved, everything after
// is not yet reached. Terminal Approved/Rejected map past the end.
function pendingIndex(req: LoanRequest): number {
  switch (req.approvalStage) {
    case "PendingLoanOfficer":
    case "PendingManager":
      return 0;
    case "PendingBranchManager":
      return 1;
    case "PendingManagement":
      return req.type === "Extension" ? 2 : 1;
    default:
      return stagesFor(req.type).length; // Approved/Rejected/unset
  }
}

type DotState = "approved" | "rejected" | "pending" | "upcoming";

function dotState(req: LoanRequest, index: number): DotState {
  const pIdx = pendingIndex(req);
  if (req.status === "Approved") return "approved";
  if (req.status === "Rejected") {
    // Best-effort: the codebase doesn't expose per-stage RequestApproval
    // rows to the customer app, so a rejected request can't show exactly
    // which stage rejected it here — every stage up to (and including) the
    // one it was pending on when rejected is shown terminal-rejected.
    return index <= pIdx ? "rejected" : "upcoming";
  }
  if (index < pIdx) return "approved";
  if (index === pIdx) return "pending";
  return "upcoming";
}

function dotGlyph(state: DotState): { symbol: string; tone: StatusTone } {
  switch (state) {
    case "approved":
      return { symbol: "✓", tone: "green" };
    case "rejected":
      return { symbol: "✗", tone: "red" };
    case "pending":
      return { symbol: "⏳", tone: "amber" };
    default:
      return { symbol: "○", tone: "muted" };
  }
}

export default function LoanDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const loanId = Number(id);
  const navigation = useNavigation();

  const [loan, setLoan] = useState<Loan | null>(null);
  const [latestRequest, setLatestRequest] = useState<LoanRequest | null>(null);
  const [payments, setPayments] = useState<LoanPayment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [notifOpen, setNotifOpen] = useState(false);
  const [payOpen, setPayOpen] = useState(false);
  const [extensionOpen, setExtensionOpen] = useState(false);
  const [releaseOpen, setReleaseOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [l, requests, loanPayments] = await Promise.all([
        loansApi.getLoan(loanId),
        loansApi.listLoanRequests(loanId).catch(() => [] as LoanRequest[]),
        paymentsApi.listLoanPayments(loanId).catch(() => [] as LoanPayment[]),
      ]);
      setLoan(l);
      setLatestRequest(requests[0] ?? null);
      setPayments(loanPayments);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load this loan.");
    } finally {
      setLoading(false);
    }
  }, [loanId]);

  useEffect(() => {
    if (loanId) load();
  }, [loanId, load]);

  if (loading && !loan) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.ivory }}>
        <FloatingHeader title="Loan" navigation={navigation} onBellPress={() => setNotifOpen(true)} />
        <ScreenContainer style={{ alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator color={colors.gold} />
        </ScreenContainer>
      </View>
    );
  }

  if (error || !loan) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.ivory }}>
        <FloatingHeader title="Loan" navigation={navigation} onBellPress={() => setNotifOpen(true)} />
        <ScreenContainer style={{ alignItems: "center", justifyContent: "center" }}>
          <ThemedText color={colors.muted}>{error ?? "Loan not found."}</ThemedText>
        </ScreenContainer>
      </View>
    );
  }

  const tone = statusColors(toneForStatus(loan.status));
  const outstanding = loan.totalOutstandingBalance ?? loan.outstandingAmount;
  const showRequests = !!latestRequest;

  return (
    <View style={{ flex: 1, backgroundColor: colors.ivory }}>
      <FloatingHeader title={`Loan ${loan.loanNumber}`} navigation={navigation} onBellPress={() => setNotifOpen(true)} />
      <ScreenContainer>
        <ScrollView showsVerticalScrollIndicator={false}>
          <Card>
            <ThemedText variant="h3" style={{ marginBottom: 10 }}>
              Loan Details
            </ThemedText>
            <Row label="Status">
              <ThemedText
                variant="label"
                style={{ backgroundColor: tone.bg, color: tone.fg, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 }}
              >
                {loan.status.toUpperCase()}
              </ThemedText>
            </Row>
            {loan.scheme?.name ? <Row label="Scheme" value={loan.scheme.name} /> : null}
            <Row label="Principal" value={money(loan.principalAmount)} />
            <Row label="Opened" value={new Date(loan.openedDate).toLocaleDateString("en-IN")} />
            <Row label="Due Date" value={new Date(loan.dueDate).toLocaleDateString("en-IN")} />
          </Card>

          <Card>
            <ThemedText variant="h3" style={{ marginBottom: 10 }}>
              Pledged Gold
            </ThemedText>
            {(loan.ornaments ?? []).map((o) => (
              <View key={o.id} style={styles.ornamentRow}>
                <Icon name="ornament" size={18} color={colors.goldDeep} />
                <ThemedText variant="body" style={{ flex: 1, marginLeft: 8 }}>
                  {o.name}
                </ThemedText>
                <ThemedText variant="small" color={colors.muted}>
                  {o.purity} · {o.netWeight.toFixed(1)}g · x{o.quantity}
                </ThemedText>
              </View>
            ))}
            <View style={[styles.divider, { marginTop: 8 }]} />
            <Row label="Total net weight" value={`${(loan.totalNetWeight ?? 0).toFixed(1)}g`} />
          </Card>

          <Card>
            <ThemedText variant="h3" style={{ marginBottom: 10 }}>
              Outstanding
            </ThemedText>
            <Row label="Principal" value={money(loan.outstandingAmount)} />
            <Row label="Accrued interest" value={money(loan.outstandingInterest)} />
            <Row label="Penal interest" value={money(loan.outstandingPenalInterest)} />
            <View style={styles.divider} />
            <Row label="Total payable" value={money(outstanding)} bold />
          </Card>

          <Card blur>
            <ThemedText variant="h3" style={{ marginBottom: 10 }}>
              Payment History
            </ThemedText>
            {payments.length ? (
              payments.map((p) => (
                <View key={p.id} style={styles.paymentRow}>
                  <View style={{ flex: 1 }}>
                    <ThemedText variant="body">{money(p.amount)}</ThemedText>
                    <ThemedText variant="small" color={colors.muted}>
                      {new Date(p.paidOn).toLocaleDateString("en-IN")} · {p.type}
                    </ThemedText>
                  </View>
                  <ThemedText variant="small" color={colors.muted}>
                    {p.method}
                  </ThemedText>
                </View>
              ))
            ) : (
              <ThemedText variant="small" color={colors.muted}>
                No payments recorded yet.
              </ThemedText>
            )}
          </Card>

          {showRequests && latestRequest ? (
            <Card>
              <ThemedText variant="h3" style={{ marginBottom: 4 }}>
                {latestRequest.type} request
              </ThemedText>
              <ThemedText variant="small" color={colors.muted} style={{ marginBottom: 12 }}>
                Requested {new Date(latestRequest.requestedAt).toLocaleDateString("en-IN")}
              </ThemedText>
              {stagesFor(latestRequest.type).map((label, idx) => {
                const state = dotState(latestRequest, idx);
                const glyph = dotGlyph(state);
                const glyphTone = statusColors(glyph.tone);
                const isLast = idx === stagesFor(latestRequest.type).length - 1;
                return (
                  <View key={label} style={styles.timelineRow}>
                    <View style={styles.timelineDotCol}>
                      <ThemedText variant="body" style={{ color: glyphTone.fg }}>
                        {glyph.symbol}
                      </ThemedText>
                      {!isLast ? <View style={styles.timelineLine} /> : null}
                    </View>
                    <View style={{ flex: 1, paddingBottom: isLast ? 0 : 10 }}>
                      <ThemedText variant="body">{label}</ThemedText>
                      <ThemedText variant="small" color={colors.muted}>
                        {state === "approved" ? "Approved" : state === "rejected" ? "Rejected" : state === "pending" ? "Pending" : ""}
                      </ThemedText>
                    </View>
                  </View>
                );
              })}
            </Card>
          ) : null}

          <GoldButton title="Pay" onPress={() => setPayOpen(true)} style={{ marginTop: 8, marginBottom: 10 }} />
          <View style={{ flexDirection: "row", gap: 10, marginBottom: 24 }}>
            <GoldButton
              title="Request Extension"
              variant="outline"
              onPress={() => setExtensionOpen(true)}
              style={{ flex: 1 }}
            />
            <GoldButton
              title="Request Release"
              variant="outline"
              onPress={() => setReleaseOpen(true)}
              style={{ flex: 1 }}
            />
          </View>
        </ScrollView>
      </ScreenContainer>

      <BottomSheetModal visible={notifOpen} onClose={() => setNotifOpen(false)} maxHeightPct={60} dragToClose={false}>
        <NotificationList />
      </BottomSheetModal>

      <PaySheet visible={payOpen} onClose={() => setPayOpen(false)} loan={loan} onPaid={load} />

      <ExtensionSheet
        visible={extensionOpen}
        onClose={() => setExtensionOpen(false)}
        loanId={loan.id}
        onSubmitted={load}
      />
      <ReleaseSheet
        visible={releaseOpen}
        onClose={() => setReleaseOpen(false)}
        loanId={loan.id}
        outstanding={outstanding}
        onSubmitted={load}
      />
    </View>
  );
}

function Row({ label, value, children, bold }: { label: string; value?: string; children?: React.ReactNode; bold?: boolean }) {
  return (
    <View style={styles.row}>
      <ThemedText variant="small" color={colors.muted}>
        {label}
      </ThemedText>
      {children ?? (
        <ThemedText variant={bold ? "body" : "body"} color={bold ? colors.goldDeep : colors.ink}>
          {value}
        </ThemedText>
      )}
    </View>
  );
}

// --- Request Extension sheet -------------------------------------------

function ExtensionSheet({
  visible,
  onClose,
  loanId,
  onSubmitted,
}: {
  visible: boolean;
  onClose: () => void;
  loanId: number;
  onSubmitted: () => void;
}) {
  const [months, setMonths] = useState("");
  const [detail, setDetail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null);

  useEffect(() => {
    if (visible) {
      setMonths("");
      setDetail("");
      setMessage(null);
    }
  }, [visible]);

  async function submit() {
    const parsed = Number(months);
    if (!parsed || parsed <= 0) {
      setMessage({ text: "Enter how many months to extend by.", error: true });
      return;
    }
    setSubmitting(true);
    setMessage(null);
    try {
      await loansApi.requestExtension(loanId, { months: parsed, detail: detail || undefined });
      setMessage({ text: "Extension request submitted." });
      setTimeout(() => {
        onClose();
        onSubmitted();
      }, 900);
    } catch (err) {
      setMessage({ text: err instanceof ApiError ? err.message : "Could not submit the request.", error: true });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <BottomSheetModal visible={visible} onClose={onClose}>
      <ThemedText variant="h3" style={{ marginBottom: 12 }}>
        Request Extension
      </ThemedText>
      <GoldTextInput
        label="Extend by (months)"
        value={months}
        onChangeText={setMonths}
        keyboardType="number-pad"
        placeholder="3"
      />
      <GoldTextInput
        label="Reason / notes (optional)"
        value={detail}
        onChangeText={setDetail}
        placeholder="Need more time to arrange funds..."
        multiline
        numberOfLines={3}
        style={{ height: 84, textAlignVertical: "top" }}
      />
      {message ? (
        <ThemedText variant="small" color={message.error ? colors.red : colors.green} style={{ marginBottom: 10 }}>
          {message.text}
        </ThemedText>
      ) : null}
      <GoldButton title="Submit Request" onPress={submit} loading={submitting} />
    </BottomSheetModal>
  );
}

// --- Request Gold Release sheet -----------------------------------------

function ReleaseSheet({
  visible,
  onClose,
  loanId,
  outstanding,
  onSubmitted,
}: {
  visible: boolean;
  onClose: () => void;
  loanId: number;
  outstanding: number;
  onSubmitted: () => void;
}) {
  const [detail, setDetail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null);

  useEffect(() => {
    if (visible) {
      setDetail("");
      setMessage(null);
    }
  }, [visible]);

  async function submit() {
    setSubmitting(true);
    setMessage(null);
    try {
      await loansApi.requestRelease(loanId, { detail: detail || undefined });
      setMessage({ text: "Release request submitted." });
      setTimeout(() => {
        onClose();
        onSubmitted();
      }, 900);
    } catch (err) {
      setMessage({ text: err instanceof ApiError ? err.message : "Could not submit the request.", error: true });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <BottomSheetModal visible={visible} onClose={onClose}>
      <ThemedText variant="h3" style={{ marginBottom: 12 }}>
        Request Gold Release
      </ThemedText>
      <ThemedText variant="small" color={colors.muted} style={{ marginBottom: 14 }}>
        You're requesting closure of this loan and release of your pledged gold. Outstanding balance of{" "}
        {money(outstanding)} must be settled first.
      </ThemedText>
      <GoldTextInput
        label="Notes (optional)"
        value={detail}
        onChangeText={setDetail}
        multiline
        numberOfLines={3}
        style={{ height: 84, textAlignVertical: "top" }}
      />
      {message ? (
        <ThemedText variant="small" color={message.error ? colors.red : colors.green} style={{ marginBottom: 10 }}>
          {message.text}
        </ThemedText>
      ) : null}
      <GoldButton title="Submit Request" onPress={submit} loading={submitting} />
    </BottomSheetModal>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 6,
  },
  divider: { height: 1, backgroundColor: colors.line, marginVertical: 8 },
  ornamentRow: { flexDirection: "row", alignItems: "center", paddingVertical: 6 },
  paymentRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  timelineRow: { flexDirection: "row" },
  timelineDotCol: { width: 22, alignItems: "center" },
  timelineLine: { width: 1, flex: 1, backgroundColor: colors.line, marginTop: 2 },
});
