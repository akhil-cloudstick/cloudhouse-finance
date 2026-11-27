import { View } from "react-native";
import { C } from "./base";
import { PIcon } from "./PIcon";

type ChevronProps = { open: boolean };

export function Chevron({ open }: ChevronProps) {
  return (
    <View style={open ? { transform: [{ rotate: "180deg" }] } : null}>
      <PIcon name="chevdown" color={C.brandDeep} />
    </View>
  );
}
