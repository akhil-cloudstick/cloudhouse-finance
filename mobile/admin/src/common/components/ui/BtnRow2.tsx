import React from "react";
import { View, type StyleProp, type ViewStyle } from "react-native";
import { s } from "./formHelpers";

type BtnRow2Props = { children: React.ReactNode; style?: StyleProp<ViewStyle> };

/** .btn-row-2 */
export function BtnRow2({ children, style }: BtnRow2Props) {
  return (
    <View style={[s.btnRow2, style]}>
      {React.Children.map(children, (c) => (c ? <View style={{ flex: 1 }}>{c}</View> : null))}
    </View>
  );
}

(BtnRow2 as { stickyFooter?: boolean }).stickyFooter = true;
