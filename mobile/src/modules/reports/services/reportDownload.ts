import * as FileSystem from "expo-file-system/legacy";
import { getToken } from "@/common/services/tokenStorage";
import { reportExportUrl } from "@/modules/reports/services/reportsService";

// Downloads a report export (xlsx / pdf) into the cache and returns the file's uri, ready to share or print.
export async function downloadExport(key: string, format: "xlsx" | "pdf", range: { from?: string; to?: string; q?: string; branchId?: string; extra?: Record<string, string> }) {
  const token = await getToken();
  const targetUri = `${FileSystem.cacheDirectory}${key}-${Date.now()}.${format}`;
  const qs = new URLSearchParams({ format });
  if (range.from) qs.set("from", range.from);
  if (range.to) qs.set("to", range.to);
  if (range.q) qs.set("q", range.q);
  if (range.branchId) qs.set("branch_id", range.branchId);
  for (const [k, v] of Object.entries(range.extra ?? {})) if (v) qs.set(k, v);
  const result = await FileSystem.downloadAsync(reportExportUrl(key, qs), targetUri, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (result.status < 200 || result.status >= 300) throw new Error(`${format === "pdf" ? "Print" : "Export"} failed (${result.status})`);
  return result.uri;
}
