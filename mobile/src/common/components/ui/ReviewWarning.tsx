import React from "react";
import { View } from "react-native";
import { C } from "./base";
import { Txt } from "./Txt";
import { PIcon } from "./PIcon";
import { s } from "./formHelpers";

type ReviewWarningProps = { children: React.ReactNode };

/** .review-warning */
export function ReviewWarning({ children }: ReviewWarningProps) {
  return (
    <View style={[s.warn, { backgroundColor: C.amberBg }]}>
      <PIcon name="alert" color={C.amber} />
      <Txt style={[s.warnTxt, { color: C.amber }]}>{children}</Txt>
    </View>
  );
}
