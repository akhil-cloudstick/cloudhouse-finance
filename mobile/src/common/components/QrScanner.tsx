import React, { useEffect, useState } from "react";
import { Modal, View, Pressable, StyleSheet } from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ThemedText } from "@/common/components/ui/ThemedText";
import { GoldButton } from "@/common/components/ui/GoldButton";
import { colors } from "@/common/theme/colors";

type QrScannerProps = {
  // In embedded mode: toggling visible back to true re-arms the single-fire lock for the next scan.
  visible: boolean;
  onClose: () => void;
  // Called once per open with the raw decoded QR string; caller owns interpreting it (see parseLabel below).
  onScanned: (data: string) => void;
  title?: string;
  // Render just camera + frame, no Modal/title/close — for a screen that IS the scanner and draws its own controls.
  embedded?: boolean;
  permissionText?: string;
};

// Plain React Native Modal rather than BottomSheetModal — needs the full screen for the camera preview.
export function QrScanner({
  visible,
  onClose,
  onScanned,
  title = "Scan Label",
  embedded = false,
  permissionText = "Camera access is needed to scan packet labels.",
}: QrScannerProps) {
  const [permission, requestPermission] = useCameraPermissions();
  const insets = useSafeAreaInsets();
  // Without this lock, CameraView refires onBarcodeScanned dozens of times before the caller can navigate away.
  const [locked, setLocked] = useState(false);

  useEffect(() => {
    if (visible) setLocked(false);
  }, [visible]);

  function handleScanned({ data }: { data: string }) {
    if (locked) return;
    setLocked(true);
    onScanned(data);
  }

  const camera = permission?.granted ? (
    <>
      <CameraView
        style={StyleSheet.absoluteFill}
        facing="back"
        barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
        onBarcodeScanned={locked || !visible ? undefined : handleScanned}
      />
      <View style={styles.frame} pointerEvents="none" />
    </>
  ) : (
    <View style={styles.permissionWrap}>
      <ThemedText variant="body" color={colors.card} style={{ textAlign: "center", marginBottom: 16 }}>
        {permission?.canAskAgain === false ? "Camera access was denied. Enable it in Settings to scan." : permissionText}
      </ThemedText>
      {permission?.canAskAgain !== false ? <GoldButton title="Allow Camera" onPress={requestPermission} /> : null}
    </View>
  );

  if (embedded) return <View style={styles.wrap}>{camera}</View>;

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={styles.wrap}>
        {camera}

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
  // Sized to roughly match a scannable QR at arm's length rather than the whole preview.
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

// Labels encode #packet/<code>, falling back to #loan/<loanNumber> if printed before the packet existed.
export type ScannedLabel = { kind: "packet"; code: string } | { kind: "loan"; loanNumber: string };

export function parseLabel(scanned: string): ScannedLabel | null {
  let s = scanned.trim();
  try {
    s = decodeURIComponent(s);
  } catch {
    // Malformed escape — match against the raw string instead.
  }
  const m = s.match(/#(packet|loan)\/([^/?#\s]+)/i);
  if (!m) return null;
  return m[1].toLowerCase() === "packet" ? { kind: "packet", code: m[2] } : { kind: "loan", loanNumber: m[2] };
}
