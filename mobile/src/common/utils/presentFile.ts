import { Alert } from "react-native";
import * as Print from "expo-print";
import * as Sharing from "expo-sharing";

type PresentOptions = { mimeType?: string; UTI?: string; title?: string };

/**
 * What to do with a freshly downloaded file. Previously every download went
 * straight to the native share sheet (Sharing.shareAsync), so the user never
 * saw the document. Now a PDF opens in the system preview first (expo-print's
 * printAsync({ uri }) is the viewer on iOS and the print/save preview on
 * Android — no extra native package needed), and Share is an explicit second
 * action. Non-PDF files (xlsx) have no previewer, so they keep the share sheet.
 */
export async function shareNow(uri: string, opts: PresentOptions = {}) {
  if (!(await Sharing.isAvailableAsync())) throw new Error(`Saved to ${uri} — sharing isn't available on this device.`);
  await Sharing.shareAsync(uri, { mimeType: opts.mimeType, dialogTitle: opts.title, UTI: opts.UTI });
}

export async function previewPdf(uri: string) {
  await Print.printAsync({ uri });
}

export function presentFile(uri: string, opts: PresentOptions = {}): Promise<void> {
  const isPdf = !opts.mimeType || opts.mimeType === "application/pdf";
  if (!isPdf) return shareNow(uri, opts);
  return new Promise((resolve) => {
    const share = () => { shareNow(uri, { ...opts, mimeType: "application/pdf", UTI: opts.UTI ?? "com.adobe.pdf" }).catch(() => {}); resolve(); };
    const preview = () => { previewPdf(uri).catch(() => {}); resolve(); };
    Alert.alert(opts.title ?? "Document ready", "Your PDF has been downloaded.", [
      { text: "Open", onPress: preview },
      { text: "Share / Save", onPress: share },
      { text: "Close", style: "cancel", onPress: () => resolve() },
    ], { cancelable: true, onDismiss: () => resolve() });
  });
}
