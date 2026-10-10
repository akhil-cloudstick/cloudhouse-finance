"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useToast } from "@/common/components/ToastProvider";
import { Icon } from "@/common/components/Icon";
import { useAuth, useApprovalWorkflow } from "@/common/providers/AuthProvider";
import { ApiError } from "@/common/services/httpClient";
import { fetchRoles } from "@/common/services/permissionService";
import { fetchApprovalCategories, updateApprovalCategory } from "@/common/services/approvalWorkflowService";
import { type CategoryView, type ChainRole } from "@/common/types/approval-workflow-types";
import { RoleChain } from "@/modules/roles/components/RoleChain";

/* A category's editable state: its mode, the shared chain, and each flow's
 * own chain. Both kinds are kept so switching mode back and forth never
 * loses what was set up in the other. */
type Draft = { shared: boolean; steps: ChainRole[]; flows: Record<string, ChainRole[]> };

function draftOf(c: CategoryView): Draft {
  return { shared: c.shared, steps: c.sharedSteps, flows: Object.fromEntries(c.flows.map((f) => [f.key, f.steps])) };
}

const ids = (steps: ChainRole[]) => steps.map((s) => s.roleId).join(",");

function sameDraft(a: Draft, b: Draft): boolean {
  if (a.shared !== b.shared) return false;
  if (a.shared) return ids(a.steps) === ids(b.steps);
  return Object.keys(a.flows).every((k) => ids(a.flows[k] || []) === ids(b.flows[k] || []));
}

function chainError(steps: ChainRole[], min: number, max: number): string {
  if (steps.length < min) return `needs at least ${min} approver`;
  if (max > 0 && steps.length > max) return `allows at most ${max} approver`;
  if (steps.some((s) => !s.active)) return "has an inactive role — remove it";
  return "";
}

/* "Approval Workflow" tab of Roles & Permissions. Flows are grouped into
 * categories (Gold Loan, Personal Loan, Auction, Expense); each flow's
 * approvers are an ordered chain of this business's own roles. A category
 * with several actions can use one chain for all of them or a separate
 * chain per action. Only a step's role (or Administrator) can approve it.
 * Viewing needs "can view role and permission", editing "can update role".
 * Saving refreshes the app-wide copy (useApprovalWorkflow) so trackers and
 * buttons elsewhere pick the change up immediately. */
export function ApprovalWorkflowSettings() {
  const { can } = useAuth();
  const { refresh } = useApprovalWorkflow();
  const toast = useToast();
  const canEdit = can("Role_Management", "can_update_role");

  const [categories, setCategories] = useState<CategoryView[] | null>(null);
  const [roles, setRoles] = useState<ChainRole[]>([]);
  const [loadErr, setLoadErr] = useState("");
  const [activeKey, setActiveKey] = useState<string>("");
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const [justSaved, setJustSaved] = useState(false);
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (savedTimer.current) clearTimeout(savedTimer.current); }, []);

  useEffect(() => {
    let alive = true;
    Promise.all([fetchApprovalCategories(), fetchRoles()])
      .then(([cats, rs]) => {
        if (!alive) return;
        setCategories(cats);
        setDrafts(Object.fromEntries(cats.map((c) => [c.key, draftOf(c)])));
        setActiveKey((k) => k || cats[0]?.key || "");
        // Administrator can always approve every step, so it is never
        // offered as a chain member.
        setRoles(
          (rs || [])
            .filter((r) => r.isActive && !r.isSystem)
            .map((r) => ({ roleId: r.id, name: r.name, active: true })),
        );
      })
      .catch((e) => alive && setLoadErr(e instanceof ApiError ? e.message : "Could not load the approval workflow."));
    return () => { alive = false; };
  }, []);

  const category = categories?.find((c) => c.key === activeKey) ?? null;
  const draft = category ? drafts[category.key] : null;
  const dirtyKeys = useMemo(
    () => new Set((categories || []).filter((c) => drafts[c.key] && !sameDraft(drafts[c.key], draftOf(c))).map((c) => c.key)),
    [categories, drafts],
  );
  const dirty = !!category && dirtyKeys.has(category.key);
  const multi = !!category && category.flows.length > 1;
  const shared = !!draft && multi && draft.shared;

  // The first rule a chain breaks, named after the chain — Save stays off
  // until there is none.
  const invalid = useMemo(() => {
    if (!category || !draft) return "";
    if (shared) {
      const e = chainError(draft.steps, category.minEnabled, category.maxSteps);
      return e ? `The ${category.label} chain ${e}.` : "";
    }
    for (const f of category.flows) {
      const e = chainError(draft.flows[f.key] || [], f.minEnabled, f.maxSteps);
      if (e) return `${f.actionLabel} ${e}.`;
    }
    return "";
  }, [category, draft, shared]);

  function patch(p: Partial<Draft>) {
    if (!category) return;
    setDrafts((d) => ({ ...d, [category.key]: { ...d[category.key], ...p } }));
    setErr("");
    setJustSaved(false);
  }

  function discard() {
    if (!category) return;
    setDrafts((d) => ({ ...d, [category.key]: draftOf(category) }));
    setErr("");
  }

  async function save() {
    if (!category || !draft || !dirty || invalid) return;
    setSaving(true);
    setErr("");
    try {
      const body = shared
        ? { shared: true, steps: draft.steps.map((s) => s.roleId) }
        : { shared: false, flows: Object.fromEntries(category.flows.map((f) => [f.key, (draft.flows[f.key] || []).map((s) => s.roleId)])) };
      const saved = await updateApprovalCategory(category.key, body);
      setCategories((cs) => (cs || []).map((c) => (c.key === saved.key ? saved : c)));
      setDrafts((d) => ({ ...d, [saved.key]: draftOf(saved) }));
      toast(`${saved.label} approval workflow saved`);
      setJustSaved(true);
      if (savedTimer.current) clearTimeout(savedTimer.current);
      savedTimer.current = setTimeout(() => setJustSaved(false), 2500);
      await refresh();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Could not save — try again.");
    } finally {
      setSaving(false);
    }
  }

  if (loadErr) return <div className="card" style={{ padding: 16 }}><div className="notice"><Icon name="warning" /> {loadErr}</div></div>;
  if (!categories || !category || !draft) return <div key="loading" className="card wf-loading">Loading approval workflow…</div>;

  return (
    <div key="ready" className="card wf">
      <div className="wf-layout">
        <nav className="wf-rail" aria-label="Approval categories">
          {categories.map((c) => (
            <button
              key={c.key}
              type="button"
              className={`wf-rail-item${c.key === category.key ? " on" : ""}`}
              onClick={() => { setActiveKey(c.key); setErr(""); setJustSaved(false); }}
            >
              <span className="wf-rail-label">{c.label}</span>
              {dirtyKeys.has(c.key) ? (
                <span className="wf-rail-dot" title="Unsaved changes" />
              ) : (
                <span className="wf-rail-count">{c.flows.length}</span>
              )}
            </button>
          ))}
        </nav>

        <section className="wf-panel">
          <header className="wf-head">
            <div className="wf-head-text">
              <h3>{category.label}</h3>
              <p>{category.description}</p>
            </div>
            {multi && (
              <div className="wf-seg" role="radiogroup" aria-label="Approval flow mode">
                <button type="button" role="radio" aria-checked={shared} className={shared ? "on" : ""} disabled={!canEdit} onClick={() => patch({ shared: true })}>
                  Same flow for all
                </button>
                <button type="button" role="radio" aria-checked={!shared} className={!shared ? "on" : ""} disabled={!canEdit} onClick={() => patch({ shared: false })}>
                  Different per action
                </button>
              </div>
            )}
          </header>

          {!canEdit && (
            <div className="notice wf-notice">
              <Icon name="shield" /> You can view the approval workflow but not change it — ask an administrator.
            </div>
          )}

          <div className="wf-body">
            {shared ? (
              <div className="wf-row">
                <div className="wf-row-label">
                  <b>All actions</b>
                  <small>{category.flows.map((f) => f.actionLabel).join(" · ")}</small>
                </div>
                <RoleChain
                  steps={draft.steps}
                  roles={roles}
                  onChange={(steps) => patch({ steps })}
                  readOnly={!canEdit}
                  finalAction="completes"
                  offBehavior="each action completes immediately"
                  minEnabled={category.minEnabled}
                  maxSteps={category.maxSteps}
                />
              </div>
            ) : (
              category.flows.map((f) => (
                <div key={f.key} className="wf-row">
                  <div className="wf-row-label">
                    <b>{f.actionLabel}</b>
                    <small>Last approver {f.finalAction}</small>
                  </div>
                  <RoleChain
                    steps={draft.flows[f.key] || []}
                    roles={roles}
                    onChange={(steps) => patch({ flows: { ...draft.flows, [f.key]: steps } })}
                    readOnly={!canEdit}
                    finalAction={f.finalAction}
                    offBehavior={f.offBehavior}
                    minEnabled={f.minEnabled}
                    maxSteps={f.maxSteps}
                  />
                </div>
              ))
            )}
          </div>

          <footer className="wf-foot">
            <span className="wf-foot-msg">
              {err ? (
                <span className="wf-err">{err}</span>
              ) : invalid && dirty ? (
                <span className="wf-err">{invalid}</span>
              ) : justSaved ? (
                <span className="save-msg" role="status"><Icon name="check" /> Changes saved</span>
              ) : dirty ? (
                <span className="wf-dirty">Unsaved changes</span>
              ) : (
                <span className="wf-hint">Only the role at each step — or Administrator — can approve it.</span>
              )}
            </span>
            {canEdit && (
              <>
                <button className="btn ghost sm" onClick={discard} disabled={!dirty || saving}>Discard</button>
                <button
                  className={`btn sm save-btn${justSaved ? " saved" : ""}`}
                  onClick={save}
                  disabled={saving || (!dirty && !justSaved) || !!invalid}
                >
                  <Icon name="check" /> {saving ? "Saving…" : justSaved ? "Saved" : "Save changes"}
                </button>
              </>
            )}
          </footer>
        </section>
      </div>
    </div>
  );
}
