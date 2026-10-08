import React, { useEffect, useState } from "react";
import { ActivityIndicator, Image, View } from "react-native";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import { C, PrimaryButton, Sheet, Txt, toast } from "../ui";
import { API_ORIGIN } from "../../api/config";
import { getToken } from "../../auth/tokenStorage";
import { isUserCancel, userMessage } from "../../api/errors";

// Uploaded bills / receipts live at /uploads/<key>, which the server only
// serves to a signed-in caller (Authorization: Bearer on GET /uploads/:key) —
// so an <Image> pointing at one must carry the session token, and a link
// handed to the system browser (no header) would 401. Mobile counterpart of
// the web's BillViewModalContent.

export const uploadUrl = (path: string) => (path.startsWith("http") ? path : `${API_ORIGIN}${path}`);
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
  return { uri: uploadUrl(path), ...(headers.Authorization ? { headers } : {}) };
}

/** Download an /uploads file with the token and open the share sheet. */
async function shareUpload(path: string) {
  const token = await getToken();
  const ext = (path.match(/\.([a-z0-9]{2,5})(\?|$)/i)?.[1] ?? "bin").toLowerCase();
  const target = `${FileSystem.cacheDirectory}bill-${Date.now()}.${ext}`;
  const res = await FileSystem.downloadAsync(uploadUrl(path), target, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  if (res.status < 200 || res.status >= 300) throw new Error("The bill could not be loaded.");
  if (!(await Sharing.isAvailableAsync())) throw new Error("Sharing isn't available on this device.");
  await Sharing.shareAsync(res.uri, { dialogTitle: "Bill" });
}

/** A bill image in a sheet, authenticated, with a clear fallback if it won't
 * load (and Share/Open for PDFs, which an Image can't draw). */
export function BillSheet({ path, onClose }: { path: string | null; onClose: () => void }) {
  const source = useUploadSource(path ?? "");
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setFailed(false);
    setLoading(true);
  }, [path]);

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

  const pdf = !!path && isPdf(path);
  return (
    <Sheet visible={!!path} onClose={onClose} title="Bill" maxHeightPct={85}>
      {path && !pdf && source && !failed ? (
        <View style={{ marginTop: 10, minHeight: 200, alignItems: "center", justifyContent: "center" }}>
          <Image
            source={source}
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
            {pdf ? "This bill is a PDF — open it to view." : failed ? "The bill image could not be loaded. It may have been removed, or your session may have expired." : "Loading…"}
          </Txt>
          {pdf || failed ? <PrimaryButton label={pdf ? "Open bill" : "Try opening it instead"} onPress={onShare} loading={busy} /> : null}
        </View>
      )}
    </Sheet>
  );
}
