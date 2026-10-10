import React from "react";
import { View } from "react-native";
import { Txt } from "./Txt";
import { s } from "./cardStyles";

type DetailRowProps = { k: string; v: React.ReactNode; first?: boolean };

/** .cust-detail-row */
export function DetailRow({ k, v, first }: DetailRowProps) {
  return (
    <View style={[s.detailRow, !first && s.detailBorder]}>
      <Txt style={s.detailK}>{k}</Txt>
      <View style={{ flexShrink: 1, alignItems: "flex-end" }}>{typeof v === "string" || typeof v === "number" ? <Txt style={s.detailV}>{v}</Txt> : v}</View>
    </View>
  );
}
