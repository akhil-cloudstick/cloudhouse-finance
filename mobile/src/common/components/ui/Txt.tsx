import { Text, type TextProps } from "react-native";
import { textStyle } from "@/common/theme/typography";
import { styles } from "./base";

// Staff UI text: Inter on Android (iOS keeps the system face), sizes scaled
// by FONT_SCALE centrally — see textStyle in typography.ts. Base size is
// the prototype's .app 14.5 (rendered 16 after scaling).
export function Txt({ style, ...rest }: TextProps) {
  return <Text allowFontScaling={false} {...rest} style={textStyle([styles.txt, style])} />;
}
