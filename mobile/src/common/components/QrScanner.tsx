import React, { useCallback, useState } from "react";
import { Linking, Modal, View, Pressable, StyleSheet } from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ThemedText } from "@/common/components/ui/ThemedText";
import { CameraPermissionCard, useRecheckOnReturn } from "@/common/components/ui/CameraPermission";
import { colors } from "@/common/theme/colors";

type QrScannerProps = {
  /** In embedded mode: whether scanning is live — flipping it back to true
   * re-arms the single-fire lock for the next scan. */
  visible: boolean;
  onClose: () => void;
  /** Called once per open with the decoded QR string (raw, unparsed) — the
   * caller owns interpreting it (see parseLabel below) and closing the
   * scanner once it's done with the result. */
  onScanned: (data: string) => void;
  title?: string;
  /** Render just the camera + frame, without its own full-screen Modal,
   * title or close button — for a screen that IS the scanner (the connect
   * screen, app/(auth)/connect.tsx) and draws its own controls on top. */
  embedded?: boolean;
  permissionText?: string;
};

// Full-screen QR scanner sheet — used by Packets/Lockers' "Scan Label"
// buttons to read the QR printed on a packet label (see
// src/modules/loans/utils/loanPrint.ts's printPacketLabel, which encodes
// `${API_ORIGIN}/app#packet/<code>` or `#loan/<loanNumber>`). Deliberately a
// plain React Native `Modal` rather than BottomSheetModal — this needs the
// full screen for the camera preview, not a sheet rising partway up.
export function QrScanner({
  visible,
  onClose,
  onScanned,
  title = "Scan Label",
  embedded = false,
  permissionText = "Camera access is needed to scan packet labels.",
}: QrScannerProps) {
  const [permission, requestPermission, getPermission] = useCameraPermissions();
  const insets = useSafeAreaInsets();
  // Back from Settings (camera was blocked): pick up the new answer without reopening the scanner.
  const recheck = useCallback(() => {
    getPermission();
  }, [getPermission]);
  useRecheckOnReturn(!!permission && !permission.granted, recheck);
  // A CameraView keeps firing onBarcodeScanned for every frame that still
  // contains the code — without this lock, a single scan re-fires dozens of
  // times before the caller has a chance to close the sheet or navigate
  // away, potentially re-triggering navigation/lookups repeatedly.
  const [locked, setLocked] = useState(false);

  // Re-armed when the scanner opens again — during render, not in an effect.
  const [wasVisible, setWasVisible] = useState(visible);
  if (visible !== wasVisible) {
    setWasVisible(visible);
    if (visible) setLocked(false);
  }

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
  ) : permission ? (
    // Our own card instead of going straight to Android's dialog (see CameraPermission.tsx).
    <View style={styles.permissionWrap}>
      <CameraPermissionCard
        reason={permissionText}
        blocked={permission.canAskAgain === false}
        onAllow={permission.canAskAgain === false ? () => Linking.openSettings() : requestPermission}
        onCancel={embedded ? undefined : onClose}
      />
    </View>
  ) : null;

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

// Recovers what a scanned label points at. Both printers (loanPrint.ts's
// printPacketLabel and the web LoanDetail) encode a link to the packet
// when the loan already has a packet, but fall back to the loan by number
// when it doesn't — so a label printed before the packet was created only
// carries the loan. Some scanners hand the fragment back percent-encoded
// (`%23packet/...`), so the string is decoded before matching. Returns null
// for anything else (a QR code from another system, etc.) so callers can
// show "not a packet label" rather than silently mis-navigating.
export type ScannedLabel = { kind: "packet"; code: string } | { kind: "loan"; loanNumber: string };

export function parseLabel(scanned: string): ScannedLabel | null {
  let s = scanned.trim();
  try {
    s = decodeURIComponent(s);
  } catch {
    // Malformed escape — match against the raw string instead.
  }
  // Labels printed from the web now use path links — `<origin>[/<business>]/packet/<code>` or
  // `/loan/<loanNumber>` (frontend appRoutes.ts routeHref) — while older and mobile-printed
  // labels use the hash form `<origin>/app#packet/<code>`. Accept both: a `packet/` or `loan/`
  // segment right after a `#` or a `/`. (`packets/` and `loans/` list paths don't match.)
  const m = s.match(/(?:^|[#/])(packet|loan)\/([^/?#\s]+)/i);
  if (m) return m[1].toLowerCase() === "packet" ? { kind: "packet", code: m[2] } : { kind: "loan", loanNumber: m[2] };
  // A QR holding just the code itself.
  if (/^PKT[-_]?[A-Z0-9-]+$/i.test(s)) return { kind: "packet", code: s };
  if (/^LN[-_]?[A-Z0-9-]+$/i.test(s)) return { kind: "loan", loanNumber: s };
  return null;
}
