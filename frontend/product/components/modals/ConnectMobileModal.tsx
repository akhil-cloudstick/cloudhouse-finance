"use client";

import { useEffect, useState } from "react";
import { toDataURL } from "qrcode";
import { useModal } from "@/product/components/Modal";
import { useBranding } from "@/product/providers/BrandingProvider";
import { businessCodeForRequest } from "@/product/services/tenantSession";

/* The staff mobile app has no business of its own any more — it starts on a
 * scanner and learns which business to sign in to from this QR (see
 * mobile/app/(auth)/connect.tsx). The payload uses the staff app's own URL
 * scheme (mobile/app.json `scheme: "cloudhouse"`), so a phone's camera app
 * opens the staff app straight onto that screen too.
 *
 * Only the business code is encoded: it is not a secret and grants nothing
 * (the same code the sign-in page already carries in its URL) — the staff
 * member still signs in with their own username and password. */
export function connectQrPayload(code: string): string {
  return "cloudhouse://connect?b=" + encodeURIComponent(code);
}

export function ConnectMobileModalContent() {
  const { closeModal } = useModal();
  const { name: businessName } = useBranding();
  const code = businessCodeForRequest();
  const [qr, setQr] = useState("");
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!code) return;
    let cancelled = false;
    toDataURL(connectQrPayload(code), { width: 256, errorCorrectionLevel: "M", margin: 1 })
      .then((url) => { if (!cancelled) setQr(url); })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, [code]);

  return (
    <>
      <div className="hd"><h3>Connect mobile app</h3><button className="x" onClick={closeModal}>×</button></div>
      <div className="bd bd-scroll">
        <div className="connect-qr">
          {!code ? (
            <p className="connect-qr-msg">This business has no code to share. Open the dashboard from your business&apos;s own link and try again.</p>
          ) : failed ? (
            <p className="connect-qr-msg">Could not generate the QR code. Use the business code below instead.</p>
          ) : qr ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={qr} alt={`QR code for ${businessName}`} width={224} height={224} />
          ) : (
            <div className="connect-qr-ph" />
          )}
          <div className="connect-qr-name">{businessName}</div>
          {code && (
            <div className="connect-qr-code">
              <small>Business code</small>
              <b>{code}</b>
            </div>
          )}
        </div>
        <ol className="connect-qr-steps">
          <li>Open the <b>CloudHouse Staff</b> app on your phone.</li>
          <li>Scan this QR code, or tap <b>Enter business code</b> and type the code above.</li>
          <li>Sign in with your username and password.</li>
        </ol>
      </div>
      <div className="ft">
        <button className="btn" onClick={closeModal}>Close</button>
      </div>
    </>
  );
}
