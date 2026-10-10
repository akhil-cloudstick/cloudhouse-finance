

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
