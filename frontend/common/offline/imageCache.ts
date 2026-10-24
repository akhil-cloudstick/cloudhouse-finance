/* Pictures while the server does not answer. The logo and every photo (customer, ornament, KYC, bills) are files the
 * server hands out, so offline they would be broken images. Each picture that loads is kept on this PC, in the same
 * database as everything else, keyed by its address; when the server cannot be reached the kept copy is shown instead.
 *
 *  - fetchUploadFile (uploadService.ts) keeps what it fetches and falls back to the kept copy;
 *  - installImageGuard handles plain <img> tags (the logo, avatars): when one fails to load it is pointed at the kept
 *    copy, and every <img> that does load is kept for next time;
 *  - warmImages keeps the pictures the local copy points at ahead of time, the same as the warm-up does for lists. */

import { isDesktop, offlineStore } from "@/common/services/desktopBridge";
import { isPlaceholder, localPhotoSrc } from "./photos";
import { hashOf } from "./readCache";

const MAX_BYTES = 4 * 1024 * 1024;
const PREFIX = "data/img_";

const kept = new Set<string>(); // addresses known to be in the store this session
let installed = false;

function fileOf(url: string): string {
  return `${PREFIX}${hashOf(url)}.json`;
}

function toDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

export async function rememberImage(url: string, blob: Blob): Promise<void> {
  if (!isDesktop() || kept.has(url) || blob.size === 0 || blob.size > MAX_BYTES || !blob.type.startsWith("image/")) return;
  try {
    await offlineStore.writeFile(fileOf(url), JSON.stringify({ u: url, d: await toDataUrl(blob) }));
    kept.add(url);
  } catch {
    /* the store is not open yet, or full: the picture is simply not kept */
  }
}

/* The kept copy as a data: address, or null. */
export async function recallImage(url: string): Promise<string | null> {
  if (!isDesktop()) return null;
  // a photo picked on this PC that has not been sent yet: the file waiting in the outbox's photo folder
  if (isPlaceholder(url)) return localPhotoSrc(url);
  try {
    const text = await offlineStore.readFile(fileOf(url));
    if (!text) return null;
    const rec = JSON.parse(text) as { u?: string; d?: string };
    if (rec.u !== url || typeof rec.d !== "string") return null;
    kept.add(url);
    return rec.d;
  } catch {
    return null;
  }
}

/* Keeps a picture the page has already loaded, fetching it again for its bytes (a loaded <img> cannot be read back). */
async function keepLoaded(url: string): Promise<void> {
  if (kept.has(url)) return;
  try {
    const res = url.startsWith("/uploads/")
      ? await (await import("@/common/services/uploadService")).fetchUploadFile(url) // keeps it itself
      : await fetch(url);
    if (!res.ok) return;
    if (!url.startsWith("/uploads/")) await rememberImage(url, await res.blob());
  } catch {
    /* offline, or not allowed: nothing to keep */
  }
}

/* Plain <img> tags. The capture-phase listener runs before the page's own onError, so a picture that is kept is
 * swapped in before the page decides it is broken; one that is not kept is let through to the page as before. */
export function installImageGuard(): void {
  if (installed || typeof document === "undefined" || !isDesktop()) return;
  installed = true;

  // pictures already on screen before this ran (the logo loads at sign-in) have had their load event already
  const keepShown = () => {
    for (const img of Array.from(document.images)) {
      const src = img.getAttribute("src") ?? "";
      if (img.complete && img.naturalWidth > 0 && src && !src.startsWith("data:") && !src.startsWith("blob:") && !kept.has(src)) void keepLoaded(src);
    }
  };
  keepShown();
  window.setTimeout(keepShown, 4000);

  document.addEventListener(
    "error",
    (e) => {
      const img = e.target;
      if (!(img instanceof HTMLImageElement)) return;
      const src = img.getAttribute("src") ?? "";
      if (!src || src.startsWith("data:") || src.startsWith("blob:") || img.dataset.offlineTried) return;
      img.dataset.offlineTried = "1";
      e.stopImmediatePropagation(); // hold the page's onError until we know whether a kept copy exists
      void recallImage(src).then((data) => {
        if (data) img.src = data;
        else img.dispatchEvent(new Event("error")); // nothing kept: the page handles it as it always did
      });
    },
    true,
  );

  document.addEventListener(
    "load",
    (e) => {
      const img = e.target;
      if (!(img instanceof HTMLImageElement)) return;
      const src = img.getAttribute("src") ?? "";
      if (!src || src.startsWith("data:") || src.startsWith("blob:") || kept.has(src)) return;
      if (/^https?:\/\//.test(src) || src.startsWith("/uploads/") || src.startsWith("/api/")) void keepLoaded(src);
    },
    true,
  );
}

/* Every picture address inside a piece of data: strings that point at /uploads or at a logo/branding file. */
export function pictureUrlsIn(value: unknown, out: Set<string>, limit: number): void {
  if (out.size >= limit) return;
  if (typeof value === "string") {
    if (value.startsWith("/uploads/") || /^(\/api\/v1)?\/public\/branding\//.test(value) || /^https?:\/\/[^\s]*(\/uploads\/|\/branding\/)[^\s]*$/.test(value)) out.add(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const v of value) pictureUrlsIn(v, out, limit);
  } else if (value && typeof value === "object") {
    for (const v of Object.values(value as Record<string, unknown>)) pictureUrlsIn(v, out, limit);
  }
}

/* Keeps the pictures in the given data ahead of time. Skips what is already kept. */
export async function warmImages(sources: unknown[], limit = 200): Promise<void> {
  const urls = new Set<string>();
  for (const s of sources) pictureUrlsIn(s, urls, limit);
  for (const url of urls) {
    if (kept.has(url) || (await recallImage(url))) continue;
    await keepLoaded(url);
  }
}
