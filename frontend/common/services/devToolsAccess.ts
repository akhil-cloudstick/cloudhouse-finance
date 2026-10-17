// Checks a PIN against the backend before DevTools is allowed to open — see
// PinModal.tsx. Bare fetch, not apiFetch: runs before any staff session exists.
import { apiRawFetch } from "@/common/services/httpClient";

export async function unlockDevTools(pin: string): Promise<boolean> {
  try {
    const res = await apiRawFetch("/public/devtools/unlock", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pin }),
    });
    if (!res.ok) return false;
    const body = (await res.json()) as { success?: boolean };
    return body?.success === true;
  } catch {
    return false;
  }
}
