import * as FileSystem from "expo-file-system/legacy";
import { safeDownload } from "@/common/utils/safeDownload";
import { presentFile, previewPdf } from "@/common/utils/presentFile";
import { API_BASE_URL, apiUrl, ApiError } from "@/common/services/httpClient";
import { getToken } from "@/common/services/tokenStorage";
import { withPrintProgress } from "@/common/components/ui/PrintProgressHost";

async function downloadToCache(investmentId: number, investmentNumber: string, path = "bond/pdf", stem = "debenture-subscription-agreement"): Promise<string> {
  const token = await getToken();
  const filename = `${stem}-${investmentNumber}.pdf`;
  const targetUri = `${FileSystem.cacheDirectory}${filename}`;
  const result = await safeDownload(
    apiUrl(`/investments/${investmentId}/${path}`),
    targetUri,
    { headers: token ? { Authorization: `Bearer ${token}` } : {} }
  );
  if (result.status < 200 || result.status >= 300) {
    throw new ApiError(result.status, "", undefined);
  }
  return result.uri;
}

export async function downloadInvestmentBondPdf(investmentId: number, investmentNumber: string): Promise<void> {
  const uri = await downloadToCache(investmentId, investmentNumber);
  await presentFile(uri, { mimeType: "application/pdf", title: "Debenture Subscription Agreement" });
}

export async function previewInvestmentBondPdf(investmentId: number, investmentNumber: string): Promise<void> {
  const uri = await withPrintProgress(() => downloadToCache(investmentId, investmentNumber));
  await previewPdf(uri);
}

export async function previewInvestmentStatementPdf(investmentId: number, investmentNumber: string): Promise<void> {
  const uri = await withPrintProgress(() => downloadToCache(investmentId, investmentNumber, "statement/pdf", "investment-statement"));
  await previewPdf(uri);
}
