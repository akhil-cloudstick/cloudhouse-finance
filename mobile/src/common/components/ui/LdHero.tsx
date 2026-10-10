import React from "react";
import { View } from "react-native";
import { Txt } from "./Txt";
import { s } from "./cardStyles";

type LdHeroProps = { name: string; sub: string; status?: React.ReactNode; amounts: { k: string; v: string; color?: string }[] };

/** .ld-hero — name/sub/status + 3 amount columns. */
export function LdHero({ name, sub, status, amounts }: LdHeroProps) {
  return (
    <View style={s.ldHero}>
      <View style={s.ldHeroTop}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Txt style={s.ldName}>{name}</Txt>
          <Txt style={s.ldSub}>{sub}</Txt>
        </View>
        {status}
      </View>
      <View style={s.ldAmtRow}>
        {amounts.map((a) => (
          <View key={a.k} style={{ flex: 1 }}>
            <Txt style={s.ldAmtK}>{a.k.toUpperCase()}</Txt>
            <Txt style={[s.ldAmtV, a.color ? { color: a.color } : null]}>{a.v}</Txt>
          </View>
        ))}
      </View>
    </View>
  );
}
