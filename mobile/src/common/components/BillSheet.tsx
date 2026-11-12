import React, { useEffect, useState } from "react";
import { ActivityIndicator, Image, Pressable, View, type ImageStyle, type StyleProp, type ViewStyle } from "react-native";
import * as FileSystem from "expo-file-system/legacy";
import { presentFile } from "@/common/utils/presentFile";
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
async function shareUpload(path: string, title: string) {
  const token = await getToken();
  const ext = (path.match(/\.([a-z0-9]{2,5})(\?|$)/i)?.[1] ?? "bin").toLowerCase();
  const target = `${FileSystem.cacheDirectory}bill-${Date.now()}.${ext}`;
  const url = uploadUrl(path);
  const res = await FileSystem.downloadAsync(url, target, { headers: token && isOwnUrl(url) ? { Authorization: `Bearer ${token}` } : {} });
  if (res.status < 200 || res.status >= 300) throw new Error(`The ${title === "Bill" ? "bill" : "document"} could not be loaded.`);
  await presentFile(res.uri, { mimeType: ext === "pdf" ? "application/pdf" : undefined, title });
}

// path -> downloaded local file, so a photo shown twice (or re-rendered) isn't fetched again.
const localCopies = new Map<string, string>();

type UploadImageProps = { path: string; style?: StyleProp<ImageStyle>; /** Tap opens the full-size viewer (sheet titled `title`). */ title?: string; /** false: the image is not tappable on its own (a parent handles the tap). */ viewer?: boolean };

/** An /uploads image drawn from a token-authenticated download (an <Image> given remote
 * headers fails silently on some Android builds). Tap to open full size. */
export function UploadImage({ path, style, title = "Photo", viewer = true }: UploadImageProps) {
  const [uri, setUri] = useState<string | null>(() => localCopies.get(path) ?? null);
  const [failed, setFailed] = useState(false);
  const [viewing, setViewing] = useState(false);
  useEffect(() => {
    const cached = localCopies.get(path);
    if (cached) {
      setUri(cached);
      return;
    }
    setUri(null);
    setFailed(false);
    let live = true;
    (async () => {
      try {
        const token = await getToken();
        const url = uploadUrl(path);
        const res = await FileSystem.downloadAsync(url, `${FileSystem.cacheDirectory}img-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, {
          headers: token && isOwnUrl(url) ? { Authorization: `Bearer ${token}` } : {},
        });
        if (res.status < 200 || res.status >= 300) throw new Error(`HTTP ${res.status}`);
        localCopies.set(path, res.uri);
        if (live) setUri(res.uri);
      } catch {
        if (live) setFailed(true);
      }
    })();
    return () => {
      live = false;
    };
  }, [path]);
  return (
    <>
      <Pressable onPress={() => viewer && setViewing(true)} disabled={!viewer} accessibilityRole="imagebutton" accessibilityLabel={`View ${title}`}>
        {uri && !failed ? (
          <Image source={{ uri }} resizeMode="cover" style={style} onError={() => setFailed(true)} />
        ) : (
          <View style={[style as StyleProp<ViewStyle>, { alignItems: "center", justifyContent: "center", backgroundColor: C.card }]}>
            {failed ? <Txt style={{ fontSize: 11, color: C.muted }}>Photo unavailable</Txt> : <ActivityIndicator color={C.brandDeep} />}
          </View>
        )}
      </Pressable>
      <BillSheet path={viewing ? path : null} title={title} onClose={() => setViewing(false)} />
    </>
  );
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
  // Only ledger bills are "bills"; everything else (KYC documents, ornament photos…) is a document.
  const noun = title === "Bill" ? "bill" : "document";
  const Noun = noun === "bill" ? "Bill" : "Document";
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
      await shareUpload(path, title);
    } catch (e) {
      if (!isUserCancel(e)) toast.error(`${Noun} unavailable`, userMessage(e, `Could not open the ${noun} — try again.`));
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
            {pdf ? `This ${noun} is a PDF — open it to view.` : failed ? "Document unavailable." : "Loading…"}
          </Txt>
          {failed && !pdf ? <PrimaryButton label="Retry" onPress={() => { setAttempt((n) => n + 1); }} /> : null}
          {pdf || failed ? <PrimaryButton label={pdf ? `Open ${noun}` : "Open instead"} variant={pdf ? undefined : "outline"} onPress={onShare} loading={busy} /> : null}
        </View>
      )}
    </Sheet>
  );
}
