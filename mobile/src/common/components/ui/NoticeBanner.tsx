import React from "react";
import { View } from "react-native";
import { Txt } from "./Txt";
import { s } from "./formHelpers";

type NoticeBannerProps = { children: React.ReactNode };

/** .notice-banner */
export function NoticeBanner({ children }: NoticeBannerProps) {
  return (
    <View style={s.notice}>
      <Txt style={s.noticeTxt}>{children}</Txt>
    </View>
  );
}
