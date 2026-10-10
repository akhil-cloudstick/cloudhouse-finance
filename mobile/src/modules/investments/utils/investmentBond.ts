import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import * as Print from "expo-print";
import { API_BASE_URL, apiUrl, ApiError } from "@/common/services/httpClient";
import { getToken } from "@/common/services/tokenStorage";
import { withPrintProgress } from "@/common/components/ui/PrintProgressHost";

// Downloads GET /investments/:id/bond/pdf into the cache dir — same
// download-to-cache-file pattern as schemeStatement.ts's downloadToCache,
// shared by the share (downloadInvestmentBondPdf) and preview
// (previewInvestmentBondPdf) actions below.
async function downloadToCache(investmentId: number, investmentNumber: string): Promise<string> {
  const token = await getToken();
  const filename = `debenture-subscription-agreement-${investmentNumber}.pdf`;
  const targetUri = `${FileSystem.cacheDirectory}${filename}`;
  const result = await FileSystem.downloadAsync(
    apiUrl(`/investments/${investmentId}/bond/pdf`),
    targetUri,
    { headers: token ? { Authorization: `Bearer ${token}` } : {} }
  );
  if (result.status < 200 || result.status >= 300) {
    throw new ApiError(result.status, "", undefined);
  }
  return result.uri;
}

// Downloads the Debenture Subscription Agreement and raises the native
// share sheet — same pattern as schemeStatement.ts's downloadSchemeStatement.
export async function downloadInvestmentBondPdf(investmentId: number, investmentNumber: string): Promise<void> {
  const uri = await downloadToCache(investmentId, investmentNumber);
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(uri, { mimeType: "application/pdf", dialogTitle: "Debenture Subscription Agreement" });
  } else {
    throw new Error(`Saved to ${uri} — sharing isn't available on this device.`);
  }
}

// Opens the agreement in the OS's native print-preview dialog — same
// pattern as schemeStatement.ts's previewSchemeStatementPdf.
export async function previewInvestmentBondPdf(investmentId: number, investmentNumber: string): Promise<void> {
  const uri = await withPrintProgress(() => downloadToCache(investmentId, investmentNumber));
  await Print.printAsync({ uri });
}
