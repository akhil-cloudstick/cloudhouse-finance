import * as FileSystem from "expo-file-system/legacy";
import { API_BASE_URL } from "./config";
import { getToken } from "../auth/tokenStorage";
import { ApiError } from "./client";

// Mirrors frontend/lib/customersApi.ts's uploadFile against the same
// backend/internal/upload endpoint: multipart POST /uploads with one "file"
// field, responding {"url": "/uploads/<id>-<name>"}.
export type PickedFile = {
  uri: string;
  name: string;
  mimeType?: string;
};

export async function uploadFile(file: PickedFile): Promise<string> {
  const headers: Record<string, string> = { "ngrok-skip-browser-warning": "true" };
  const token = await getToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  // Copy the picked URI into the root of FileSystem.cacheDirectory before uploading.
  // On Android/Expo Go, URIs in picker subdirectories (e.g. cache/DocumentPicker/...)
  // can trigger `java.io.IOException: Location ... isn't readable` in
  // ExponentFileSystem.uploadAsync if passed directly.
  const sanitizedName = (file.name || "upload.tmp").replace(/[^a-zA-Z0-9_.-]/g, "_");
  const tempTargetUri = `${FileSystem.cacheDirectory}upload_${Date.now()}_${sanitizedName}`;

  let targetUri = file.uri;
  let copied = false;

  try {
    await FileSystem.copyAsync({ from: file.uri, to: tempTargetUri });
    targetUri = tempTargetUri;
    copied = true;
  } catch (err) {
    console.warn("copyAsync fallback to original uri:", err);
  }

  try {
    const result = await FileSystem.uploadAsync(`${API_BASE_URL}/uploads`, targetUri, {
      httpMethod: "POST",
      headers,
      uploadType: FileSystem.FileSystemUploadType.MULTIPART,
      fieldName: "file",
      mimeType: file.mimeType || "application/octet-stream",
    });

    const data = result.body ? JSON.parse(result.body) : undefined;

    if (result.status < 200 || result.status >= 300) {
      throw new ApiError(result.status, (data && (data.error || data.message)) || `Upload failed (${result.status})`, data);
    }
    return (data as { url: string }).url;
  } finally {
    if (copied) {
      try {
        await FileSystem.deleteAsync(tempTargetUri, { idempotent: true });
      } catch (_) {}
    }
  }
}
