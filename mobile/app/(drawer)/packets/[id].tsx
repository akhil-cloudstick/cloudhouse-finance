import React, { useState } from "react";
import { useLocalSearchParams } from "expo-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ScreenContainer } from "../../../src/components/ScreenContainer";
import { Card } from "../../../src/components/Card";
import { ThemedText } from "../../../src/components/ThemedText";
import { GoldTextInput } from "../../../src/components/GoldTextInput";
import { GoldButton } from "../../../src/components/GoldButton";
import { ChipSelect } from "../../../src/components/ChipSelect";
import { colors } from "../../../src/theme/colors";
import { getPacket, getPacketMovements, movePacket } from "../../../src/api/packets";
import { useAuth } from "../../../src/auth/AuthContext";
import { ApiError } from "../../../src/api/client";

const STAGES = [
  "Packet Generated",
  "Locker Stored",
  "Bank Pledged",
  "Ready For Release",
  "Returned",
  "Released",
] as const;

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

  const [toStatus, setToStatus] = useState<(typeof STAGES)[number]>("Locker Stored");
  const [remarks, setRemarks] = useState("");
  const [error, setError] = useState<string | null>(null);

  const move = useMutation({
    mutationFn: () => movePacket(packetId, { toStatus, employeeId: employee!.id, remarks: remarks || undefined }),
    onSuccess: () => {
      setRemarks("");
      setError(null);
      queryClient.invalidateQueries({ queryKey: ["packet", id] });
      queryClient.invalidateQueries({ queryKey: ["packet", id, "movements"] });
      queryClient.invalidateQueries({ queryKey: ["packets"] });
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Could not record movement."),
  });

  if (packet.isLoading) return <ScreenContainer><ThemedText color={colors.muted}>Loading…</ThemedText></ScreenContainer>;
  if (packet.isError || !packet.data)
    return <ScreenContainer><ThemedText color={colors.red}>Could not load this packet.</ThemedText></ScreenContainer>;

  return (
    <ScreenContainer>
      <Card>
        <ThemedText variant="h2" color={colors.goldDeep}>
          {packet.data.code}
        </ThemedText>
        <ThemedText variant="body" style={{ marginTop: 8 }}>
          {packet.data.loan?.loanNumber ?? `Loan #${packet.data.loanId}`}
        </ThemedText>
        <ThemedText variant="label" style={{ marginTop: 8 }}>
          Current status: {packet.data.status}
        </ThemedText>
      </Card>

      <Card>
        <ThemedText variant="h3" style={{ marginBottom: 8 }}>
          Record movement
        </ThemedText>
        <ChipSelect label="Move to" options={STAGES} value={toStatus} onChange={setToStatus} />
        <GoldTextInput label="Remarks" value={remarks} onChangeText={setRemarks} />
        {error ? (
          <ThemedText variant="small" color={colors.red} style={{ marginBottom: 8 }}>
            {error}
          </ThemedText>
        ) : null}
        <GoldButton title="Record" onPress={() => move.mutate()} loading={move.isPending} />
      </Card>

      <Card>
        <ThemedText variant="h3" style={{ marginBottom: 8 }}>
          Movement history
        </ThemedText>
        {movements.data?.length ? (
          movements.data.map((m) => (
            <ThemedText key={m.id} variant="small" color={colors.muted} style={{ marginBottom: 4 }}>
              {new Date(m.createdAt).toLocaleString()} · {m.fromStatus} → {m.toStatus}
            </ThemedText>
          ))
        ) : (
          <ThemedText variant="small" color={colors.muted}>
            No movements yet.
          </ThemedText>
        )}
      </Card>
    </ScreenContainer>
  );
}
