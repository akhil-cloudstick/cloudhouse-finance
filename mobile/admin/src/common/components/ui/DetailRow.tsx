import React from "react";
import { View } from "react-native";
import { Txt } from "./Txt";
import { s } from "./cardStyles";
import { TruncText } from "./TruncText";

/** truncLines: long free text is clipped to that many lines; tap to expand. */
type DetailRowProps = { k: string; v: React.ReactNode; first?: boolean; truncLines?: number };

/** .cust-detail-row */
export function DetailRow({ k, v, first, truncLines }: DetailRowProps) {
  return (
    <View style={[s.detailRow, !first && s.detailBorder]}>
      <Txt style={s.detailK}>{k}</Txt>
      <View style={{ flexShrink: 1, alignItems: "flex-end" }}>{truncLines && typeof v === "string" ? (
          <TruncText lines={truncLines} style={[s.detailV, { textAlign: "right" }]}>{v}</TruncText>
        ) : typeof v === "string" || typeof v === "number" ? (
          <Txt style={s.detailV}>{v}</Txt>
        ) : (
          v
        )}</View>
    </View>
  );
}
