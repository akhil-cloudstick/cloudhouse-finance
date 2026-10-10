import { apiUploadEnveloped, fetchWithSession } from "@/common/services/httpClient";

/* An uploaded file (bill, photo) for an in-page preview. A plain <img src="/uploads/…">
 * relies on a cookie shared across browser tabs, which another business's login in a
 * second tab silently replaces — so the file is fetched with this tab's own session. */
export function fetchUploadFile(url: string): Promise<Response> {
  return fetchWithSession(url);
}

/* Uploads one file (photo, identity proof, receipt/bill) to the shared upload
 * endpoint (backend/internal/upload) and returns the stored /uploads/... URL. */
export async function uploadFile(file: File): Promise<string> {
  const formData = new FormData();
  formData.append("file", file);
  const res = await apiUploadEnveloped<{ url: string }>("/uploads", formData);
  return res.url;
}
