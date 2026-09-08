import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import * as Print from "expo-print";
import { API_BASE_URL } from "../api/config";
import { getToken } from "../auth/tokenStorage";

function mimeTypeFor(format: "pdf" | "xlsx"): string {
  return format === "pdf" ? "application/pdf" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
}

// Downloads GET /schemes/:id/statement?...&format=pdf|xlsx (see
// backend/internal/loan/statement.go) into the cache dir — the shared first
// step both fetchSchemeStatement's callers (download-to-share and preview)
// build on, rather than re-fetching per action.
async function downloadToCache(
  schemeId: number,
  format: "pdf" | "xlsx",
  filters: { from?: string; to?: string; loanIds?: number[] }
): Promise<string> {
  const params = new URLSearchParams({ format });
  if (filters.from) params.set("from", filters.from);
  if (filters.to) params.set("to", filters.to);
  if (filters.loanIds?.length) params.set("loanIds", filters.loanIds.join(","));

  const token = await getToken();
  const filename = `scheme-${schemeId}-statement-${Date.now()}.${format}`;
  const targetUri = `${FileSystem.cacheDirectory}${filename}`;
  const result = await FileSystem.downloadAsync(
    `${API_BASE_URL}/schemes/${schemeId}/statement?${params.toString()}`,
    targetUri,
    { headers: token ? { Authorization: `Bearer ${token}` } : {} }
  );
  if (result.status < 200 || result.status >= 300) {
    throw new Error(`Could not download statement (${result.status})`);
  }
  return result.uri;
}

// Downloads the statement and raises the native share sheet — same
// download-to-cache-file + Sharing.shareAsync pattern as reports.tsx's
// exportSection, reused here instead of re-implementing PDF/xlsx generation
// on-device: the backend already builds the file from the same loan+payment
// data the web Download Statement modal renders. This is genuinely "share",
// not "save" — see previewSchemeStatementPdf below for viewing without
// picking a share target first.
export async function downloadSchemeStatement(
  schemeId: number,
  format: "pdf" | "xlsx",
  filters: { from?: string; to?: string; loanIds?: number[] }
): Promise<void> {
  const uri = await downloadToCache(schemeId, format, filters);
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(uri, { mimeType: mimeTypeFor(format), dialogTitle: "Scheme statement" });
  } else {
    throw new Error(`Saved to ${uri} — sharing isn't available on this device.`);
  }
}

// Opens the statement's PDF in the OS's native print-preview dialog — the
// actual document renders full-page, scrollable, with no share target to
// pick first, and "Print"/"Save as PDF" are just what that native dialog
// already offers. Uses expo-print (already a dependency here — reports.tsx
// prints its own HTML through the exact same Print.printAsync) rather than
// adding a PDF-viewer dependency: passing it an existing file's `uri`
// (instead of `html`) opens straight to that document. PDF only — there is
// no equivalent "preview" concept for the xlsx export.
export async function previewSchemeStatementPdf(
  schemeId: number,
  filters: { from?: string; to?: string; loanIds?: number[] }
): Promise<void> {
  const uri = await downloadToCache(schemeId, "pdf", filters);
  await Print.printAsync({ uri });
}
