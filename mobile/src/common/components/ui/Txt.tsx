import { Text, type TextProps } from "react-native";
import { styles } from "./base";

// Staff UI text: the prototype uses the platform system face
// (-apple-system / Roboto), so no fontFamily is set — RN's default IS the
// system font on both platforms. Base size is the prototype's .app 14.5.
export function Txt({ style, ...rest }: TextProps) {
  return <Text allowFontScaling={false} {...rest} style={[styles.txt, style]} />;
}
