import { Text, type TextProps } from "react-native";
import { textStyle } from "@/common/theme/typography";
import { styles } from "./base";

// Sizes scaled by FONT_SCALE centrally — see textStyle in typography.ts.
export function Txt({ style, ...rest }: TextProps) {
  return <Text allowFontScaling={false} {...rest} style={textStyle([styles.txt, style])} />;
}
