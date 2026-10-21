import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import { API_BASE_URL, apiUrl, ApiError } from "@/common/services/httpClient";
import { getToken } from "@/common/services/tokenStorage";

export type StatementFilters = { from?: string; to?: string; loanIds?: number[] };

function mimeTypeFor(format: "pdf" | "xlsx"): string {
  return format === "pdf" ? "application/pdf" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
}

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
