import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import * as Print from "expo-print";
import { API_BASE_URL, apiUrl, ApiError } from "@/common/services/httpClient";
import { getToken } from "@/common/services/tokenStorage";
import { withPrintProgress } from "@/common/components/ui/PrintProgressHost";

async function downloadToCache(investmentId: number, investmentNumber: string, path = "bond/pdf", stem = "debenture-subscription-agreement"): Promise<string> {
  const token = await getToken();
  const filename = `${stem}-${investmentNumber}.pdf`;
  const targetUri = `${FileSystem.cacheDirectory}${filename}`;
  const result = await FileSystem.downloadAsync(
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
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(uri, { mimeType: "application/pdf", dialogTitle: "Debenture Subscription Agreement" });
  } else {
    throw new Error(`Saved to ${uri} — sharing isn't available on this device.`);
  }
}

export async function previewInvestmentBondPdf(investmentId: number, investmentNumber: string): Promise<void> {
  const uri = await withPrintProgress(() => downloadToCache(investmentId, investmentNumber));
  await Print.printAsync({ uri });
}

export async function previewInvestmentStatementPdf(investmentId: number, investmentNumber: string): Promise<void> {
  const uri = await withPrintProgress(() => downloadToCache(investmentId, investmentNumber, "statement/pdf", "investment-statement"));
  await Print.printAsync({ uri });
}
