import { useState, type ReactNode } from "react";
import { Keyboard, Pressable, View } from "react-native";
import { C } from "./base";
import { Txt } from "./Txt";
import { PIcon } from "./PIcon";
import { Popover, useAnchor, type Anchor } from "./Popover";
import { MenuItem } from "./MenuItem";

type ExportMenuProps = {
  onExcel: () => void;
  onPdf: () => void;
  /** Shows "Exporting…" and ignores taps while an export is running. */
  busy?: boolean;
  /** Custom trigger (e.g. a row's Print link); defaults to a plain Export button. */
  renderTrigger?: (open: () => void) => ReactNode;
};

/** An "Export" button that drops a small Excel / PDF menu under itself. */
export function ExportMenu({ onExcel, onPdf, busy, renderTrigger }: ExportMenuProps) {
  const { ref, measure } = useAnchor();
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  const close = () => setAnchor(null);
  const toggle = () => {
    if (busy) return;
    if (anchor) return close();
    Keyboard.dismiss();
    measure(setAnchor);
  };
  const pick = (run: () => void) => () => {
    close();
    run();
  };
  return (
    <View ref={ref} collapsable={false} style={renderTrigger ? undefined : { alignSelf: "stretch" }}>
      {renderTrigger ? (
        renderTrigger(toggle)
      ) : (
        <Pressable
          onPress={toggle}
          accessibilityRole="button"
          accessibilityLabel="Export"
          style={{ flex: 1, justifyContent: "center", alignItems: "center", paddingHorizontal: 14, borderRadius: 11, backgroundColor: C.brandDeep, opacity: busy ? 0.6 : 1 }}
        >
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <PIcon name="download" color="#fff" size={16} />
            <Txt style={{ fontSize: 13, fontWeight: "700", color: "#fff" }}>{busy ? "Exporting…" : "Export"}</Txt>
          </View>
        </Pressable>
      )}
      <Popover anchor={anchor} onClose={close} onRemeasure={() => measure(setAnchor)} minWidth={140}>
        <MenuItem title="Excel" onPress={pick(onExcel)} />
        <MenuItem title="PDF" onPress={pick(onPdf)} />
      </Popover>
    </View>
  );
}
