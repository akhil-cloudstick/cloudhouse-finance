import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import { API_BASE_URL, apiUrl, ApiError } from "@/common/services/httpClient";
import { getToken } from "@/common/services/tokenStorage";

export type StatementFilters = { from?: string; to?: string; loanIds?: number[] };

function mimeTypeFor(format: "pdf" | "xlsx"): string {
  return format === "pdf" ? "application/pdf" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
}

// Downloads GET /schemes/:id/statement?...&format=pdf|xlsx (see
// backend/internal/loan/statement.go) into the cache dir — the shared first
// step of downloadSchemeStatement.
async function downloadToCache(
  schemeId: number,
  format: "pdf" | "xlsx",
  filters: StatementFilters
): Promise<string> {
  const params = new URLSearchParams({ format });
  if (filters.from) params.set("from", filters.from);
  if (filters.to) params.set("to", filters.to);
  if (filters.loanIds?.length) params.set("loanIds", filters.loanIds.join(","));

  const token = await getToken();
  const filename = `scheme-${schemeId}-statement-${Date.now()}.${format}`;
  const targetUri = `${FileSystem.cacheDirectory}${filename}`;
  const result = await FileSystem.downloadAsync(
    apiUrl(`/schemes/${schemeId}/statement?${params.toString()}`),
    targetUri,
    { headers: token ? { Authorization: `Bearer ${token}` } : {} }
  );
  if (result.status < 200 || result.status >= 300) {
    throw new ApiError(result.status, "", undefined);
  }
  return result.uri;
}

// Downloads the statement and raises the native share sheet — same
// download-to-cache-file + Sharing.shareAsync pattern as reports.tsx's
// exportSection, reused here instead of re-implementing PDF/xlsx generation
// on-device: the backend already builds the file from the same loan+payment
// data the web Download Statement modal renders. This is genuinely "share",
// not "save".
export async function downloadSchemeStatement(
  schemeId: number,
  format: "pdf" | "xlsx",
  filters: StatementFilters
): Promise<void> {
  const uri = await downloadToCache(schemeId, format, filters);
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(uri, { mimeType: mimeTypeFor(format), dialogTitle: "Scheme statement" });
  } else {
    throw new Error(`Saved to ${uri} — sharing isn't available on this device.`);
  }
}
