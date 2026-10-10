import { View, type StyleProp, type ViewStyle } from "react-native";
import { C } from "./base";
import { Txt } from "./Txt";
import { s } from "./formHelpers";

type ResultBoxProps = { k: string; v: string; tone?: "brand" | "green" | "red"; style?: StyleProp<ViewStyle> };

// ---- boxes & banners ------------------------------------------------------
/** .result-box */
export function ResultBox({ k, v, tone = "brand", style }: ResultBoxProps) {
  const bg = tone === "green" ? C.greenBg : tone === "red" ? C.redBg : C.brandPale;
  const fg = tone === "green" ? C.green : tone === "red" ? C.red : C.brandDeep;
  return (
    <View style={[s.result, { backgroundColor: bg }, style]}>
      <Txt style={[s.resultK, { color: fg }]}>{k}</Txt>
      <Txt style={[s.resultV, { color: fg }]}>{v}</Txt>
    </View>
  );
}
