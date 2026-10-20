import { ApiError, apiUploadEnveloped, fetchWithSession } from "@/common/services/httpClient";
import { keepPhoto } from "@/common/offline/photos";
import { offlineReady } from "@/common/offline/state";

/* An uploaded file (bill, photo) for an in-page preview. A plain <img src="/uploads/…">
 * relies on a cookie shared across browser tabs, which another business's login in a
 * second tab silently replaces — so the file is fetched with this tab's own session. */
export function fetchUploadFile(url: string): Promise<Response> {
  return fetchWithSession(url);
}

/* Uploads one file (photo, identity proof, receipt/bill) to the shared upload
 * endpoint (backend/internal/upload) and returns the stored /uploads/... URL. */
export async function uploadFile(file: File): Promise<string> {
  try {
    return await uploadFileOnline(file);
  } catch (e) {
    // Desktop with no answer from the server: keep the file on this PC and carry a placeholder in its place;
    // the sender uploads it when the entry it belongs to is sent.
    if (offlineReady() && e instanceof ApiError && e.status === 0) return keepPhoto(file);
    throw e;
  }
}

/* The upload itself, with no offline fallback. */
export async function uploadFileOnline(file: File): Promise<string> {
  const formData = new FormData();
  formData.append("file", file);
  const res = await apiUploadEnveloped<{ url: string }>("/uploads", formData);
  return res.url;
}
