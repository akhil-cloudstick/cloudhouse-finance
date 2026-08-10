"use client";

import { useEffect, useState } from "react";
import { useToast } from "@/components/Toast";
import { Icon } from "@/lib/icons";
import {
  CATEGORY_LABELS,
  deleteApiKey,
  listApiKeys,
  setApiKey,
  type ApiKeyCategory,
  type ApiKeyView,
} from "@/lib/settingsApi";

/* Admin-only Settings page: storage for third-party integration API keys
 * (Notifications, SMS, WhatsApp, KYC/Aadhaar/PAN verification). Values are
 * encrypted at rest on the backend (see internal/settings) — this page
 * only stores them, it doesn't wire them up to any provider yet. */
export function Settings() {
  const toast = useToast();
  const [keys, setKeys] = useState<ApiKeyView[] | null>(null);
  const [error, setError] = useState("");

  async function load() {
    try {
      setKeys(await listApiKeys());
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load settings.");
    }
  }

  useEffect(() => { load(); }, []);

  return (
    <>
      <div className="page-h">
        <div><h1>Settings</h1><p>Admin-only · third-party integration API keys, encrypted at rest</p></div>
      </div>
      <hr className="gold-rule" />
      {error && (
        <p style={{ color: "var(--red)", fontSize: 13.5 }}>
          Could not reach the server — {error}
          <button className="btn plain sm" style={{ marginLeft: 8 }} onClick={load}>Retry</button>
        </p>
      )}
      {!error && keys === null && (
        <p style={{ color: "var(--muted)", fontSize: 13.5 }}>Loading settings…</p>
      )}
      {keys !== null && (
        <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fill,minmax(340px,1fr))" }}>
          {keys.map((k) => (
            <ApiKeyCard key={k.category} apiKey={k} onSaved={load} toast={toast} />
          ))}
        </div>
      )}
    </>
  );
}

function ApiKeyCard({
  apiKey,
  onSaved,
  toast,
}: {
  apiKey: ApiKeyView;
  onSaved: () => void;
  toast: (msg: string) => void;
}) {
  const [name, setName] = useState(apiKey.name);
  const [value, setValue] = useState(apiKey.value);
  const [reveal, setReveal] = useState(false);
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!value.trim()) { setErr("Please enter a key value."); return; }
    setSaving(true);
    setErr("");
    try {
      await setApiKey(apiKey.category, name.trim(), value.trim());
      onSaved();
      toast(`${CATEGORY_LABELS[apiKey.category]} key saved`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to save key.");
    } finally {
      setSaving(false);
    }
  }

  async function clear() {
    if (!confirm(`Clear the stored ${CATEGORY_LABELS[apiKey.category]} key?`)) return;
    try {
      await deleteApiKey(apiKey.category);
      setName("");
      setValue("");
      onSaved();
      toast(`${CATEGORY_LABELS[apiKey.category]} key cleared`);
    } catch (e) {
      toast(e instanceof Error ? e.message : "Failed to clear key.");
    }
  }

  return (
    <div className="card gtop">
      <div className="hd"><h3>{CATEGORY_LABELS[apiKey.category]}</h3><div className="sp" />
        {apiKey.isSet ? <span className="chip green">Configured</span> : <span className="chip gray">Not set</span>}
      </div>
      <div className="bd">
        {/* autoComplete="off" (plus unique name attrs) stops the browser from
         * treating a text-input-followed-by-password-input as a login form
         * and autofilling saved credentials into these fields. */}
        <div className="frow"><div><label className="f">Key Name</label>
          <input
            className="inp"
            name={`apikey-name-${apiKey.category}`}
            placeholder="e.g. Twilio prod key"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoComplete="off"
            data-1p-ignore
            data-lpignore="true"
          /></div></div>
        <div className="frow"><div><label className="f">API Key *</label>
          <div style={{ display: "flex", gap: 8 }}>
            <input
              className="inp"
              name={`apikey-value-${apiKey.category}`}
              type={reveal ? "text" : "password"}
              placeholder="Paste the API key/secret"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              style={{ flex: 1 }}
              autoComplete="new-password"
              data-1p-ignore
              data-lpignore="true"
            />
            <button type="button" className="btn ghost sm" onClick={() => setReveal((v) => !v)}>
              <Icon name={reveal ? "eyeOff" : "eye"} />
            </button>
          </div>
        </div></div>
        <p style={{ color: "var(--red)", fontSize: 12.5, minHeight: 16, marginTop: 4 }}>{err}</p>
      </div>
      <div className="ft" style={{ display: "flex", gap: 8 }}>
        {apiKey.isSet && <button className="btn ghost sm" style={{ color: "var(--red)" }} onClick={clear}>Clear</button>}
        <div className="sp" />
        <button className="btn sm" onClick={save} disabled={saving}><Icon name="check" /> {saving ? "Saving…" : "Save"}</button>
      </div>
    </div>
  );
}
