import { Platform } from "react-native";
import * as FileSystem from "expo-file-system/legacy";
import * as IntentLauncher from "expo-intent-launcher";
import * as Sharing from "expo-sharing";
import { askFileAction } from "@/common/components/ui/FilePrompt";
import { toast } from "@/common/components/ui/ToastHost";

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
  if (!(await Sharing.isAvailableAsync())) throw new Error("Sharing isn't available on this device.");
  await Sharing.shareAsync(uri, { mimeType: opts.mimeType, dialogTitle: opts.title, UTI: opts.UTI });
}

export async function previewPdf(uri: string) {
  if (Platform.OS === "android") {
    try {
      // Opens the file straight in the phone's own PDF viewer — no share sheet.
      const contentUri = await FileSystem.getContentUriAsync(uri);
      await IntentLauncher.startActivityAsync("android.intent.action.VIEW", {
        data: contentUri,
        flags: 1, // FLAG_GRANT_READ_URI_PERMISSION
        type: "application/pdf",
      });
      return;
    } catch {
      // No PDF viewer installed (or the launch was refused): fall through to the share sheet.
    }
  }
  await shareNow(uri, { mimeType: "application/pdf", UTI: "com.adobe.pdf", title: "Open with" });
}

export function presentFile(uri: string, opts: PresentOptions = {}): Promise<void> {
  const isPdf = !opts.mimeType || opts.mimeType === "application/pdf";
  if (!isPdf) return shareNow(uri, opts);
  // The app's own prompt (FilePrompt.tsx), not the system Alert.
  return askFileAction(opts.title ?? "Document ready").then((choice) => {
    if (choice === "open") previewPdf(uri).catch((e) => toast.error("Cannot open", "Install a PDF viewer app, or use Share to send it elsewhere."));
    else if (choice === "share") shareNow(uri, { ...opts, mimeType: "application/pdf", UTI: opts.UTI ?? "com.adobe.pdf" }).catch(() => {});
  });
}
