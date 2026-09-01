import { API_BASE_URL } from "./config";
import { getToken } from "../auth/tokenStorage";
import { ApiError } from "./client";

// Mirrors frontend/lib/customersApi.ts's uploadFile against the same
// backend/internal/upload endpoint: multipart POST /uploads with one "file"
// field, responding {"success": true, "data": {"url": "/uploads/<id>-<name>"}}
// (backend/internal/platform/httpx envelope) on success, or
// {"success": false, "error": "..."} on failure.
export type PickedFile = {
  uri: string;
  name: string;
  mimeType?: string;
};

export async function uploadFile(file: PickedFile): Promise<string> {
  const headers: Record<string, string> = { "ngrok-skip-browser-warning": "true" };
  const token = await getToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  // fetch()+FormData, not expo-file-system's uploadAsync: uploadAsync reads
  // the file itself through the native ExponentFileSystem module, which on
  // Android chokes on URIs it didn't create — a `file:///.../DocumentPicker/
  // <uuid>.jpg` from expo-document-picker (used for the PDF-or-file source,
  // see DocumentField.tsx's fromFiles) throws "java.io.IOException:
  // Location ... isn't readable" even straight out of the picker, and a
  // pre-copy into our own cache dir hit the exact same error, so that
  // workaround is gone too. fetch's FormData instead hands the URI to RN's
  // own networking bridge, which resolves file:// and content:// URIs (the
  // camera/gallery pickers' own scheme) through Android's ContentResolver —
  // the same path used for outgoing HTTP file uploads. Confirmed working
  // for camera, gallery, and document-picker sources; expo-file-system is no
  // longer imported here.
  const form = new FormData();
  // React Native's FormData accepts this shape (uri/name/type) even though
  // it doesn't match the DOM Blob type FormData.append expects on paper.
  form.append("file", { uri: file.uri, name: file.name || "upload.tmp", type: file.mimeType || "application/octet-stream" } as unknown as Blob);

  const res = await fetch(`${API_BASE_URL}/uploads`, {
    method: "POST",
    // No Content-Type here — fetch sets multipart/form-data with the right
    // boundary itself from the FormData body; setting it manually drops the
    // boundary and the backend can't parse the multipart request at all.
    headers,
    body: form,
  });

  const data = await res.json().catch(() => undefined);
  if (!res.ok || data?.success === false) {
    throw new ApiError(res.status, (data && (data.error || data.message)) || `Upload failed (${res.status})`, data);
  }
  return (data as { success: boolean; data: { url: string } }).data.url;
}
