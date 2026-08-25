import { API_BASE_URL } from "./config";
import { getToken } from "../auth/tokenStorage";

// GET /customer/loans/:id/statement returns a raw PDF, not JSON, so it
// can't go through apiRequest's JSON-only wrapper — same non-JSON
// convention as payments.ts's getReceiptDownloadInfo. Callers download this
// URL directly via expo-file-system, then hand the file to expo-print /
// expo-sharing.
export async function getStatementDownloadInfo(loanId: number): Promise<{ url: string; headers: Record<string, string> }> {
  const token = await getToken();
  const headers: Record<string, string> = { "ngrok-skip-browser-warning": "true" };
  if (token) headers.Authorization = `Bearer ${token}`;
  return { url: `${API_BASE_URL}/loans/${loanId}/statement`, headers };
}
