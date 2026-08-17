import React, { useState } from "react";
import { FlatList, RefreshControl, Pressable, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { ScreenContainer } from "../../../src/components/ScreenContainer";
import { Card } from "../../../src/components/Card";
import { ThemedText } from "../../../src/components/ThemedText";
import { GoldTextInput } from "../../../src/components/GoldTextInput";
import { GoldButton } from "../../../src/components/GoldButton";
import { colors, statusColors } from "../../../src/theme/colors";
import { listPackets, getPacketByCode } from "../../../src/api/packets";
import { Packet } from "../../../src/types/packet";

function toneForStatus(status: string) {
  if (status === "Released") return "green" as const;
  if (status === "Bank Pledged") return "blue" as const;
  if (status === "Ready For Release" || status === "Returned") return "amber" as const;
  return "muted" as const;
}

// Barcode/QR lookup (`by-code`) is a separate real endpoint from the
// status-filtered list — both are server-side, no client-side scanning of
// a full packet list to find a code.
export default function PacketsScreen() {
  const router = useRouter();
  const [status, setStatus] = useState<string | undefined>(undefined);
  const [code, setCode] = useState("");
  const [lookupError, setLookupError] = useState<string | null>(null);

  const { data, isLoading, isError, refetch, isRefetching } = useQuery({
    queryKey: ["packets", status],
    queryFn: () => listPackets({ status }),
  });

  async function lookupByCode() {
    setLookupError(null);
    try {
      const packet = await getPacketByCode(code.trim());
      router.push(`/packets/${packet.id}`);
    } catch {
      setLookupError("No packet found for that code.");
    }
  }

  return (
    <ScreenContainer style={{ paddingHorizontal: 0 }}>
      <View style={{ paddingHorizontal: 16 }}>
        <GoldTextInput label="Find by barcode/QR code" value={code} onChangeText={setCode} />
        {lookupError ? (
          <ThemedText variant="small" color={colors.red} style={{ marginBottom: 8 }}>
            {lookupError}
          </ThemedText>
        ) : null}
        <GoldButton title="Find packet" variant="outline" onPress={lookupByCode} disabled={!code} />
      </View>
      <FlatList<Packet>
        data={data ?? []}
        keyExtractor={(item) => String(item.id)}
        contentContainerStyle={{ padding: 16 }}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} />}
        ListEmptyComponent={
          <ThemedText color={colors.muted}>
            {isLoading ? "Loading…" : isError ? "Could not load packets." : "No packets found."}
          </ThemedText>
        }
        renderItem={({ item }) => {
          const tone = statusColors(toneForStatus(item.status));
          return (
            <Pressable onPress={() => router.push(`/packets/${item.id}`)}>
              <Card>
                <ThemedText variant="h3">{item.code}</ThemedText>
                <ThemedText variant="small" color={colors.muted}>
                  {item.loan?.loanNumber ?? `Loan #${item.loanId}`}
                </ThemedText>
                <ThemedText
                  variant="label"
                  style={{
                    marginTop: 8,
                    alignSelf: "flex-start",
                    backgroundColor: tone.bg,
                    color: tone.fg,
                    paddingHorizontal: 8,
                    paddingVertical: 3,
                    borderRadius: 6,
                  }}
                >
                  {item.status}
                </ThemedText>
              </Card>
            </Pressable>
          );
        }}
      />
    </ScreenContainer>
  );
}
