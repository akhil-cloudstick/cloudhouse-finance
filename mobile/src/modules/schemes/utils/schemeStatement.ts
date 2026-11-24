import * as FileSystem from "expo-file-system/legacy";
import { safeDownload } from "@/common/utils/safeDownload";
import { presentFile } from "@/common/utils/presentFile";
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
  const result = await safeDownload(
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
  await presentFile(uri, { mimeType: mimeTypeFor(format), title: "Scheme statement" });
}
