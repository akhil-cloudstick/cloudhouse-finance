import { useQuery } from "@tanstack/react-query";
import { Sheet } from "@/common/components/ui";
import { getPacket } from "@/modules/packets/services/packetService";
import { PacketDetailBody } from "./PacketDetailBody";

/** Packet code for the sheet title (cached with the body's query). */
function usePacketCode(packetId: number, enabled: boolean) {
  const q = useQuery({ queryKey: ["packet", String(packetId)], queryFn: () => getPacket(packetId), enabled: enabled && packetId > 0 });
  return q.data?.code;
}
type PacketDetailSheetProps = {
  packetId: number | null;
  visible: boolean;
  onClose: () => void;
  onOpenLoan: (loanId: number) => void;
};

export function PacketDetailSheet({
  packetId,
  visible,
  onClose,
  onOpenLoan,
}: PacketDetailSheetProps) {
  const code = usePacketCode(packetId ?? 0, visible);
  return (
    <Sheet visible={visible} onClose={onClose} title={code ?? "Packet"} maxHeightPct={88}>
      {packetId ? <PacketDetailBody packetId={packetId} onOpenLoan={onOpenLoan} /> : null}
    </Sheet>
  );
}
