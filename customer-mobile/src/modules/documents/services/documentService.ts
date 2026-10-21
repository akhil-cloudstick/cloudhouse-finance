import { apiUrl } from "@/common/services/httpClient";
import { getToken } from "@/common/services/tokenStorage";

// Returns a raw PDF, not JSON, so it can't go through apiRequest's JSON-only wrapper.
export async function getStatementDownloadInfo(loanId: number): Promise<{ url: string; headers: Record<string, string> }> {
  const token = await getToken();
  const headers: Record<string, string> = { "ngrok-skip-browser-warning": "true" };
  if (token) headers.Authorization = `Bearer ${token}`;
  return { url: apiUrl(`/loans/${loanId}/statement`), headers };
}
