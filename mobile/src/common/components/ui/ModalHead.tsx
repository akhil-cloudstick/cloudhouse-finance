import React from "react";
import { Pressable, View } from "react-native";
import { Txt } from "./Txt";
import { s } from "./sheetStyles";

type ModalHeadProps = { title?: React.ReactNode; onClose: () => void; closeLabel?: string; hideClose?: boolean; children?: React.ReactNode };

/** .modal-head — title, spacer, "Close". */
export function ModalHead({ title, onClose, closeLabel = "Close", hideClose, children }: ModalHeadProps) {
  return (
    <View style={s.head}>
      {children ?? (
        <>
          {typeof title === "string" ? (
            <Txt style={s.headTitle} numberOfLines={1}>
              {title}
            </Txt>
          ) : (
            title
          )}
          {/* A custom title node (e.g. GroupedFilter's title + "Reset all") fills the row itself. */}
          {typeof title === "string" ? <View style={{ flex: 1 }} /> : null}
        </>
      )}
      {hideClose ? null : (
        <Pressable onPress={onClose} hitSlop={10}>
          <Txt style={s.cancel}>{closeLabel}</Txt>
        </Pressable>
      )}
    </View>
  );
}
