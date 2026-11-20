import React, { useState } from "react";
import { View } from "react-native";
import { C } from "./base";
import { Txt } from "./Txt";
import { Sheet } from "./Sheet";
import { Field } from "./Field";
import { Input } from "./Input";
import { PrimaryButton } from "./PrimaryButton";
import { BtnRow2 } from "./BtnRow2";
import { WarningBanner } from "./WarningBanner";

type ConfirmSheetProps = {
  visible: boolean;
  onClose: () => void;
  title: string;
  message: React.ReactNode;
  confirmLabel?: string;
  /** The dismiss button (default "Cancel"). */
  cancelLabel?: string;
  /** Only the confirm button is shown; the sheet is still dismissed by tapping outside it. */
  hideCancel?: boolean;
  danger?: boolean;
  /** Show a remarks input (value is passed to onConfirm). */
  remarks?: { label: string; placeholder?: string; required?: boolean; initial?: string };
  loading?: boolean;
  error?: string | null;
  onConfirm: (remarks: string) => void;
};

/** Themed replacement for a native Alert.alert() confirm: a rise-up sheet
 * with the message, an optional remarks field, and Cancel / confirm. */
export function ConfirmSheet({
  visible,
  onClose,
  title,
  message,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  hideCancel,
  danger,
  remarks,
  loading,
  error,
  onConfirm,
}: ConfirmSheetProps) {
  const [text, setText] = useState("");
  const [wasVisible, setWasVisible] = useState(visible);
  if (visible !== wasVisible) {
    setWasVisible(visible);
    if (visible) setText(remarks?.initial ?? "");
  }
  return (
    <Sheet visible={visible} onClose={onClose} title={title} maxHeightPct={70}>
      {danger ? <WarningBanner>{message}</WarningBanner> : typeof message === "string" ? <Txt style={{ fontSize: 13, lineHeight: 19, marginVertical: 10 }}>{message}</Txt> : <View style={{ marginVertical: 10 }}>{message}</View>}
      {remarks ? (
        <Field label={remarks.label}>
          <Input placeholder={remarks.placeholder} value={text} onChangeText={setText} multiline />
        </Field>
      ) : null}
      {error ? <Txt style={{ color: C.red, fontSize: 12, fontWeight: "600", marginBottom: 6 }}>{error}</Txt> : null}
      <BtnRow2>
        {hideCancel ? null : <PrimaryButton label={cancelLabel} variant="outline" onPress={onClose} disabled={loading} />}
        <PrimaryButton
          label={confirmLabel}
          variant={danger ? "danger" : "primary"}
          onPress={() => onConfirm(text.trim())}
          loading={loading}
          disabled={!!remarks?.required && !text.trim()}
        />
      </BtnRow2>
    </Sheet>
  );
}
