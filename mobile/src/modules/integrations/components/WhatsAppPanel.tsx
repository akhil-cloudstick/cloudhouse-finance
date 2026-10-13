import { useCallback, useEffect, useRef, useState } from "react";
import { Image, StyleSheet, View } from "react-native";
import { C, Field, Input, PillTabs, PrimaryButton, Txt, toast } from "@/common/components/ui";
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
const METHODS = ["qr", "phone"] as const;
const METHOD_LABELS = { qr: "Scan QR Code", phone: "Use Phone Number" };

function errText(e: unknown, fallback: string): string {
  return e instanceof Error && e.message ? e.message : fallback;
}

// "ABCD1234" → "ABCD-1234", the way WhatsApp shows it
function displayPairing(code: string): string {
  return code.length === 8 ? `${code.slice(0, 4)}-${code.slice(4)}` : code;
}

/* Settings > Integrations > WhatsApp. The business's own WhatsApp link: connect
 * by scanning a QR or by typing the number for a pairing code, or disconnect.
 * Mirrors the web panel (frontend/modules/integrations). */
export function WhatsAppPanel() {
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

  useEffect(() => {
    void load();
  }, [load]);

  async function start(m: Method) {
    setBusy(true);
    try {
      setSession(await connectWhatsApp());
      setMethod(m);
    } catch (e) {
      toast.error("Could not start the WhatsApp connection", errText(e, ""));
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    setBusy(true);
    try {
      await disconnectWhatsApp();
      setSession({ status: "not_connected", connected: false, phone: "" });
      toast.success("WhatsApp disconnected");
    } catch (e) {
      toast.error("Could not disconnect WhatsApp", errText(e, ""));
    } finally {
      setBusy(false);
    }
  }

  function onLinked(s: WhatsAppSession) {
    setSession(s);
    setMethod(null);
    toast.success("WhatsApp connected");
  }

  async function cancelConnect() {
    setMethod(null);
    // an unfinished attempt would otherwise keep a session running on the server
    if (session && !session.connected) {
      try {
        await disconnectWhatsApp();
      } catch {
        /* the next connect re-creates it */
      }
      void load();
    }
  }

  if (loadError) {
    return (
      <View style={st.card}>
        <Txt style={st.muted}>{loadError}</Txt>
        <PrimaryButton label="Try again" onPress={load} />
      </View>
    );
  }
  if (!session) {
    return (
      <View style={st.card}>
        <Txt style={st.muted}>Loading…</Txt>
      </View>
    );
  }
  if (method) {
    return <ConnectFlow method={method} onMethod={setMethod} onLinked={onLinked} onBack={cancelConnect} />;
  }

  return (
    <View style={st.card}>
      <View style={st.head}>
        <Txt style={st.title}>WhatsApp Sender</Txt>
        {session.connected ? (
          <View style={st.chip}>
            <Txt style={st.chipTxt}>Connected</Txt>
          </View>
        ) : null}
      </View>
      {session.connected ? (
        <>
          <Txt style={st.muted}>
            Messages from this app (reminders, OTPs, loan notices) are sent from {session.phone ? `+${session.phone}` : "your linked number"}.
          </Txt>
          <PrimaryButton label="Disconnect" variant="danger" onPress={disconnect} loading={busy} />
        </>
      ) : (
        <>
          <Txt style={st.muted}>Connect your WhatsApp number — customer messages will be sent from it.</Txt>
          <PrimaryButton label="Scan QR Code" onPress={() => start("qr")} loading={busy} />
          <PrimaryButton label="Use Phone Number Instead" variant="outline" onPress={() => start("phone")} disabled={busy} />
        </>
      )}
    </View>
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
        if (s.connected) {
          linked.current(s);
          return;
        }
        setStatus(s.status);
        if (method === "qr" && s.status === "qr_ready") {
          const q = await getWhatsAppQR();
          if (!stop && q.qrCode) setQr(q.qrCode);
        }
      } catch {
        /* a missed tick is fine; the next one retries */
      }
    }
    void tick();
    const t = setInterval(tick, POLL_MS);
    return () => {
      stop = true;
      clearInterval(t);
    };
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
    <View style={st.card}>
      <View style={st.head}>
        <Txt style={st.title}>Connect WhatsApp</Txt>
      </View>
      <PillTabs tabs={METHODS} value={method} onChange={onMethod} labels={METHOD_LABELS} inSheet />

      {method === "qr" ? (
        <View style={st.center}>
          {qr && ready ? <Image source={{ uri: qr }} style={st.qr} resizeMode="contain" /> : <View style={st.qr} />}
          <Txt style={st.muted}>{ready ? "Scan this with your phone" : "Preparing your QR code…"}</Txt>
          <Txt style={st.steps}>
            1. Open WhatsApp on your phone.{"\n"}2. Tap Menu or Settings › Linked devices › Link a device.{"\n"}3. Point your phone at this screen
            to scan the code.
          </Txt>
        </View>
      ) : code ? (
        <View style={st.center}>
          <View style={st.pair}>
            <Txt style={st.pairTxt}>{displayPairing(code)}</Txt>
          </View>
          <Txt style={st.steps}>
            1. Open WhatsApp › Linked devices › Link a device.{"\n"}2. Tap Link with phone number instead.{"\n"}3. Enter the code above on your
            phone.
          </Txt>
        </View>
      ) : (
        <View>
          <Field label="WhatsApp number (with country code)">
            <Input
              keyboardType="number-pad"
              placeholder="e.g. 919876543210"
              value={phone}
              onChangeText={(v) => setPhone(v.replace(/\D/g, ""))}
            />
          </Field>
          {error ? <Txt style={[st.muted, { color: C.red }]}>{error}</Txt> : null}
          <PrimaryButton label={ready ? "Get pairing code" : "Preparing…"} onPress={getCode} loading={busy} disabled={!ready || phone.length < 6} />
        </View>
      )}

      <PrimaryButton label="Back" variant="outline" onPress={onBack} />
    </View>
  );
}

const st = StyleSheet.create({
  card: { gap: 12, paddingVertical: 4 },
  head: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  title: { fontSize: 15, fontWeight: "700", color: C.ink },
  muted: { fontSize: 13, color: C.muted, lineHeight: 19 },
  chip: { backgroundColor: C.greenBg, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3 },
  chipTxt: { color: C.green, fontSize: 11.5, fontWeight: "600" },
  center: { alignItems: "center", gap: 10 },
  qr: { width: 224, height: 224, borderWidth: 1, borderColor: C.line, borderRadius: 12, backgroundColor: "#fff" },
  steps: { fontSize: 13, color: C.ink, lineHeight: 22, alignSelf: "stretch" },
  pair: { backgroundColor: C.brandFaint, borderWidth: 1, borderColor: C.line, borderRadius: 12, paddingVertical: 18, paddingHorizontal: 28 },
  pairTxt: { fontSize: 30, fontWeight: "700", letterSpacing: 3, color: C.brandDeep },
});
