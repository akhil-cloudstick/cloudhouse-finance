"use client";

import { useEffect, useRef, useState } from "react";
import { useToast } from "@/product/components/Toast";
import { Icon } from "@/product/components/Icon";
import { StageTracker } from "@/product/components/ui/StageTracker";
import { useAuth, useApprovalWorkflow } from "@/product/providers/auth-context";
import { ApiError } from "@/product/services/httpClient";
import { updateApprovalWorkflow, type FlowView } from "@/product/services/approvalWorkflowService";

/* One flow's card — a checkbox per stage, a live preview of the chain the
 * ticked boxes would produce, and its own Save. Draft state is local to the
 * card so editing one flow never touches another's unsaved changes. */
function FlowCard({ flow, canEdit, onSaved }: { flow: FlowView; canEdit: boolean; onSaved: () => Promise<void> }) {
  const toast = useToast();
  const [draft, setDraft] = useState<Record<string, boolean>>(() => Object.fromEntries(flow.stages.map((s) => [s.key, s.enabled])));
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  // Brief "Changes saved" confirmation beside the button after a save.
  const [justSaved, setJustSaved] = useState(false);
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (savedTimer.current) clearTimeout(savedTimer.current); }, []);

  // Resync the draft to the stored state whenever that state changes (a
  // save here, or a config refresh).
  const savedSig = flow.stages.map((s) => (s.enabled ? 1 : 0)).join("");
  const [syncedSig, setSyncedSig] = useState(savedSig);
  if (syncedSig !== savedSig) {
    setSyncedSig(savedSig);
    setDraft(Object.fromEntries(flow.stages.map((s) => [s.key, s.enabled])));
  }

  const ticked = flow.stages.filter((s) => draft[s.key]);
  const dirty = flow.stages.some((s) => draft[s.key] !== s.enabled);
  const tooFew = ticked.length < flow.minEnabled;
  // The preview mirrors what a tracker will show for a new item: the
  // enabled stages in order, the last one naming what it does.
  const preview = ticked.map((s, i) => (i === ticked.length - 1 ? `${s.label} (${flow.finalAction})` : s.label));

  async function save() {
    // The button stays enabled while it shows "Saved" (so the green
    // confirmation isn't greyed out) — clicking it then is a no-op.
    if (tooFew || !dirty) return;
    setSaving(true);
    setErr("");
    try {
      await updateApprovalWorkflow(flow.key, draft);
      toast(`${flow.label} approval workflow saved`);
      setJustSaved(true);
      if (savedTimer.current) clearTimeout(savedTimer.current);
      savedTimer.current = setTimeout(() => setJustSaved(false), 2500);
      await onSaved();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Could not save — try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="card gtop">
      <div className="hd"><h3 style={{ fontSize: 15 }}>{flow.label}</h3></div>
      <div className="bd" style={{ padding: 0 }}>
        <div className="perm-list-rows">
          {flow.stages.map((s) => (
            <label key={s.key} className="ccheck perm-list-row">
              <input
                type="checkbox"
                checked={!!draft[s.key]}
                disabled={!canEdit || saving}
                onChange={(e) => setDraft((d) => ({ ...d, [s.key]: e.target.checked }))}
              />
              <span className="mark" />
              <span>
                <b style={{ fontSize: 13 }}>{s.label}</b>
                <span className="sub" style={{ display: "block", fontSize: 11.5 }}>
                  {s.role} · needs &quot;{s.permission}&quot;
                </span>
              </span>
            </label>
          ))}
        </div>
      </div>
      <div className="bd">
        {ticked.length > 0 ? (
          <StageTracker stages={preview} currentIndex={-1} />
        ) : (
          <p className="ccheck-hint" style={{ margin: 0 }}>
            <Icon name="shield" /> No approval — {flow.offBehavior}
          </p>
        )}
        {tooFew && (
          <p style={{ color: "var(--red)", fontSize: 12.5, marginTop: 8 }}>
            At least {flow.minEnabled} stage{flow.minEnabled === 1 ? "" : "s"} must stay on — {flow.offBehavior}
          </p>
        )}
        {err && <p style={{ color: "var(--red)", fontSize: 12.5, marginTop: 8 }}>{err}</p>}
        <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 12, marginTop: 12 }}>
          {justSaved && (
            <span className="save-msg" role="status"><Icon name="check" /> Changes saved</span>
          )}
          <button
            className={`btn sm save-btn${justSaved ? " saved" : ""}`}
            onClick={save}
            disabled={!canEdit || saving || (!dirty && !justSaved) || tooFew}
          >
            <Icon name="check" /> {saving ? "Saving…" : justSaved ? "Saved" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* "Approval Workflow" tab of Roles & Permissions — which stages of each
 * approval flow this business uses (backend GET/PUT /approval-workflow).
 * Who may act at a stage stays with the permission grants on the other tab;
 * this only switches stages on or off. Editing needs "can update role".
 * Saving refreshes the app-wide copy (useApprovalWorkflow) so trackers and
 * buttons elsewhere pick the change up immediately. */
export function ApprovalWorkflowSettings() {
  const { can } = useAuth();
  const { config, refresh } = useApprovalWorkflow();
  const canEdit = can("Role_Management", "can_update_role");

  return (
    <div className="card" style={{ padding: 16 }}>
      <p style={{ color: "var(--muted)", fontSize: 13, margin: "0 0 12px" }}>
        Choose which stages each approval goes through. An item moves to the next ticked stage when approved, and the last
        ticked stage carries out the action. Items already waiting at a stage you switch off can still be acted on there.
      </p>
      {!canEdit && (
        <div className="notice" style={{ marginBottom: 12 }}>
          <Icon name="shield" /> You can view the approval workflow but not change it — ask an administrator.
        </div>
      )}
      <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fill,minmax(300px,1fr))", gap: 24 }}>
        {config.map((flow) => (
          // Keyed on the flow only — the card resyncs its draft itself when
          // the saved state changes, so it stays mounted (and can show its
          // "Changes saved" confirmation) across a save.
          <FlowCard
            key={flow.key}
            flow={flow}
            canEdit={canEdit}
            onSaved={refresh}
          />
        ))}
      </div>
    </div>
  );
}
