import { Pressable } from "react-native";
import { C } from "./base";
import { Txt } from "./Txt";
import { s } from "./formHelpers";

type UploadBoxProps = { label: string; onPress: () => void; done?: boolean };

/** Dashed "Tap to upload" box. */
export function UploadBox({ label, onPress, done }: UploadBoxProps) {
  return (
    <Pressable onPress={onPress} style={[s.upload, done && { borderColor: C.green, backgroundColor: C.greenBg }]}>
      <Txt style={{ color: done ? C.green : C.muted, fontSize: 12, fontWeight: done ? "700" : "400" }}>{label}</Txt>
    </Pressable>
  );
}
