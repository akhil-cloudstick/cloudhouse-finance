import { C, Txt } from "@/common/components/ui";
import { useCanOpen } from "@/common/config/routePermissions";

type LedgerLinkProps = { label: string; onPress: () => void; to: string };

export function LedgerLink({ label, onPress, to }: LedgerLinkProps) {
  const canOpen = useCanOpen();
  if (!canOpen(to)) return <Txt style={{ fontSize: 13, fontWeight: "600" }}>{label}</Txt>;
  return (
    <Txt onPress={onPress} style={{ fontSize: 13, fontWeight: "600", color: C.brandDeep, textDecorationLine: "underline" }}>
      {label}
    </Txt>
  );
}
