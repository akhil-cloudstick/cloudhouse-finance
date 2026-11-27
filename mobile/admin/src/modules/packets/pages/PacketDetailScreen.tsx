import React from "react";
import { View } from "react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocalSearchParams } from "expo-router";
import { FlatHeader, PScroll, Screen, openPage } from "@/common/components/ui";
import { PacketDetailBody } from "@/modules/packets/components/PacketDetailBody";
import { getPacket } from "@/modules/packets/services/packetService";
import { useRefetchOnFocus } from "@/common/hooks/use-refetch-on-focus";

// Deep-link route for one packet (loan detail's packet row, the release
// review panel). The Packets list itself opens the same body in a sheet.
export default function PacketDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const packetId = Number(id);
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
              openPage(`/loans/${loanId}`);
            }}
          />
        </View>
      </PScroll>
    </Screen>
  );
}
