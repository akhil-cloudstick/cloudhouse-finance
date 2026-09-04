import React, { useEffect, useState } from "react";
import { Modal, View, Pressable, StyleSheet } from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ThemedText } from "./ThemedText";
import { GoldButton } from "./GoldButton";
import { colors } from "../theme/colors";

// Full-screen QR scanner sheet — used by Packets/Lockers' "Scan Label"
// buttons to read the QR printed on a packet label (see
// src/utils/loanPrint.ts's printPacketLabel, which encodes
// `${API_ORIGIN}/app#packet/<code>` or `#loan/<loanNumber>`). Deliberately a
// plain React Native `Modal` rather than BottomSheetModal — this needs the
// full screen for the camera preview, not a sheet rising partway up.
export function QrScanner({
  visible,
  onClose,
  onScanned,
  title = "Scan Label",
}: {
  visible: boolean;
  onClose: () => void;
  /** Called once per open with the decoded QR string (raw, unparsed) — the
   * caller owns interpreting it (see parsePacketCode below) and closing the
   * scanner once it's done with the result. */
  onScanned: (data: string) => void;
  title?: string;
}) {
  const [permission, requestPermission] = useCameraPermissions();
  const insets = useSafeAreaInsets();
  // A CameraView keeps firing onBarcodeScanned for every frame that still
  // contains the code — without this lock, a single scan re-fires dozens of
  // times before the caller has a chance to close the sheet or navigate
  // away, potentially re-triggering navigation/lookups repeatedly.
  const [locked, setLocked] = useState(false);

  useEffect(() => {
    if (visible) setLocked(false);
  }, [visible]);

  function handleScanned({ data }: { data: string }) {
    if (locked) return;
    setLocked(true);
    onScanned(data);
  }

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={styles.wrap}>
        {permission?.granted ? (
          <>
            <CameraView
              style={StyleSheet.absoluteFill}
              facing="back"
              barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
              onBarcodeScanned={locked ? undefined : handleScanned}
            />
            <View style={styles.frame} pointerEvents="none" />
          </>
        ) : (
          <View style={styles.permissionWrap}>
            <ThemedText variant="body" color={colors.card} style={{ textAlign: "center", marginBottom: 16 }}>
              {permission?.canAskAgain === false
                ? "Camera access was denied. Enable it in Settings to scan labels."
                : "Camera access is needed to scan packet labels."}
            </ThemedText>
            {permission?.canAskAgain !== false ? <GoldButton title="Allow Camera" onPress={requestPermission} /> : null}
          </View>
        )}

        <View style={[styles.titleWrap, { top: insets.top + 12 }]} pointerEvents="none">
          <ThemedText variant="h3" color={colors.card}>
            {title}
          </ThemedText>
        </View>
        <Pressable onPress={onClose} hitSlop={12} style={[styles.closeBtn, { top: insets.top + 6 }]}>
          <ThemedText variant="h3" color={colors.card}>
            ×
          </ThemedText>
        </Pressable>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: "#000" },
  permissionWrap: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  closeBtn: { position: "absolute", right: 16, zIndex: 2, padding: 4 },
  titleWrap: { position: "absolute", left: 0, right: 0, alignItems: "center", zIndex: 2 },
  // Plain viewfinder frame — no corner-bracket art, just a bordered box
  // suggesting where to hold the label. Sized to roughly match a scannable
  // QR at arm's length rather than the whole preview.
  frame: {
    position: "absolute",
    top: "28%",
    left: "15%",
    right: "15%",
    bottom: "38%",
    borderWidth: 2,
    borderColor: "#fff",
    borderRadius: 16,
  },
});

// Recovers a packet code from a scanned URL shaped like
// `${API_ORIGIN}/app#packet/<code>` (see loanPrint.ts's printPacketLabel).
// Returns null for anything else (a loan-only label's `#loan/...`, a
// non-Ambika QR code, a bare code someone printed by hand, etc.) so callers
// can show "not a packet label" rather than silently mis-navigating.
export function parsePacketCode(scanned: string): string | null {
  const m = scanned.match(/#packet\/([^/?#]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}
