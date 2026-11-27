import { type StyleProp, type TextInputProps, type ViewStyle } from "react-native";
import { Field } from "./Field";
import { Input } from "./Input";

/** Label + input in one. */
export function TextField({ label, style, ...rest }: TextInputProps & { label: string }) {
  return (
    <Field label={label} style={style as StyleProp<ViewStyle>}>
      <Input {...rest} />
    </Field>
  );
}
