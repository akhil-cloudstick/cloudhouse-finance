import { View } from "react-native";
import { C, initialsOf } from "./base";
import { Txt } from "./Txt";

type AvatarProps = { name?: string | null; size?: number; radius?: number; fontSize?: number; filled?: boolean };

/** Rounded-square initials avatar (.cust-header-avatar / .act-avatar). */
export function Avatar({ name, size = 38, radius = 11, fontSize = 13, filled = true }: AvatarProps) {
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        backgroundColor: filled ? C.brandDeep : C.brandFaint,
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
      }}
    >
      <Txt style={{ color: filled ? "#fff" : C.brandDeep, fontWeight: "700", fontSize }}>{initialsOf(name)}</Txt>
    </View>
  );
}
