"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "@/common/components/Icon";
import { useToast } from "@/common/components/ToastProvider";
import {
  connectWhatsApp,
  disconnectWhatsApp,
  getWhatsAppQR,
  getWhatsAppSession,
  requestWhatsAppPairingCode,
} from "@/modules/integrations/services/whatsappService";
import type { WhatsAppSession } from "@/modules/integrations/types/integrations-types";

type Method = "qr" | "phone";

const POLL_MS = 3000;

function errText(e: unknown, fallback: string): string {
  return e instanceof Error && e.message ? e.message : fallback;
}

// "ABCD1234" → "ABCD-1234", the way WhatsApp shows it
function displayPairing(code: string): string {
  return code.length === 8 ? `${code.slice(0, 4)}-${code.slice(4)}` : code;
}

/* Settings > Integrations > WhatsApp. Shows the business's own WhatsApp link and
 * lets it connect (scan a QR, or type its number to get a pairing code) or
 * disconnect. The session is the business's own: messages sent from the app
 * go out from this number once it is connected. */
export function WhatsAppPanel() {
  const toast = useToast();
  const [session, setSession] = useState<WhatsAppSession | null>(null);
  const [loadError, setLoadError] = useState("");
  const [method, setMethod] = useState<Method | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoadError("");
    try {
      setSession(await getWhatsAppSession());
    } catch (e) {
      setLoadError(errText(e, "Could not load the WhatsApp status."));
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function start(m: Method) {
    setBusy(true);
    // Open the connect screen right away: the first start launches the WhatsApp engine and
    // takes ~10-30s, and the screen's own polling shows the QR the moment it is ready.
    setMethod(m);
    try {
      setSession(await connectWhatsApp());
    } catch (e) {
      setMethod(null);
      toast(errText(e, "Could not start the WhatsApp connection."));
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    setBusy(true);
    try {
      await disconnectWhatsApp();
      setSession({ status: "not_connected", connected: false, phone: "" });
      toast("WhatsApp disconnected");
    } catch (e) {
      toast(errText(e, "Could not disconnect WhatsApp."));
    } finally {
      setBusy(false);
    }
  }

  function onLinked(s: WhatsAppSession) {
    setSession(s);
    setMethod(null);
    toast("WhatsApp connected");
  }

  async function cancelConnect() {
    setMethod(null);
    // an unfinished attempt would otherwise keep a session running on the server
    if (session && !session.connected) {
      try { await disconnectWhatsApp(); } catch { /* the next connect re-creates it */ }
      void load();
    }
  }

  if (loadError) {
    return (
      <div className="set-card">
        <p className="connect-qr-msg">{loadError}</p>
        <button className="btn" onClick={load}>Try again</button>
      </div>
    );
  }
  if (!session) return <div className="set-card"><p className="connect-qr-msg">Loading…</p></div>;

  if (method) {
    return <ConnectFlow method={method} onMethod={setMethod} onLinked={onLinked} onBack={cancelConnect} />;
  }

  return (
    <div className="set-card">
      <div className="set-card-hd">
        <h4>WhatsApp Sender</h4>
        {session.connected && <span className="set-chip">Connected</span>}
      </div>
      {session.connected ? (
        <>
          <p className="set-sub">
            Messages from this app (reminders, OTPs, loan notices) are sent from
            {session.phone ? <> <b>+{session.phone}</b></> : " your linked number"}.
          </p>
          <div className="set-actions">
            <button className="btn danger" onClick={disconnect} disabled={busy}>Disconnect</button>
          </div>
        </>
      ) : (
        <>
          <p className="set-sub">Connect your WhatsApp number — customer messages will be sent from it.</p>
          <div className="set-actions">
            <button className="btn" onClick={() => start("qr")} disabled={busy}>
              <Icon name="scan" /> Scan QR Code
            </button>
            <button className="btn ghost" onClick={() => start("phone")} disabled={busy}>
              <Icon name="phone" /> Use Phone Number Instead
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function ConnectFlow({
  method,
  onMethod,
  onLinked,
  onBack,
}: {
  method: Method;
  onMethod: (m: Method) => void;
  onLinked: (s: WhatsAppSession) => void;
  onBack: () => void;
}) {
  const [status, setStatus] = useState<WhatsAppSession["status"]>("initializing");
  const [qr, setQr] = useState("");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const linked = useRef(onLinked);
  linked.current = onLinked;

  // Poll until the phone has linked. The QR rotates every ~20s on WhatsApp's side,
  // so it is re-read on every tick while the QR tab is open.
  useEffect(() => {
    let stop = false;
    async function tick() {
      try {
        const s = await getWhatsAppSession();
        if (stop) return;
        if (s.connected) { linked.current(s); return; }
        setStatus(s.status);
        if (method === "qr" && s.status === "qr_ready") {
          const q = await getWhatsAppQR();
          if (!stop && q.qrCode) setQr(q.qrCode);
        }
      } catch { /* a missed tick is fine; the next one retries */ }
    }
    void tick();
    const t = setInterval(tick, POLL_MS);
    return () => { stop = true; clearInterval(t); };
  }, [method]);

  async function getCode() {
    setBusy(true);
    setError("");
    try {
      const r = await requestWhatsAppPairingCode(phone);
      setCode(r.pairingCode);
    } catch (e) {
      setError(errText(e, "Could not get a pairing code."));
    } finally {
      setBusy(false);
    }
  }

  const ready = status === "qr_ready";

  return (
    <div className="set-card">
      <div className="set-card-hd">
        <h4>Connect WhatsApp</h4>
        <button className="btn ghost sm" onClick={onBack}>Back</button>
      </div>
      <div className="tabs connect-tabs">
        <button className={method === "qr" ? "on" : ""} onClick={() => onMethod("qr")}>Scan QR Code</button>
        <button className={method === "phone" ? "on" : ""} onClick={() => onMethod("phone")}>Use Phone Number</button>
      </div>

      {method === "qr" ? (
        <div className="connect-qr">
          {qr && ready ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={qr} alt="WhatsApp QR code" width={224} height={224} />
          ) : (
            <div className="connect-qr-ph" />
          )}
          <small className="connect-qr-exp">{ready ? "Scan this with your phone" : "Preparing your QR code…"}</small>
          <ol className="connect-qr-steps">
            <li>Open <b>WhatsApp</b> on your phone.</li>
            <li>Tap <b>Menu</b> or <b>Settings</b> › <b>Linked devices</b> › <b>Link a device</b>.</li>
            <li>Point your phone at this screen to scan the code.</li>
          </ol>
        </div>
      ) : (
        <div className="connect-qr">
          {code ? (
            <>
              <div className="connect-code-big set-pair">{displayPairing(code)}</div>
              <ol className="connect-qr-steps">
                <li>Open <b>WhatsApp</b> › <b>Linked devices</b> › <b>Link a device</b>.</li>
                <li>Tap <b>Link with phone number instead</b>.</li>
                <li>Enter the code above on your phone.</li>
              </ol>
            </>
          ) : (
            <>
              <div className="set-phone">
                <label className="f">WhatsApp number (with country code)</label>
                <input
                  className="inp"
                  inputMode="numeric"
                  placeholder="e.g. 919876543210"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value.replace(/\D/g, ""))}
                />
              </div>
              {error && <p className="connect-qr-msg">{error}</p>}
              <button className="btn" onClick={getCode} disabled={busy || !ready || phone.length < 6}>
                {ready ? "Get pairing code" : "Preparing…"}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
