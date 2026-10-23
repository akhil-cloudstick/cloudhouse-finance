import { ApiError, apiUploadEnveloped, fetchWithSession } from "@/common/services/httpClient";
import { keepPhoto } from "@/common/offline/photos";
import { offlineReady } from "@/common/offline/state";
import { recallImage, rememberImage } from "@/common/offline/imageCache";

/* An uploaded file (bill, photo) for an in-page preview. A plain <img src="/uploads/…">
 * relies on a cookie shared across browser tabs, which another business's login in a
 * second tab silently replaces — so the file is fetched with this tab's own session. */
export async function fetchUploadFile(url: string): Promise<Response> {
  try {
    const res = await fetchWithSession(url);
    // a picture that loads is kept on this PC, so it can be shown when the server does not answer
    if (res.ok) void res.clone().blob().then((b) => rememberImage(url, b));
    return res;
  } catch (e) {
    if (e instanceof ApiError && e.status === 0) {
      const kept = await recallImage(url);
      if (kept) return fetch(kept);
    }
    throw e;
  }
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
