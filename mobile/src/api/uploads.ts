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

  // XMLHttpRequest+FormData, deliberately NOT fetch(). The global fetch in
  // this app is expo/fetch (installed by expo's winter runtime), and its
  // FormData encoder only understands strings and Blobs — React Native's
  // {uri, name, type} file part makes it throw "Unsupported FormDataPart
  // implementation" on the device before any request is sent, so camera and
  // gallery photos never reached the backend at all. XHR is still React
  // Native's own: its networking bridge resolves file:// and content:// URIs
  // (camera, gallery and document-picker sources) through Android's
  // ContentResolver and streams the bytes itself.
  //
  // expo-file-system's uploadAsync stays avoided: on Android it throws
  // "java.io.IOException: Location ... isn't readable" for a
  // `file:///.../DocumentPicker/<uuid>.jpg` it didn't create, even straight
  // out of the picker.
  const form = new FormData();
  // React Native's FormData accepts this shape (uri/name/type) even though
  // it doesn't match the DOM Blob type FormData.append expects on paper.
  form.append("file", { uri: file.uri, name: file.name || "upload.tmp", type: file.mimeType || "application/octet-stream" } as unknown as Blob);

  return new Promise<string>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${API_BASE_URL}/uploads`);
    // No Content-Type here — XHR sets multipart/form-data with the right
    // boundary itself from the FormData body; setting it manually drops the
    // boundary and the backend can't parse the multipart request at all.
    for (const [k, v] of Object.entries(headers)) xhr.setRequestHeader(k, v);
    xhr.onload = () => {
      let data: any;
      try {
        data = JSON.parse(xhr.responseText);
      } catch {
        data = undefined;
      }
      if (xhr.status < 200 || xhr.status >= 300 || data?.success === false) {
        reject(new ApiError(xhr.status, (data && (data.error || data.message)) || `Upload failed (${xhr.status})`, data));
        return;
      }
      resolve((data as { success: boolean; data: { url: string } }).data.url);
    };
    xhr.onerror = () => reject(new ApiError(0, "Couldn't reach the server — check your connection and try again.", undefined));
    xhr.ontimeout = xhr.onerror;
    xhr.send(form);
  });
}
