import React, { useEffect, useState } from "react";
import { ActivityIndicator, Image, View } from "react-native";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import { C, PrimaryButton, Sheet, Txt, toast } from "@/common/components/ui";
import { API_ORIGIN } from "@/common/services/httpClient";
import { getToken } from "@/common/services/tokenStorage";
import { isUserCancel, userMessage } from "@/common/services/apiErrors";

// Uploaded bills / receipts live at /uploads/<key>, which the server only
// serves to a signed-in caller (Authorization: Bearer on GET /uploads/:key) —
// so an <Image> pointing at one must carry the session token, and a link
// handed to the system browser (no header) would 401. Mobile counterpart of
// the web's BillViewModalContent.

// Absolute URLs pass through; a stored path may be "/uploads/x", "uploads/x" or just the bare file key.
export const uploadUrl = (path: string) => {
  const p = path.trim().replace(/ /g, "%20");
  if (/^https?:\/\//i.test(p)) return p;
  if (p.startsWith("/")) return `${API_ORIGIN}${p}`;
  return `${API_ORIGIN}/${p.startsWith("uploads/") ? p : `uploads/${p}`}`;
};
// The session token only goes to our own server, never to a third-party host a document URL may point at.
const isOwnUrl = (url: string) => url.startsWith(API_ORIGIN);
const isPdf = (path: string) => /\.pdf(\?|$)/i.test(path);

/** The session token as request headers (null until read) — for `Image` sources. */
export function useBearerHeaders(): Record<string, string> | null {
  const [headers, setHeaders] = useState<Record<string, string> | null>(null);
  useEffect(() => {
    let live = true;
    getToken()
      .then((t) => live && setHeaders(t ? { Authorization: `Bearer ${t}` } : {}))
      .catch(() => live && setHeaders({}));
    return () => {
      live = false;
    };
  }, []);
  return headers;
}

/** Image source for an /uploads path that sends the Bearer token. */
export function useUploadSource(path: string): { uri: string; headers?: Record<string, string> } | null {
  const headers = useBearerHeaders();
  if (!headers) return null;
  const uri = uploadUrl(path);
  return { uri, ...(headers.Authorization && isOwnUrl(uri) ? { headers } : {}) };
}

/** Download an /uploads file with the token and open the share sheet. */
async function shareUpload(path: string) {
  const token = await getToken();
  const ext = (path.match(/\.([a-z0-9]{2,5})(\?|$)/i)?.[1] ?? "bin").toLowerCase();
  const target = `${FileSystem.cacheDirectory}bill-${Date.now()}.${ext}`;
  const url = uploadUrl(path);
  const res = await FileSystem.downloadAsync(url, target, { headers: token && isOwnUrl(url) ? { Authorization: `Bearer ${token}` } : {} });
  if (res.status < 200 || res.status >= 300) throw new Error("The bill could not be loaded.");
  if (!(await Sharing.isAvailableAsync())) throw new Error("Sharing isn't available on this device.");
  await Sharing.shareAsync(res.uri, { dialogTitle: "Bill" });
}

type BillSheetProps = { path: string | null; onClose: () => void; /** What is being viewed (e.g. "Identity proof"); shown as the sheet title. */ title?: string };

/** A bill image in a sheet, authenticated, with a clear fallback if it won't
 * load (and Share/Open for PDFs, which an Image can't draw). */
export function BillSheet({ path, onClose, title = "Bill" }: BillSheetProps) {
  const [localUri, setLocalUri] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  // Bumped by Retry so the <Image> remounts and fetches again.
  const [attempt, setAttempt] = useState(0);
  const pdf = !!path && isPdf(path);
  // The file is downloaded with the session token first and the Image then
  // draws the local copy: an <Image> given remote headers fails silently on
  // some Android builds, and a download reports the real HTTP status.
  useEffect(() => {
    setFailed(false);
    setLoading(true);
    setLocalUri(null);
    if (!path || pdf) return;
    let live = true;
    (async () => {
      try {
        const token = await getToken();
        const url = uploadUrl(path);
        const target = `${FileSystem.cacheDirectory}doc-${Date.now()}`;
        const res = await FileSystem.downloadAsync(url, target, { headers: token && isOwnUrl(url) ? { Authorization: `Bearer ${token}` } : {} });
        if (!live) return;
        if (res.status < 200 || res.status >= 300) throw new Error(`HTTP ${res.status}`);
        setLocalUri(res.uri);
      } catch (e) {
        if (__DEV__) console.warn("[bill] load failed", path, e);
        if (live) setFailed(true);
      }
    })();
    return () => {
      live = false;
    };
  }, [path, pdf, attempt]);

  async function onShare() {
    if (!path || busy) return;
    setBusy(true);
    try {
      await shareUpload(path);
    } catch (e) {
      if (!isUserCancel(e)) toast.error("Bill unavailable", userMessage(e, "Could not open the bill — try again."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet visible={!!path} onClose={onClose} title={title} maxHeightPct={85}>
      {path && !pdf && localUri && !failed ? (
        <View style={{ marginTop: 10, minHeight: 200, alignItems: "center", justifyContent: "center" }}>
          <Image
            key={attempt}
            source={{ uri: localUri }}
            resizeMode="contain"
            style={{ width: "100%", height: 420, backgroundColor: C.card }}
            onLoadEnd={() => setLoading(false)}
            onError={() => setFailed(true)}
          />
          {loading ? <ActivityIndicator color={C.brandDeep} style={{ position: "absolute" }} /> : null}
        </View>
      ) : (
        <View style={{ marginTop: 14, gap: 12 }}>
          <Txt style={{ fontSize: 13, color: C.muted }}>
            {pdf ? "This bill is a PDF — open it to view." : failed ? "Unable to load document." : "Loading…"}
          </Txt>
          {failed && !pdf ? <PrimaryButton label="Retry" onPress={() => { setAttempt((n) => n + 1); }} /> : null}
          {pdf || failed ? <PrimaryButton label={pdf ? "Open bill" : "Open instead"} variant={pdf ? undefined : "outline"} onPress={onShare} loading={busy} /> : null}
        </View>
      )}
    </Sheet>
  );
}
