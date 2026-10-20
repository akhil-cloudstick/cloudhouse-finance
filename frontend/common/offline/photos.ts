/* Photos and documents picked while the server does not answer. The file is kept on this PC (protected, in
 * photos\<id>.json) and the form carries the placeholder local-photo:<id> wherever the uploaded URL would go.
 * When an entry is sent, its placeholders are uploaded first and swapped for the real URLs, so the server
 * receives exactly what an online save would have sent. */

import { offlineStore } from "@/common/services/desktopBridge";
import { uuid7 } from "./ids";

export const PLACEHOLDER = "local-photo:";

type StoredPhoto = { name: string; type: string; data: string; url?: string };

const MAX_BYTES = 12 * 1024 * 1024;

function fileOfId(id: string): string {
  return `photos/${id}.json`;
}

function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

function fromBase64(data: string): Uint8Array<ArrayBuffer> {
  const bin = atob(data);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/* Keeps the file on this PC and returns the placeholder to put where the URL would go. */
export async function keepPhoto(file: File): Promise<string> {
  if (file.size > MAX_BYTES) throw new Error("This file is too large to keep until the server is back. Choose one under 12 MB.");
  const id = uuid7();
  const stored: StoredPhoto = { name: file.name || "photo", type: file.type || "application/octet-stream", data: toBase64(await file.arrayBuffer()) };
  await offlineStore.writeFile(fileOfId(id), JSON.stringify(stored));
  return PLACEHOLDER + id;
}

export function isPlaceholder(v: unknown): v is string {
  return typeof v === "string" && v.startsWith(PLACEHOLDER);
}

/* Every placeholder inside a request body, however deep. */
export function placeholdersIn(value: unknown, found: Set<string> = new Set()): Set<string> {
  if (isPlaceholder(value)) found.add(value);
  else if (Array.isArray(value)) value.forEach((v) => placeholdersIn(v, found));
  else if (value && typeof value === "object") Object.values(value as Record<string, unknown>).forEach((v) => placeholdersIn(v, found));
  return found;
}

function replaceIn(value: unknown, urls: Map<string, string>): unknown {
  if (isPlaceholder(value)) return urls.get(value) ?? "";
  if (Array.isArray(value)) return value.map((v) => replaceIn(v, urls));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, replaceIn(v, urls)]));
  }
  return value;
}

/* Uploads the photos an entry points at and returns the body with real URLs, or null when an upload did not
 * go through (the entry then stays queued and is tried again). A photo that was already uploaded by an
 * earlier attempt is not uploaded twice. */
export async function withUploadedPhotos(
  body: unknown,
  upload: (file: File) => Promise<string>,
): Promise<unknown | null> {
  const wanted = placeholdersIn(body);
  if (wanted.size === 0) return body;
  const urls = new Map<string, string>();
  for (const ph of wanted) {
    const id = ph.slice(PLACEHOLDER.length);
    let stored: StoredPhoto | null = null;
    try {
      const text = await offlineStore.readFile(fileOfId(id));
      stored = text ? (JSON.parse(text) as StoredPhoto) : null;
    } catch {
      stored = null;
    }
    if (!stored) {
      // the file is gone from this PC: send the entry without it rather than block everything behind it
      urls.set(ph, "");
      offlineStore.log("warn", `photo ${id} is missing on this PC; the entry is sent without it`);
      continue;
    }
    if (!stored.url) {
      try {
        const file = new File([fromBase64(stored.data)], stored.name, { type: stored.type });
        stored.url = await upload(file);
        await offlineStore.writeFile(fileOfId(id), JSON.stringify(stored));
      } catch {
        return null;
      }
    }
    urls.set(ph, stored.url);
  }
  return replaceIn(body, urls);
}
