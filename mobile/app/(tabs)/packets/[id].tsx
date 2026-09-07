import React, { useState } from "react";
import { ScrollView, View, RefreshControl } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useRefetchOnFocus } from "../../../src/hooks/useRefetchOnFocus";
import { ScreenContainer } from "../../../src/components/ScreenContainer";
import { Card } from "../../../src/components/Card";
import { ThemedText } from "../../../src/components/ThemedText";
import { GoldTextInput } from "../../../src/components/GoldTextInput";
import { GoldButton } from "../../../src/components/GoldButton";
import { ChipSelect } from "../../../src/components/ChipSelect";
import { Stepper, Step } from "../../../src/components/Stepper";
import { colors } from "../../../src/theme/colors";
import { getPacket, getPacketMovements, movePacket } from "../../../src/api/packets";
import { listLockers } from "../../../src/api/lockers";
import { useAuth } from "../../../src/auth/AuthContext";
import { ApiError } from "../../../src/api/client";
import { fmt } from "../../../src/lib/format";

// Exactly backend/internal/packet/service.go's allowedTransitions graph. The
// screen used to offer all six stages as equal chips, so every backwards or
// skipping choice — and the current stage itself — was offered and then
// rejected by the server with "invalid packet stage transition". Only legal
// next stages are offered now.
const NEXT: Record<string, string[]> = {
  "Packet Generated": ["Locker Stored"],
  "Locker Stored": ["Bank Pledged", "Ready For Release"],
  "Bank Pledged": ["Returned"],
  Returned: ["Locker Stored", "Ready For Release"],
  "Ready For Release": ["Released"],
  Released: [],
};

// The stepper rail shows the main path. "Returned" is a detour off Bank
// Pledged rather than a step on the way to Released, so it isn't a rung —
// it's surfaced as the current stage's caption when a packet sits there.
const RAIL = ["Packet Generated", "Locker Stored", "Bank Pledged", "Ready For Release", "Released"];

export default function PacketDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const packetId = Number(id);
  const queryClient = useQueryClient();
  const { employee } = useAuth();

  const packet = useQuery({ queryKey: ["packet", id], queryFn: () => getPacket(packetId), enabled: !!id });
  const movements = useQuery({
    queryKey: ["packet", id, "movements"],
    queryFn: () => getPacketMovements(packetId),
    enabled: !!id,
  });

  useRefetchOnFocus(packet.refetch, movements.refetch);

  const status = packet.data?.status ?? "";
  const nextStages = NEXT[status] ?? [];

  const [toStatus, setToStatus] = useState<string | null>(null);
  const [lockerId, setLockerId] = useState<number | null>(null);
  const [remarks, setRemarks] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Only one legal move? Then there's nothing to choose — the button says
  // what it does and that's the whole form.
  const target = toStatus ?? (nextStages.length === 1 ? nextStages[0] : null);

  // A move into a locker must name the locker: the backend rejects it with
  // ErrLockerRequired otherwise, which is why "Locker Stored" never worked
  // from this screen before.
  const needsLocker = target === "Locker Stored";
  const lockers = useQuery({ queryKey: ["lockers"], queryFn: listLockers, enabled: needsLocker });

  const move = useMutation({
    mutationFn: () =>
      movePacket(packetId, {
        toStatus: target!,
        lockerId: needsLocker ? lockerId! : undefined,
        employeeId: employee!.id,
        remarks: remarks || undefined,
      }),
    onSuccess: () => {
      setRemarks("");
      setToStatus(null);
      setLockerId(null);
      setError(null);
      queryClient.invalidateQueries({ queryKey: ["packet", id] });
      queryClient.invalidateQueries({ queryKey: ["packet", id, "movements"] });
      queryClient.invalidateQueries({ queryKey: ["packets"] });
      queryClient.invalidateQueries({ queryKey: ["lockers"] });
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Could not record movement."),
  });

  if (packet.isLoading)
    return (
      <ScreenContainer style={{ padding: 0 }}>
        <View style={{ flex: 1, paddingHorizontal: 8, paddingTop: 20 }}>
      <ThemedText color={colors.muted}>Loading…</ThemedText>
        </View>
      </ScreenContainer>    );
  if (packet.isError || !packet.data)
    return (
      <ScreenContainer style={{ padding: 0 }}>
        <View style={{ flex: 1, paddingHorizontal: 8, paddingTop: 20 }}>
      <ThemedText color={colors.red}>Could not load this packet.</ThemedText>
        </View>
      </ScreenContainer>    );

  // "Returned" is off-rail, so the packet's progress is measured from the
  // stage it returned to — Bank Pledged is behind it either way.
  const railIndex = RAIL.indexOf(status === "Returned" ? "Bank Pledged" : status);
  const steps: Step[] = RAIL.map((label, i) => ({
    key: label,
    label,
    state: i < railIndex ? "done" : i === railIndex ? "current" : "upcoming",
    caption:
      i === railIndex && status === "Returned"
        ? "Returned from the bank — awaiting locker or release"
        : undefined,
  }));

  const lockerOptions = (lockers.data ?? []).filter((l) => l.isActive);
  const canRecord = !!target && (!needsLocker || !!lockerId);

  const ornaments = packet.data.loan?.ornaments ?? [];
  const totalNetWeight = ornaments.reduce((sum, o) => sum + (o.netWeight || 0), 0);
  const totalGoldValue = ornaments.reduce((sum, o) => sum + (o.goldValue || 0), 0);

  return (
    <ScreenContainer style={{ padding: 0 }}>
      <View style={{ flex: 1, paddingHorizontal: 8, paddingTop: 20 }}>      {/* The stepper makes this screen taller than the viewport — same
          ScrollView wrapper the loan detail screen uses. */}
      <ScrollView
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={packet.isRefetching || movements.isRefetching}
            onRefresh={() => {
              packet.refetch();
              movements.refetch();
            }}
          />
        }
      >
      <Card>
        <ThemedText variant="h2" color={colors.brandDeep}>
          {packet.data.code}
        </ThemedText>
        <ThemedText variant="body" style={{ marginTop: 8 }}>
          {packet.data.loan?.loanNumber ?? `Loan #${packet.data.loanId}`}
        </ThemedText>
      </Card>

      {/* What's actually inside the packet. These are the ornaments of the
          loan it belongs to — the backend preloads them via
          Preload("Loan.Ornaments"), so they arrive nested under `loan`. Staff
          opening a locker need to check the contents against this list, which
          is why the web PacketDetail shows the same table; mobile was simply
          never rendering the data it was already being sent. */}
      <Card>
        <ThemedText variant="h3" style={{ marginBottom: 10 }}>
          Packet contents
        </ThemedText>
        {ornaments.length === 0 ? (
          <ThemedText variant="small" color={colors.muted}>
            No ornaments recorded on this loan.
          </ThemedText>
        ) : (
          <>
            {ornaments.map((o) => (
              <View
                key={o.id}
                style={{
                  flexDirection: "row",
                  justifyContent: "space-between",
                  alignItems: "flex-start",
                  gap: 12,
                  paddingVertical: 8,
                  borderTopWidth: 1,
                  borderTopColor: colors.line,
                }}
              >
                <View style={{ flex: 1 }}>
                  <ThemedText variant="body">
                    {o.name}
                    {o.quantity > 1 ? ` × ${o.quantity}` : ""}
                  </ThemedText>
                  <ThemedText variant="small" color={colors.muted}>
                    {o.purity} · {o.netWeight}g net
                    {o.grossWeight && o.grossWeight !== o.netWeight ? ` (${o.grossWeight}g gross)` : ""}
                  </ThemedText>
                  {o.remarks ? (
                    <ThemedText variant="small" color={colors.muted}>
                      {o.remarks}
                    </ThemedText>
                  ) : null}
                </View>
                <ThemedText variant="body" color={colors.brandDeep}>
                  {fmt(o.goldValue)}
                </ThemedText>
              </View>
            ))}
            <View
              style={{
                flexDirection: "row",
                justifyContent: "space-between",
                paddingTop: 10,
                marginTop: 2,
                borderTopWidth: 1,
                borderTopColor: colors.line,
              }}
            >
              <ThemedText variant="label" color={colors.muted}>
                {ornaments.length} item{ornaments.length === 1 ? "" : "s"} · {totalNetWeight.toFixed(2)}g net
              </ThemedText>
              <ThemedText variant="label" color={colors.brandDeep}>
                {fmt(totalGoldValue)}
              </ThemedText>
            </View>
          </>
        )}
      </Card>

      <Card>
        <ThemedText variant="h3" style={{ marginBottom: 14 }}>
          Custody progress
        </ThemedText>
        <Stepper steps={steps} />
      </Card>

      <Card>
        <ThemedText variant="h3" style={{ marginBottom: 8 }}>
          {nextStages.length ? "Advance packet" : "Lifecycle complete"}
        </ThemedText>

        {nextStages.length === 0 ? (
          <ThemedText variant="small" color={colors.muted}>
            This packet is {status}. There are no further movements to record.
          </ThemedText>
        ) : (
          <>
            {nextStages.length > 1 ? (
              <ChipSelect
                label="Next stage"
                options={nextStages}
                value={target ?? ""}
                onChange={(v) => {
                  setToStatus(v);
                  setLockerId(null);
                  setError(null);
                }}
              />
            ) : (
              <ThemedText variant="small" color={colors.muted} style={{ marginBottom: 12 }}>
                Next stage: {target}
              </ThemedText>
            )}

            {needsLocker ? (
              lockerOptions.length ? (
                <ChipSelect
                  label="Store in locker"
                  options={lockerOptions.map((l) => l.code)}
                  value={lockerOptions.find((l) => l.id === lockerId)?.code ?? ""}
                  onChange={(code) => setLockerId(lockerOptions.find((l) => l.code === code)?.id ?? null)}
                />
              ) : (
                <ThemedText variant="small" color={colors.muted} style={{ marginBottom: 12 }}>
                  {lockers.isLoading ? "Loading lockers…" : "No active locker to store this packet in."}
                </ThemedText>
              )
            ) : null}

            <GoldTextInput label="Remarks" value={remarks} onChangeText={setRemarks} />
            {error ? (
              <ThemedText variant="small" color={colors.red} style={{ marginBottom: 8 }}>
                {error}
              </ThemedText>
            ) : null}
            <GoldButton
              title={target ? `Move to ${target}` : "Pick the next stage"}
              onPress={() => move.mutate()}
              loading={move.isPending}
              disabled={!canRecord}
            />
          </>
        )}
      </Card>

      <Card>
        <ThemedText variant="h3" style={{ marginBottom: 8 }}>
          Movement history
        </ThemedText>
        {movements.data?.length ? (
          movements.data.map((m) => (
            <View key={m.id} style={{ marginBottom: 6 }}>
              <ThemedText variant="small">
                {m.fromStatus ? `${m.fromStatus} → ${m.toStatus}` : m.toStatus}
              </ThemedText>
              <ThemedText variant="small" color={colors.muted}>
                {new Date(m.createdAt).toLocaleString()}
                {m.remarks ? ` · ${m.remarks}` : ""}
              </ThemedText>
            </View>
          ))
        ) : (
          <ThemedText variant="small" color={colors.muted}>
            No movements yet.
          </ThemedText>
        )}
      </Card>
      </ScrollView>
      </View>
    </ScreenContainer>  );
}
