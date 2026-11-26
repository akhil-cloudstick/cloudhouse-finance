import { View } from "react-native";
import { C } from "./base";
import { Txt } from "./Txt";
import { s } from "./chipTones";

type KycBadgeProps = { verified: boolean; label?: string };

/** .kyc-badge */
export function KycBadge({ verified, label }: KycBadgeProps) {
  return (
    <View style={[s.kyc, { backgroundColor: verified ? C.greenBg : C.amberBg }]}>
      <Txt style={[s.kycTxt, { color: verified ? C.green : C.amber }]}>{label ?? (verified ? "Verified" : "Pending")}</Txt>
    </View>
  );
}
