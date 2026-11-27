import React from "react";
import { View } from "react-native";
import { C } from "./base";
import { Txt } from "./Txt";
import { PIcon } from "./PIcon";
import { s } from "./formHelpers";

type WarningBannerProps = { children: React.ReactNode };

/** .warning-banner */
export function WarningBanner({ children }: WarningBannerProps) {
  return (
    <View style={s.warn}>
      <PIcon name="alert" color={C.red} />
      <Txt style={s.warnTxt}>{children}</Txt>
    </View>
  );
}
