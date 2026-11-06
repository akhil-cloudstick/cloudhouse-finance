import { useState } from "react";
import { Keyboard, View } from "react-native";
import { Popover, useAnchor, type Anchor } from "./Popover";
import { PillButton } from "./PillButton";
import { MenuItem } from "./MenuItem";

type ExportMenuProps = {
  onExcel: () => void;
  onPdf: () => void;
  /** Shows "Exporting…" and ignores taps while an export is running. */
  busy?: boolean;
};

/** One "Export" pill that opens a small menu with Excel and PDF, replacing the
 * separate Download / Export PDF buttons. */
export function ExportMenu({ onExcel, onPdf, busy }: ExportMenuProps) {
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
    <View ref={ref} collapsable={false}>
      <PillButton label={busy ? "Exporting…" : "Export ▾"} onPress={toggle} />
      <Popover anchor={anchor} onClose={close} onRemeasure={() => measure(setAnchor)} minWidth={140}>
        <MenuItem title="Excel" onPress={pick(onExcel)} />
        <MenuItem title="PDF" onPress={pick(onPdf)} />
      </Popover>
    </View>
  );
}
