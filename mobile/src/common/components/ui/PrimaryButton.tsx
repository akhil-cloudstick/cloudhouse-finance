import { Pressable, type StyleProp, type ViewStyle } from "react-native";
import { C } from "./base";
import { Spinner } from "./Spinner";
import { Txt } from "./Txt";
import { s } from "./formHelpers";

type PrimaryButtonProps = {
  label: string;
  onPress: () => void;
  variant?: "primary" | "outline" | "reject" | "danger";
  disabled?: boolean;
  loading?: boolean;
  style?: StyleProp<ViewStyle>;
};

// ---- .btn-primary ---------------------------------------------------------
export function PrimaryButton({
  label,
  onPress,
  variant = "primary",
  disabled,
  loading,
  style,
}: PrimaryButtonProps) {
  const fg = variant === "primary" || variant === "danger" ? "#fff" : variant === "reject" ? C.red : C.brandDeep;
  return (
    <Pressable
      disabled={disabled || loading}
      onPress={onPress}
      style={[
        s.btn,
        variant === "outline" && s.btnOutline,
        variant === "reject" && s.btnReject,
        variant === "danger" && { backgroundColor: C.red },
        disabled && { opacity: 0.45 },
        style,
      ]}
    >
      {loading ? <Spinner color={fg} size={20} /> : <Txt style={[s.btnTxt, { color: fg }]}>{label}</Txt>}
    </Pressable>
  );
}

(PrimaryButton as { stickyFooter?: boolean }).stickyFooter = true;
