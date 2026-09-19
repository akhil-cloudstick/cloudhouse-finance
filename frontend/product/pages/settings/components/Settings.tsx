"use client";

import { useEffect, useMemo, useState } from "react";
import { useToast } from "@/product/components/Toast";
import { Icon } from "@/product/components/Icon";
import { makeEnterToSubmitHandler } from "@/product/utils/enterToSubmit";
import {
  CATEGORY_LABELS,
  deleteApiKey,
  listApiKeys,
  setApiKey,
  type ApiKeyCategory,
  type ApiKeyView,
} from "@/product/pages/settings/services/settingsService";
import { useAuth } from "@/product/providers/auth-context";

/* Admin-only Settings page: storage for third-party integration API keys
 * (Notifications, SMS, WhatsApp, KYC/Aadhaar/PAN verification). Values are
 * encrypted at rest on the backend (see internal/settings) — this page
 * only stores them, it doesn't wire them up to any provider yet. */
export function Settings() {
  const toast = useToast();
  // Saving a key is an update; clearing one is a delete. Without the grant
  // the card renders read-only rather than offering a button that 403s
  // (see Customers.tsx).
  const { can } = useAuth();
  const canUpdateSettings = can("Settings_Management", "can_update_setting");
  const canDeleteSettings = can("Settings_Management", "can_delete_setting");
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
          Something went wrong. Please try again later.
        </p>
      )}
      {!error && keys === null && (
        <p style={{ color: "var(--muted)", fontSize: 13.5 }}>Loading settings…</p>
      )}
      {keys !== null && (
        <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fill,minmax(340px,1fr))" }}>
          {keys.map((k) => (
            <ApiKeyCard key={k.category} apiKey={k} canUpdate={canUpdateSettings} canDelete={canDeleteSettings} onSaved={load} toast={toast} />
          ))}
        </div>
      )}
    </>
  );
}

function ApiKeyCard({
  apiKey,
  canUpdate,
  canDelete,
  onSaved,
  toast,
}: {
  apiKey: ApiKeyView;
  canUpdate: boolean;
  canDelete: boolean;
  onSaved: () => void;
  toast: (msg: string) => void;
}) {
  const [name, setName] = useState(apiKey.name);
  const [value, setValue] = useState(apiKey.value);
  const [reveal, setReveal] = useState(false);
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);
  // Each card is its own little form with its own Save button — scoped to
  // this card's own container (not document-wide), so Enter in one card
  // never triggers another card's Save.
  const onEnterSubmit = useMemo(() => makeEnterToSubmitHandler(".ft button.btn:not(.ghost):not(:disabled)"), []);

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
    <div className="card gtop" onKeyDown={onEnterSubmit}>
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
            disabled={!canUpdate}
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
              disabled={!canUpdate}
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
        {apiKey.isSet && canDelete && <button className="btn ghost sm" style={{ color: "var(--red)" }} onClick={clear}>Clear</button>}
        <div className="sp" />
        {canUpdate && <button className="btn sm" onClick={save} disabled={saving}><Icon name="check" /> {saving ? "Saving…" : "Save"}</button>}
      </div>
    </div>
  );
}
