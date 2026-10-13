"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toDataURL } from "qrcode";
import { Icon } from "@/common/components/Icon";
import { useBranding } from "@/common/providers/BrandingProvider";
import { issueQrLogin } from "@/common/services/authService";
import { createConnectCode } from "@/modules/branding/services/brandingService";

/* The staff mobile app has no business of its own any more — it starts on a
 * scanner and learns which business to sign in to from this QR (see
 * mobile/app/(auth)/connect.tsx). The payload uses the staff app's own URL
 * scheme (mobile/app.json `scheme: "cloudhouse"`), so a phone's camera app
 * opens the staff app straight onto that screen too.
 *
 * Like WhatsApp's "link a device", the QR carries a fresh 6-character code
 * the server issues each time this opens (backend/internal/branding/
 * connect.go), not the business code itself. The phone redeems it for the
 * business; the code grants nothing else — the staff member still signs in
 * with their own username and password. It expires after a few minutes and
 * a new one is fetched automatically. */
export function connectQrPayload(code: string, loginToken?: string): string {
  return "cloudhouse://connect?c=" + encodeURIComponent(code) + (loginToken ? "&l=" + encodeURIComponent(loginToken) : "");
}

// "ABC123" → "ABC 123": easier to read off the screen. The phone ignores
// the space (and a dash) when the code is typed.
function displayCode(code: string): string {
  return code.length === 6 ? `${code.slice(0, 3)} ${code.slice(3)}` : code;
}

function formatLeft(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/* The Link Mobile section of the Settings modal. */
export function ConnectMobilePanel() {
  const { name: businessName } = useBranding();
  const [code, setCode] = useState("");
  const [qr, setQr] = useState("");
  const [left, setLeft] = useState(0);
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(true);
  // Both tabs show the same live code — the QR just carries it.
  const [tab, setTab] = useState<"qr" | "code">("qr");
  // When the current code expires, on this browser's clock — derived from
  // the server's expiresIn so a skewed clock does not cut it short.
  const deadline = useRef(0);
  const attempt = useRef(0);

  const refresh = useCallback(async () => {
    const mine = ++attempt.current;
    setLoading(true);
    setFailed(false);
    try {
      const c = await createConnectCode();
      // The QR also carries a one-time login token for the employee signed in
      // here, so the phone that scans it is signed in too. If that fails the
      // QR still connects the business and the phone signs in by password.
      const login = await issueQrLogin().catch(() => null);
      const url = await toDataURL(connectQrPayload(c.code, login?.token), { width: 256, errorCorrectionLevel: "M", margin: 1 });
      if (mine !== attempt.current) return;
      deadline.current = Date.now() + c.expiresIn * 1000;
      setCode(c.code);
      setQr(url);
      setLeft(c.expiresIn);
    } catch {
      if (mine !== attempt.current) return;
      setCode("");
      setQr("");
      setFailed(true);
    } finally {
      if (mine === attempt.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    return () => { attempt.current++; };
  }, [refresh]);

  // Countdown; a fresh code is fetched the moment the current one expires.
  useEffect(() => {
    if (!code) return;
    const t = setInterval(() => {
      const secs = Math.max(0, Math.ceil((deadline.current - Date.now()) / 1000));
      setLeft(secs);
      if (secs === 0) {
        clearInterval(t);
        refresh();
      }
    }, 1000);
    return () => clearInterval(t);
  }, [code, refresh]);

  return (
    <>
      <div className="set-head"><h4>Link Mobile</h4></div>
      <p className="set-sub">Sign in to the <b>CloudHouse Staff</b> app on your phone for {businessName}.</p>
      <div className="set-link">
        <div className="set-visual">
          {failed ? (
            <div className="set-ph"><Icon name="smartphone" /><span>Could not generate a connect code. Check your connection and try again.</span></div>
          ) : tab === "qr" ? (
            qr && !loading ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={qr} alt={`QR code for ${businessName}`} width={224} height={224} />
            ) : (
              <div className="set-ph"><span className="set-spin" /><span>Generating your QR code…</span></div>
            )
          ) : (
            <div className="set-ph"><span className="set-code">{code && !loading ? displayCode(code) : "··· ···"}</span><span>Type this code in the app</span></div>
          )}
        </div>
        <div>
          <ol className="set-steps">
            <li>Open the <b>CloudHouse Staff</b> app on your phone.</li>
            {tab === "qr" ? (
              <li>Tap <b>Scan QR code</b> and point the camera at this QR.</li>
            ) : (
              <li>Tap <b>Enter code manually</b> and type the 6-character code.</li>
            )}
            <li>{tab === "qr" ? "The app signs in as you — no password needed." : "Sign in with your username and password."}</li>
          </ol>
          <div className="set-meta">
            {code && !failed && <span>{loading ? "Generating a new code…" : `Expires in ${formatLeft(left)}`}</span>}
            <button className="btn sm" onClick={refresh} disabled={loading}>
              {failed ? "Try again" : tab === "qr" ? "New QR" : "New code"}
            </button>
          </div>
          <button type="button" className="set-alt" onClick={() => setTab(tab === "qr" ? "code" : "qr")}>
            {tab === "qr" ? "Enter a code instead" : "Scan QR code instead"}
          </button>
        </div>
      </div>
    </>
  );
}
