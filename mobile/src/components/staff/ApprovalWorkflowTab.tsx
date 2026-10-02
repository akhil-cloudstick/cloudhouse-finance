import React, { useMemo, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ActionsBar, Buffering, C, Card, FabMenu, NoticeBanner, PIcon, PScroll, Screen, Sheet, SheetListItem, SubTabs, Txt, toast } from "../ui";
import { useAuth } from "../../auth/AuthContext";
import { fetchRoles } from "../../api/roles";
import { fetchApprovalCategories, updateApprovalCategory, type CategoryView, type ChainRole, type UpdateCategoryInput } from "../../api/approvalWorkflow";
import { loadErrorText, userMessage } from "../../api/errors";

// Roles & Permissions → "Approval Workflow" tab — the mobile counterpart of
// the web's ApprovalWorkflowSettings. Flows are grouped into categories
// (Gold Loan, Personal Loan, Auction, Expense), switched from the corner
// button with the one on screen highlighted. Each flow's approvers are an
// ordered chain of the business's own roles; a category with several
// actions can share one chain or keep one per action. The last approver of
// a chain is highlighted — their approval performs the action. Only a
// step's role (or Administrator) can approve it. Viewing needs "can view
// role and permission", editing "can update role".

/* A category's editable state: its mode, the shared chain, and each flow's
 * own chain. Both kinds are kept so switching mode back and forth never
 * loses what was set up in the other. */
type Draft = { shared: boolean; steps: ChainRole[]; flows: Record<string, ChainRole[]> };

function draftOf(c: CategoryView): Draft {
  return { shared: c.shared, steps: c.sharedSteps ?? [], flows: Object.fromEntries(c.flows.map((f) => [f.key, f.steps ?? []])) };
}

const ids = (steps: ChainRole[]) => steps.map((s) => s.roleId).join(",");

function sameDraft(a: Draft, b: Draft): boolean {
  if (a.shared !== b.shared) return false;
  if (a.shared) return ids(a.steps) === ids(b.steps);
  return Object.keys(a.flows).every((k) => ids(a.flows[k] || []) === ids(b.flows[k] || []));
}

function chainError(steps: ChainRole[], min: number, max: number): string {
  if (steps.length < min) return `Needs at least ${min} approver.`;
  if (max > 0 && steps.length > max) return `Allows at most ${max} approver.`;
  if (steps.some((s) => !s.active)) return "Has an inactive role — remove it.";
  return "";
}

const CATEGORY_ICON: Record<string, string> = { gold_loan: "coin", personal_loan: "card", auction: "gavel", expense: "doc" };

type ChainSpec = { id: string; title: string; sub?: string; steps: ChainRole[]; min: number; max: number; offBehavior?: string };

export function ApprovalWorkflowTab({ header, tabs }: { header: React.ReactNode; tabs: React.ReactNode }) {
  const qc = useQueryClient();
  const { can } = useAuth();
  const canEdit = can("Role_Management", "can_update_role");

  const categories = useQuery({ queryKey: ["approvalWorkflow", "categories"], queryFn: fetchApprovalCategories });
  // Administrator can always approve every step, so it is never offered as
  // a chain member (same as the web).
  const roles = useQuery({ queryKey: ["roles", "chain"], queryFn: fetchRoles });
  const chainRoles: ChainRole[] = useMemo(
    () => (roles.data ?? []).filter((r) => r.isActive && !r.isSystem).map((r) => ({ roleId: r.id, name: r.name, active: true })),
    [roles.data]
  );

  const cats = useMemo(() => categories.data ?? [], [categories.data]);
  const [activeKey, setActiveKey] = useState("");
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [picking, setPicking] = useState<string | null>(null);

  const category = cats.find((c) => c.key === activeKey) ?? cats[0] ?? null;
  // A category's draft, or its saved state until it is first edited.
  const draftFor = (c: CategoryView) => drafts[c.key] ?? draftOf(c);
  const draft = category ? draftFor(category) : null;
  const isDirty = (c: CategoryView) => !!drafts[c.key] && !sameDraft(drafts[c.key], draftOf(c));
  const dirty = !!category && isDirty(category);
  const multi = !!category && category.flows.length > 1;
  const shared = !!draft && multi && draft.shared;

  const chains: ChainSpec[] = !category || !draft
    ? []
    : shared
      ? [{ id: "shared", title: "All actions", sub: category.flows.map((f) => f.actionLabel).join(" · "), steps: draft.steps, min: category.minEnabled, max: category.maxSteps }]
      : category.flows.map((f) => ({ id: f.key, title: f.actionLabel, steps: draft.flows[f.key] || [], min: f.minEnabled, max: f.maxSteps, offBehavior: f.offBehavior }));
  const invalid = chains.some((ch) => !!chainError(ch.steps, ch.min, ch.max));

  function patch(next: Partial<Draft>) {
    if (!category || !draft) return;
    setDrafts((d) => ({ ...d, [category.key]: { ...draft, ...next } }));
  }
  function setChain(id: string, steps: ChainRole[]) {
    if (!draft) return;
    if (id === "shared") patch({ steps });
    else patch({ flows: { ...draft.flows, [id]: steps } });
  }
  function move(ch: ChainSpec, i: number, by: -1 | 1) {
    const steps = [...ch.steps];
    [steps[i], steps[i + by]] = [steps[i + by], steps[i]];
    setChain(ch.id, steps);
  }
  function remove(ch: ChainSpec, i: number) {
    setChain(ch.id, ch.steps.filter((_, j) => j !== i));
  }
  // Tapping a role already in the chain takes it out; a one-approver chain
  // swaps its role instead.
  function pick(ch: ChainSpec, r: ChainRole) {
    const inChain = ch.steps.some((s) => s.roleId === r.roleId);
    if (inChain) setChain(ch.id, ch.steps.filter((s) => s.roleId !== r.roleId));
    else if (ch.max === 1) setChain(ch.id, [r]);
    else setChain(ch.id, [...ch.steps, r]);
    setPicking(null);
  }

  const save = useMutation({
    mutationFn: () => {
      const body: UpdateCategoryInput = shared
        ? { shared: true, steps: draft!.steps.map((s) => s.roleId) }
        : { shared: false, flows: Object.fromEntries(category!.flows.map((f) => [f.key, (draft!.flows[f.key] || []).map((s) => s.roleId)])) };
      return updateApprovalCategory(category!.key, body);
    },
    onSuccess: (saved) => {
      qc.setQueryData<CategoryView[]>(["approvalWorkflow", "categories"], (old) => (old ?? []).map((c) => (c.key === saved.key ? saved : c)));
      setDrafts((d) => {
        const next = { ...d };
        delete next[saved.key];
        return next;
      });
      // Trackers and approve buttons elsewhere read the flattened config.
      qc.invalidateQueries({ queryKey: ["approvalWorkflow"], predicate: (q) => q.queryKey[1] !== "categories" });
      toast.success(`${saved.label} approval workflow saved`);
    },
    onError: (e) => toast.error("Couldn't save", userMessage(e, "Could not save the approval workflow — try again.")),
  });

  function discard() {
    if (!category) return;
    setDrafts((d) => {
      const next = { ...d };
      delete next[category.key];
      return next;
    });
  }

  const pickingChain = chains.find((ch) => ch.id === picking) ?? null;
  const loadError = categories.error ? loadErrorText(categories.error) ?? "No approval workflow is set up." : null;

  return (
    <Screen
      header={header}
      floating={
        <>
          {cats.length > 1 ? (
            <FabMenu
              label="Switch category"
              raise={dirty && canEdit ? 56 : 0}
              actions={cats.map((c) => ({
                label: c.label,
                icon: CATEGORY_ICON[c.key] ?? "layers",
                active: c.key === category?.key,
                dot: isDirty(c),
                onPress: () => setActiveKey(c.key),
              }))}
            />
          ) : null}
          {dirty && canEdit ? (
            <ActionsBar
              actions={[
                { label: "Discard", onPress: discard, disabled: save.isPending },
                { label: save.isPending ? "Saving…" : "Save", icon: "check", primary: true, onPress: () => save.mutate(), disabled: save.isPending || invalid },
              ]}
            />
          ) : null}
        </>
      }
    >
      <PScroll extraBottom={dirty ? 120 : 60} refreshing={categories.isRefetching} onRefresh={() => categories.refetch()}>
        <View style={{ paddingTop: 12 }}>{tabs}</View>

        {categories.isLoading ? (
          <Buffering block />
        ) : loadError ? (
          <Txt style={st.loadErr}>{loadError}</Txt>
        ) : category && draft ? (
          <>
            <Card style={{ marginTop: 14 }}>
              <View style={st.catHead}>
                <View style={st.catIcon}>
                  <PIcon name={CATEGORY_ICON[category.key] ?? "layers"} color="#fff" />
                </View>
                <View style={{ flex: 1 }}>
                  <Txt style={st.catTitle}>{category.label}</Txt>
                  <Txt style={st.catSub}>
                    {category.flows.length} action{category.flows.length === 1 ? "" : "s"}
                  </Txt>
                </View>
              </View>
              {category.description ? <Txt style={st.catDesc}>{category.description}</Txt> : null}
              {multi ? (
                <View style={{ marginTop: 12, opacity: canEdit ? 1 : 0.6 }} pointerEvents={canEdit ? "auto" : "none"}>
                  <SubTabs
                    tabs={["shared", "per"] as const}
                    value={draft.shared ? "shared" : "per"}
                    onChange={(v) => patch({ shared: v === "shared" })}
                    labels={{ shared: "Same flow for all", per: "Different per action" }}
                  />
                </View>
              ) : null}
            </Card>

            {!canEdit ? (
              <View style={{ paddingHorizontal: 18 }}>
                <NoticeBanner>You can view the approval workflow but not change it — ask an administrator.</NoticeBanner>
              </View>
            ) : null}

            {chains.map((ch) => (
              <Chain
                key={ch.id}
                chain={ch}
                editable={canEdit}
                onUp={(i) => move(ch, i, -1)}
                onDown={(i) => move(ch, i, 1)}
                onRemove={(i) => remove(ch, i)}
                onAdd={() => setPicking(ch.id)}
              />
            ))}

            <View style={{ paddingHorizontal: 18 }}>
              <NoticeBanner>
                Only a step&apos;s role (or Administrator) can approve at that step. The highlighted approver is the last one — their approval completes the action.
              </NoticeBanner>
            </View>
          </>
        ) : (
          <Txt style={st.loadErr}>No approval workflow is set up.</Txt>
        )}
      </PScroll>

      <Sheet visible={!!pickingChain} onClose={() => setPicking(null)} title={pickingChain?.max === 1 ? "Choose approver" : "Add approver"} maxHeightPct={70}>
        {roles.isLoading ? (
          <Buffering block />
        ) : chainRoles.length === 0 ? (
          <Txt style={st.loadErr}>No active roles yet.</Txt>
        ) : (
          chainRoles.map((r, i) => {
            const idx = pickingChain ? pickingChain.steps.findIndex((s) => s.roleId === r.roleId) : -1;
            const full = !!pickingChain && pickingChain.max > 1 && pickingChain.steps.length >= pickingChain.max;
            return (
              <SheetListItem
                key={r.roleId}
                first={i === 0}
                icon="shield"
                title={r.name}
                sub={idx >= 0 ? "In this chain · tap to remove" : full ? `Chain is full (${pickingChain!.max} max)` : undefined}
                onPress={() => {
                  if (!pickingChain || (idx < 0 && full)) return;
                  pick(pickingChain, r);
                }}
                right={idx >= 0 ? <Txt style={st.stepTag}>Step {idx + 1}</Txt> : undefined}
              />
            );
          })
        )}
      </Sheet>
    </Screen>
  );
}

function Chain({
  chain,
  editable,
  onUp,
  onDown,
  onRemove,
  onAdd,
}: {
  chain: ChainSpec;
  editable: boolean;
  onUp: (i: number) => void;
  onDown: (i: number) => void;
  onRemove: (i: number) => void;
  onAdd: () => void;
}) {
  const err = chainError(chain.steps, chain.min, chain.max);
  const last = chain.steps.length - 1;
  return (
    <Card>
      <Txt style={st.chainTitle}>{chain.title}</Txt>
      {chain.sub ? <Txt style={st.chainSub}>{chain.sub}</Txt> : null}
      <View style={{ marginTop: 10 }}>
        {chain.steps.length === 0 ? (
          <Txt style={st.offNote}>{chain.offBehavior ? `No approver — ${chain.offBehavior}` : "No approver set."}</Txt>
        ) : null}
        {err && chain.steps.length > 0 ? <Txt style={st.chainErr}>{err}</Txt> : null}
        {err && chain.steps.length === 0 && chain.min > 0 ? <Txt style={st.chainErr}>{err}</Txt> : null}
        {chain.steps.map((s, i) => {
          const final = i === last;
          return (
            <View key={s.roleId} style={[st.step, final && st.stepFinal]}>
              <View style={[st.stepNum, final && { backgroundColor: C.brand }]}>
                <Txt style={st.stepNumTxt}>{i + 1}</Txt>
              </View>
              <Txt style={[st.stepName, final && { color: C.brand }, !s.active && { color: C.muted }]} numberOfLines={1}>
                {s.name}
                {s.active ? "" : " (inactive)"}
              </Txt>
              {editable ? (
                <>
                  <StepBtn icon="up" disabled={i === 0} onPress={() => onUp(i)} label={`Move ${s.name} up`} final={final} />
                  <StepBtn icon="down" disabled={i === last} onPress={() => onDown(i)} label={`Move ${s.name} down`} final={final} />
                  <StepBtn icon="close" onPress={() => onRemove(i)} label={`Remove ${s.name}`} final={final} danger />
                </>
              ) : null}
            </View>
          );
        })}
        {editable ? (
          <Pressable onPress={onAdd} style={({ pressed }) => [st.add, pressed && { opacity: 0.6 }]}>
            <Txt style={st.addTxt}>{chain.max === 1 ? (chain.steps.length ? "Change approver" : "Choose approver") : "+ Add approver"}</Txt>
          </Pressable>
        ) : null}
      </View>
    </Card>
  );
}

function StepBtn({ icon, onPress, disabled, label, final, danger }: { icon: "up" | "down" | "close"; onPress: () => void; disabled?: boolean; label: string; final?: boolean; danger?: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      hitSlop={4}
      accessibilityLabel={label}
      style={({ pressed }) => [st.stepBtn, final && { backgroundColor: C.brandFaint }, disabled && { opacity: 0.3 }, pressed && { opacity: 0.6 }]}
    >
      <View style={icon === "up" ? { transform: [{ rotate: "180deg" }] } : undefined}>
        <PIcon name={icon === "close" ? "close" : "chevdown"} color={danger ? C.red : C.muted} />
      </View>
    </Pressable>
  );
}

const st = StyleSheet.create({
  loadErr: { fontSize: 13, color: C.muted, textAlign: "center", paddingVertical: 30, paddingHorizontal: 24 },
  catHead: { flexDirection: "row", alignItems: "center", gap: 12 },
  catIcon: { width: 40, height: 40, borderRadius: 12, backgroundColor: C.brand, alignItems: "center", justifyContent: "center" },
  catTitle: { fontWeight: "700", fontSize: 15 },
  catSub: { fontSize: 11.5, color: C.muted, marginTop: 2 },
  catDesc: { fontSize: 12, color: C.muted, lineHeight: 17, marginTop: 10 },
  chainTitle: { fontWeight: "700", fontSize: 13.5 },
  chainSub: { fontSize: 11, color: C.muted, marginTop: 2 },
  offNote: { fontSize: 12, color: C.amber, backgroundColor: C.amberBg, padding: 10, borderRadius: 11, marginBottom: 8, lineHeight: 17 },
  chainErr: { fontSize: 12, color: C.red, backgroundColor: C.redBg, padding: 10, borderRadius: 11, marginBottom: 8 },
  step: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: "transparent",
    backgroundColor: C.brandFaint,
    marginBottom: 8,
  },
  // The last approver — their approval performs the action.
  stepFinal: { backgroundColor: C.card, borderColor: C.brand, shadowColor: C.brand, shadowOpacity: 0.18, shadowRadius: 6, shadowOffset: { width: 0, height: 0 }, elevation: 2 },
  stepNum: { width: 24, height: 24, borderRadius: 12, backgroundColor: C.brandMid, alignItems: "center", justifyContent: "center" },
  stepNumTxt: { color: "#fff", fontSize: 11.5, fontWeight: "700" },
  stepName: { flex: 1, fontSize: 13, fontWeight: "600" },
  stepBtn: { width: 32, height: 32, borderRadius: 9, backgroundColor: C.card, alignItems: "center", justifyContent: "center" },
  add: { borderWidth: 1.5, borderStyle: "dashed", borderColor: C.brandMid, borderRadius: 12, paddingVertical: 11, alignItems: "center" },
  addTxt: { color: C.brand, fontWeight: "600", fontSize: 12.5 },
  stepTag: { fontSize: 11, fontWeight: "700", color: C.brand, backgroundColor: C.brandPale, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, overflow: "hidden" },
});
