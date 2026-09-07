import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import { API_BASE_URL } from "../api/config";
import { getToken } from "../auth/tokenStorage";

// Downloads GET /schemes/:id/statement?...&format=pdf|xlsx (see
// backend/internal/loan/statement.go) and raises the native share sheet —
// same download-to-cache-file + Sharing.shareAsync pattern as reports.tsx's
// exportSection, reused here instead of re-implementing PDF/xlsx generation
// on-device: the backend already builds the file from the same loan+payment
// data the web Download Statement modal renders.
export async function downloadSchemeStatement(
  schemeId: number,
  format: "pdf" | "xlsx",
  filters: { from?: string; to?: string; loanIds?: number[] }
): Promise<void> {
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

  const mimeType = format === "pdf" ? "application/pdf" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(result.uri, { mimeType, dialogTitle: "Scheme statement" });
  } else {
    throw new Error(`Saved to ${result.uri} — sharing isn't available on this device.`);
  }
}
