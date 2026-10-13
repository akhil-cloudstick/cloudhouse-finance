"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "@/common/components/Icon";
import { useToast } from "@/common/components/ToastProvider";
import { singleFlight } from "@/common/utils/singleFlight";
import {
  connectWhatsApp,
  disconnectWhatsApp,
  getWhatsAppQR,
  getWhatsAppSession,
  requestWhatsAppPairingCode,
} from "@/modules/integrations/services/whatsappService";
import type { WhatsAppSession, WhatsAppStatus } from "@/modules/integrations/types/integrations-types";
import { CountryCodePicker } from "@/modules/integrations/components/CountryCodePicker";
import { COUNTRY_CODES, DEFAULT_COUNTRY_ISO } from "@/modules/integrations/utils/countryCodes";

type Method = "qr" | "phone";

const POLL_MS = 3000;

// Statuses where no engine is running, so the session has to be (re)started before it can show a QR.
const IDLE: WhatsAppStatus[] = ["not_connected", "created", "disconnected", "failed"];

function errText(e: unknown, fallback: string): string {
  return e instanceof Error && e.message ? e.message : fallback;
}

// "ABCD1234" → "ABCD-1234", the way WhatsApp shows it
function displayPairing(code: string): string {
  return code.length === 8 ? `${code.slice(0, 4)}-${code.slice(4)}` : code;
}

/* Settings > WhatsApp. Like WhatsApp's own "Link a device": the QR shows straight away, with linking by
 * phone number as the alternative. It keeps polling until the phone links and then switches to the
 * connected view on its own. Messages from the app go out from this number once it is connected. */
export function WhatsAppPanel() {
  const toast = useToast();
  const [session, setSession] = useState<WhatsAppSession | null>(null);
  const [loadError, setLoadError] = useState("");
  const [startError, setStartError] = useState("");
  const [method, setMethod] = useState<Method>("qr");
  const [qr, setQr] = useState("");
  const [country, setCountry] = useState(DEFAULT_COUNTRY_ISO);
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [codeError, setCodeError] = useState("");
  const [busy, setBusy] = useState(false);
  const methodRef = useRef(method);
  useEffect(() => { methodRef.current = method; }, [method]);

  // One start at a time across the whole page: a second /connect while the engine boots makes OpenWA
  // launch a second browser on the same profile, which fails the session.
  const start = useCallback(async () => {
    setStartError("");
    try {
      const s = await singleFlight("whatsapp:connect", connectWhatsApp);
      if (s) setSession((cur) => (cur?.connected ? cur : s));
    } catch (e) {
      setStartError(errText(e, "WhatsApp can't be connected right now. Please try again later."));
    }
  }, []);

  const load = useCallback(async () => {
    setLoadError("");
    try {
      const s = await getWhatsAppSession();
      setSession(s);
      if (!s.connected && IDLE.includes(s.status)) void start();
    } catch (e) {
      setLoadError(errText(e, "Could not load the WhatsApp status."));
    }
  }, [start]);

  useEffect(() => { void load(); }, [load]);

  const connected = !!session?.connected;

  // Poll until the phone links, then switch to the connected view. The QR rotates every ~20s on
  // WhatsApp's side, so it is re-read on every tick while it is showing.
  useEffect(() => {
    if (!session || connected) return;
    let stop = false;
    async function tick() {
      try {
        const s = await getWhatsAppSession();
        if (stop) return;
        setSession(s);
        if (s.connected) {
          setQr("");
          setCode("");
          toast("WhatsApp connected");
          return;
        }
        if (methodRef.current === "qr" && s.status === "qr_ready") {
          const q = await getWhatsAppQR();
          if (!stop && q.qrCode) setQr(q.qrCode);
        }
      } catch { /* a missed tick is fine; the next one retries */ }
    }
    void tick();
    const t = setInterval(tick, POLL_MS);
    return () => { stop = true; clearInterval(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!session, connected]);

  async function getCode() {
    const dial = COUNTRY_CODES.find((c) => c.iso === country)?.dial ?? "";
    setBusy(true);
    setCodeError("");
    try {
      const r = await requestWhatsAppPairingCode(dial + phone);
      setCode(r.pairingCode);
    } catch (e) {
      setCodeError(errText(e, "Could not get a pairing code."));
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    setBusy(true);
    try {
      await disconnectWhatsApp();
      setSession({ status: "not_connected", connected: false, phone: "" });
      setQr("");
      setCode("");
      toast("WhatsApp disconnected");
      void start();
    } catch (e) {
      toast(errText(e, "Could not disconnect WhatsApp."));
    } finally {
      setBusy(false);
    }
  }

  function switchMethod(m: Method) {
    setMethod(m);
    setCode("");
    setCodeError("");
  }

  if (loadError) {
    return (
      <div className="set-msg">
        <p>{loadError}</p>
        <button className="btn" onClick={load}>Try again</button>
      </div>
    );
  }
  if (!session) return <div className="set-loading"><span className="set-spin" /><span>Loading…</span></div>;

  if (connected) {
    return (
      <>
        <div className="set-head">
          <h4>WhatsApp</h4>
          <span className="set-chip">Connected</span>
        </div>
        <p className="set-sub">Customer messages from this app are sent from your linked WhatsApp number.</p>
        <div className="set-link">
          <div className="set-visual set-visual-ok">
            <Icon name="waOutline" />
            <b>{session.phone ? `+${session.phone}` : "Linked number"}</b>
            <small>Linked device</small>
          </div>
          <div>
            <ul className="set-list">
              <li><Icon name="check" /> Payment and interest reminders</li>
              <li><Icon name="check" /> Login and verification OTPs</li>
              <li><Icon name="check" /> Loan notices and receipts</li>
            </ul>
            <p className="set-note">To link a different number, disconnect this one first.</p>
            <button className="btn danger" onClick={disconnect} disabled={busy}>Disconnect</button>
          </div>
        </div>
      </>
    );
  }

  const status = session.status;
  const failed = !!startError || status === "failed" || status === "disconnected";
  const linking = status === "authenticating";
  const ready = status === "qr_ready";

  const visual = failed ? (
    <div className="set-ph">
      <Icon name="waOutline" />
      <span>{startError || "This code has expired."}</span>
      <button className="btn sm" onClick={() => void start()}>Get a new code</button>
    </div>
  ) : linking ? (
    <div className="set-ph"><span className="set-spin" /><span>Linking your phone…</span></div>
  ) : method === "qr" ? (
    qr && ready
      // eslint-disable-next-line @next/next/no-img-element
      ? <img src={qr} alt="WhatsApp QR code" width={224} height={224} />
      : <div className="set-ph"><span className="set-spin" /><span>Preparing your QR code…</span><small>This can take up to 30 seconds</small></div>
  ) : code ? (
    <div className="set-ph"><span className="set-code">{displayPairing(code)}</span><span>Enter this code on your phone</span></div>
  ) : (
    <div className="set-ph"><Icon name="phone" /><span>Your pairing code will appear here</span></div>
  );

  return (
    <>
      <div className="set-head"><h4>Link WhatsApp</h4></div>
      <p className="set-sub">Link your business WhatsApp number — customer messages will be sent from it.</p>
      <div className="set-link">
        <div className="set-visual">{visual}</div>
        <div>
          {method === "qr" ? (
            <>
              <ol className="set-steps">
                <li>Open <b>WhatsApp</b> on your phone.</li>
                <li>Tap <b>Menu</b> or <b>Settings</b> › <b>Linked devices</b>.</li>
                <li>Tap <b>Link a device</b>.</li>
                <li>Point your phone at this screen to scan the code.</li>
              </ol>
              <button type="button" className="set-alt" onClick={() => switchMethod("phone")}>Link with phone number instead</button>
            </>
          ) : code ? (
            <>
              <ol className="set-steps">
                <li>Open <b>WhatsApp</b> › <b>Linked devices</b> › <b>Link a device</b>.</li>
                <li>Tap <b>Link with phone number instead</b>.</li>
                <li>Enter the code shown here.</li>
              </ol>
              <button type="button" className="set-alt" onClick={() => switchMethod("phone")}>Use a different number</button>
            </>
          ) : (
            <>
              <label className="f">WhatsApp number</label>
              <div className="set-phone-row">
                <CountryCodePicker value={country} onChange={setCountry} />
                <input
                  className="inp"
                  inputMode="numeric"
                  placeholder="9876543210"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value.replace(/\D/g, ""))}
                />
              </div>
              {codeError && <p className="set-err">{codeError}</p>}
              <button className="btn" style={{ marginTop: 12 }} onClick={getCode} disabled={busy || !ready || phone.length < 6}>
                {ready || busy ? "Get pairing code" : "Preparing…"}
              </button>
            </>
          )}
          {method === "phone" && (
            <button type="button" className="set-alt" onClick={() => switchMethod("qr")}>Scan QR code instead</button>
          )}
        </div>
      </div>
    </>
  );
}
