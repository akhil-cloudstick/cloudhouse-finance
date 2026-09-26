import React from "react";
import { View } from "react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocalSearchParams, useRouter } from "expo-router";
import { FlatHeader, PScroll, Screen } from "../../../src/components/ui";
import { PacketDetailBody } from "../../../src/components/staff/PacketDetail";
import { getPacket } from "../../../src/api/packets";
import { useRefetchOnFocus } from "../../../src/hooks/useRefetchOnFocus";

// Deep-link route for one packet (loan detail's packet row, the release
// review panel). The Packets list itself opens the same body in a sheet.
export default function PacketDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const packetId = Number(id);
  const router = useRouter();
  const qc = useQueryClient();
  const packet = useQuery({ queryKey: ["packet", String(packetId)], queryFn: () => getPacket(packetId), enabled: packetId > 0 });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["packet", String(packetId)] });
  };
  useRefetchOnFocus(refresh);

  return (
    <Screen header={<FlatHeader title={packet.data?.code ?? "Packet"} subtitle="Ornament custody tracking" back />}>
      <PScroll refreshing={packet.isRefetching} onRefresh={refresh}>
        <View style={{ paddingHorizontal: 18, paddingTop: 4 }}>
          <PacketDetailBody
            packetId={packetId}
            onOpenLoan={(loanId) => {
              router.push("/loans" as never);
              router.push(`/loans/${loanId}` as never);
            }}
          />
        </View>
      </PScroll>
    </Screen>
  );
}
