"use client";

import { useState } from "react";
import { useModal } from "@/common/components/ModalProvider";
import { useToast } from "@/common/components/ToastProvider";
import { Icon } from "@/common/components/Icon";
import { Select } from "@/common/components/ui/Select";
import { ApiError } from "@/common/services/httpClient";
import { mergeBanks } from "@/modules/banks/services/bankService";
import { type BackendBank } from "@/modules/banks/types/bank-types";
import { singleFlight } from "@/common/utils/singleFlight";

type MergeBankModalContentProps = { source: BackendBank; banks: BackendBank[]; onSaved: () => void };

/* Reassigns a duplicate bank's transaction/pledge history onto the bank the
 * admin picks as canonical, then permanently deletes the duplicate — the
 * cleanup tool for the near-duplicate bank rows the historical free-text
 * bank backfill is expected to create ("HDFC", "HDFC Bank", "HDFC BANK LTD",
 * …). Irreversible, so this warns up front rather than only on error. */
export function MergeBankModalContent({ source, banks, onSaved }: MergeBankModalContentProps) {
  const { closeModal } = useModal();
  const toast = useToast();
  const candidates = banks.filter((b) => b.id !== source.id);
  const [targetId, setTargetId] = useState(candidates[0] ? String(candidates[0].id) : "");
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);

  const target = candidates.find((b) => String(b.id) === targetId);

  async function save() { return singleFlight("modal:mergebank:save", async () => {
    if (!target) { setErr("Please pick a bank to merge into."); return; }
    setSaving(true);
    setErr("");
    try {
      await mergeBanks(source.id, target.id);
      toast(`"${source.name}" merged into "${target.name}"`);
      closeModal();
      onSaved();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Failed to merge banks.");
    } finally {
      setSaving(false);
    }
  }); }

  return (
    <>
      <div className="hd"><h3>Merge Duplicate Bank</h3><button className="x" onClick={closeModal}>×</button></div>
      <div className="bd bd-scroll">
        <div className="frow"><div><label className="f">Merge "{source.name}" into</label>
          <Select
            options={candidates.map((b) => ({ value: String(b.id), label: b.name }))}
            value={targetId}
            onChange={setTargetId}
            placeholder="Select the bank to keep…"
          />
        </div></div>
        <div className="notice" style={{ marginTop: 12 }}>
          <Icon name="shield" /> This will move every transaction and pledge linked to &quot;{source.name}&quot; onto
          {target ? ` "${target.name}"` : " the bank you pick"} and permanently delete &quot;{source.name}&quot; — this can&apos;t be undone.
        </div>
        <p style={{ color: "var(--red)", fontSize: 12.5, minHeight: 16, marginTop: 8 }}>{err}</p>
      </div>
      <div className="ft">
        <button className="btn ghost" onClick={closeModal}>Cancel</button>
        <button className="btn danger" onClick={save} disabled={saving || !target}>{saving ? "Merging…" : "Merge & Delete"}</button>
      </div>
    </>
  );
}
