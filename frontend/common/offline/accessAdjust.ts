/* Employees, roles, permission matrices and approval chains changed on this PC and not sent yet. The screens show the server's last
 * answer; the entries still waiting in the outbox are applied on top of it, in the shape the server will use, so nothing else is stored.
 *
 * - An employee / role made here is listed under a local (negative) id. An employee names its role by NAME, and an approval chain
 *   names a role made here by "role-ref:<entry id>", so a negative id is never sent inside another entry.
 * - A waiting edit is merged into the row; a waiting delete removes it.
 * - A role's matrix (one answer per role) gets its waiting saves applied with the server's own rules (a switched-off permission takes
 *   everything under it off with it). A role made here starts with every permission granted, as the server makes it.
 * - The approval chains (/approval-workflow/categories and /approval-workflow) show the waiting chains, so the offline approval screens
 *   use the new ones.
 * Once an entry is sent it leaves the outbox and the server's own answer includes it, so nothing is shown twice. */

import { localRequestId, ROLE_REF } from "./requestRef";
import { bare, holderOf, num, parse, queryOf, waitingEntries, type Envelope, type Recall, type Row } from "./setupAdjust";
import type { OutboxEntry } from "./types";

const API = "(?:\\/users\\/\\d+)?";
const ROLES = new RegExp(`^${API}\\/roles$`);
const ROLE_ONE = new RegExp(`^${API}\\/roles\\/(-?\\d+)$`);
const EMP = new RegExp(`^${API}\\/employees(?:\\/(-?\\d+))?$`);
const MATRIX = new RegExp(`^${API}\\/employees\\/\\d+\\/permissions$`);
const MATRIX_WRITE = new RegExp(`^${API}\\/employees\\/\\d+\\/permissions\\/(-?\\d+|ref:[0-9a-f-]+)(\\/set-all)?$`);
const WORKFLOW = new RegExp(`^${API}\\/approval-workflow$`);
const CATEGORIES = new RegExp(`^${API}\\/approval-workflow\\/categories$`);
const CATEGORY_WRITE = new RegExp(`^${API}\\/approval-workflow\\/categories\\/([a-z_]+)$`);

const isWrite = (e: OutboxEntry) => e.method === "PUT" || e.method === "PATCH";
export const createsRoleEntry = (e: Pick<OutboxEntry, "method" | "path">) => e.method === "POST" && ROLES.test(bare(e.path));
export const createsEmployeeEntry = (e: Pick<OutboxEntry, "method" | "path">) => e.method === "POST" && /^(?:\/users\/\d+)?\/employees$/.test(bare(e.path));

const prefixOf = (path: string) => /^(\/users\/\d+)/.exec(path)?.[1] ?? "";
// everything but the employee list is the business's own, kept once whichever branch is picked (readCache BRANCH_FREE)
const BRANCH_FREE_VIEW = "{}";

function rowsOf(env: Envelope | null): Row[] | null {
  const h = env ? holderOf(env) : null;
  return h ? h.rows : null;
}

/* ---- roles ---- */

type RoleBody = { name?: string; description?: string; isActive?: boolean };

function roleFromCreate(e: OutboxEntry): Row {
  const b = (e.body ?? {}) as RoleBody;
  return { id: localRequestId(e.id), name: String(b.name ?? "").trim(), description: b.description ?? "", isActive: true, isSystem: false, createdAt: e.occurredAt, updatedAt: e.occurredAt };
}

/* The row after the waiting edits; null when a waiting delete removes it. */
function applyRoleEdits(row: Row, id: number, entries: OutboxEntry[]): Row | null {
  let next = row;
  for (const e of entries) {
    const m = ROLE_ONE.exec(bare(e.path));
    if (!m || Number(m[1]) !== id) continue;
    if (e.method === "DELETE") return null;
    if (!isWrite(e)) continue;
    const b = (e.body ?? {}) as RoleBody;
    next = {
      ...next,
      ...(b.name !== undefined ? { name: String(b.name).trim() } : {}),
      ...(b.description !== undefined ? { description: b.description } : {}),
      ...(b.isActive !== undefined ? { isActive: !!b.isActive } : {}),
    };
  }
  return next;
}

function adjustRoles(cached: string | null, entries: OutboxEntry[]): string | null {
  const touched = entries.some((e) => (isWrite(e) || e.method === "DELETE") && ROLE_ONE.test(bare(e.path)));
  const creates = entries.filter(createsRoleEntry);
  if (!cached || (!touched && !creates.length)) return cached;
  const env = parse(cached);
  const h = env ? holderOf(env) : null;
  if (!env || !h) return cached;
  const rows: Row[] = [];
  for (const r of h.rows) {
    const next = applyRoleEdits(r, num(r.id), entries);
    if (next) rows.push(next);
  }
  const added = creates.map((e) => applyRoleEdits(roleFromCreate(e), localRequestId(e.id), entries)).filter((r): r is Row => r !== null);
  const all = [...rows, ...added].sort((a, b) => String(a.name).localeCompare(String(b.name)));
  return JSON.stringify(h.put(all, added.length - (h.rows.length - rows.length)));
}

/* Every role as the screens now see it (the server's list with the waiting changes), by id. Empty when no list was ever kept. */
export async function rolesById(path: string, recall: Recall, entries: OutboxEntry[]): Promise<Map<number, Row>> {
  const out = new Map<number, Row>();
  const body = await recall(`${prefixOf(path)}/roles`, BRANCH_FREE_VIEW).catch(() => null);
  const adjusted = adjustRoles(body, entries);
  for (const r of (adjusted && rowsOf(parse(adjusted))) || []) out.set(num(r.id), r);
  return out;
}

/* ---- permission matrix ---- */

type PermRef = { permissionId?: number; granted?: boolean };
type PermRow = Row & { permissionId?: number; permission?: boolean; permissions?: { name?: string }; parents?: PermRef[]; dependents?: PermRef[]; soft_parents?: PermRef[]; softParents?: PermRef[]; roleId?: number };
type Matrix = Record<string, PermRow[]>;

function roleTarget(token: string): number {
  return token.startsWith("ref:") ? localRequestId(token.slice(4)) : Number(token);
}

/* The matrix of a role made on this PC: every permission of another role's matrix (the catalogue and its hierarchy are the same), all granted. */
async function templateMatrix(path: string, recall: Recall, roles: Map<number, Row>): Promise<Matrix | null> {
  for (const id of roles.keys()) {
    if (id <= 0) continue;
    const body = await recall(path.replace(/role_id=-?\d+/, `role_id=${id}`), BRANCH_FREE_VIEW).catch(() => null);
    const env = body ? parse(body) : null;
    if (env && env.data && typeof env.data === "object" && !Array.isArray(env.data)) return env.data as Matrix;
  }
  return null;
}

async function adjustMatrix(path: string, cached: string | null, entries: OutboxEntry[], recall: Recall): Promise<string | null> {
  const q = queryOf(path);
  const roleId = Number(q.get("role_id"));
  if (!Number.isFinite(roleId) || roleId === 0) return cached;
  const writes = entries.filter((e) => isWrite(e) && MATRIX_WRITE.test(bare(e.path)) && roleTarget(MATRIX_WRITE.exec(bare(e.path))![1]) === roleId);
  const roles = await rolesById(path, recall, entries);
  const mine = roles.get(roleId);
  const madeHere = entries.some((e) => createsRoleEntry(e) && localRequestId(e.id) === roleId);
  const env = cached ? parse(cached) : null;
  let data: Matrix | null = env && env.data && typeof env.data === "object" && !Array.isArray(env.data) ? (env.data as Matrix) : null;
  let base: Envelope | null = env;
  if (madeHere) {
    const template = await templateMatrix(path, recall, roles);
    if (!template) return cached;
    data = Object.fromEntries(Object.entries(template).map(([m, rows]) => [m, rows.map((r) => ({ ...r, id: 0, roleId, permission: true }))]));
    base = { success: true, data };
  }
  if (!base || !data) return cached;
  const roleChanged = !!mine && !!base.role && typeof base.role === "object" && (["name", "description", "isActive"] as const).some((k) => (base!.role as Row)[k] !== mine[k]);
  if (!writes.length && !madeHere && !roleChanged) return cached;

  // the state of every permission, then each waiting save on it, in order
  const all = Object.values(data).flat();
  const state = new Map<number, boolean>();
  const dependents = new Map<number, number[]>();
  for (const r of all) {
    const id = num(r.permissionId);
    state.set(id, !!r.permission);
    dependents.set(id, (r.dependents ?? []).map((d) => num(d.permissionId)));
  }
  for (const w of writes) {
    if (/\/set-all$/.test(bare(w.path))) {
      const on = queryOf(w.path).get("permission") === "true";
      for (const id of state.keys()) state.set(id, on);
      continue;
    }
    const updates = (Array.isArray(w.body) ? w.body : []) as { permission_id?: number; permissionId?: number; permission?: boolean }[];
    const ids = updates.map((u) => num(u.permission_id ?? u.permissionId));
    updates.forEach((u, i) => state.set(ids[i], !!u.permission));
    updates.forEach((u, i) => {
      if (!u.permission) for (const d of dependents.get(ids[i]) ?? []) state.set(d, false);
    });
  }
  const needle = (q.get("search") || "").trim().toLowerCase();
  const refresh = (refs?: PermRef[]) => refs?.map((p) => (state.has(num(p.permissionId)) ? { ...p, granted: state.get(num(p.permissionId)) } : p));
  const next: Matrix = {};
  for (const [module, rows] of Object.entries(data)) {
    const kept = rows
      .filter((r) => !needle || String(r.permissions?.name ?? "").toLowerCase().includes(needle))
      .map((r) => ({
        ...r,
        permission: state.get(num(r.permissionId)) ?? r.permission,
        ...(r.parents ? { parents: refresh(r.parents) } : {}),
        ...(r.dependents ? { dependents: refresh(r.dependents) } : {}),
        ...(r.soft_parents ? { soft_parents: refresh(r.soft_parents) } : {}),
        ...(r.softParents ? { softParents: refresh(r.softParents) } : {}),
      }));
    if (kept.length) next[module] = kept;
  }
  const role = mine ? { ...((base.role as Row | undefined) ?? {}), ...mine } : base.role;
  return JSON.stringify({ ...base, role, data: next });
}

/* ---- employees ---- */

type EmployeeBody = { name?: string; role?: string; branchId?: number; phone?: string; username?: string; loansProcessed?: number; collections?: number; followups?: number; pending?: number };

async function branchNameOf(path: string, recall: Recall): Promise<(id: number) => string> {
  const names = new Map<number, string>();
  const body = await recall(`${prefixOf(path)}/branches`, BRANCH_FREE_VIEW).catch(() => null);
  for (const r of (body && rowsOf(parse(body))) || []) names.set(num(r.id), String(r.name ?? ""));
  return (id) => names.get(id) ?? "";
}

function employeeFromCreate(e: OutboxEntry, branchName: (id: number) => string, roles: Map<number, Row>): Row {
  const b = (e.body ?? {}) as EmployeeBody;
  const role = String(b.role ?? "");
  const roleRow = [...roles.values()].find((r) => r.name === role);
  const branchId = num(b.branchId);
  return {
    id: localRequestId(e.id),
    code: "Pending",
    name: String(b.name ?? "").trim(),
    role,
    ...(roleRow ? { roleId: roleRow.id } : {}),
    branchId,
    branch: { id: branchId, name: branchName(branchId) },
    phone: String(b.phone ?? ""),
    ...(b.username ? { username: String(b.username) } : {}),
    loansProcessed: 0,
    collections: 0,
    followups: 0,
    pending: 0,
    createdAt: e.occurredAt,
    updatedAt: e.occurredAt,
  };
}

const EMP_ONE = new RegExp(`^${API}\\/employees\\/(-?\\d+)$`);

function applyEmployeeEdits(row: Row, id: number, entries: OutboxEntry[], branchName: (id: number) => string, roles: Map<number, Row>): Row | null {
  let next = row;
  for (const e of entries) {
    const m = EMP_ONE.exec(bare(e.path));
    if (!m || Number(m[1]) !== id) continue;
    if (e.method === "DELETE") return null;
    if (!isWrite(e)) continue;
    const b = (e.body ?? {}) as EmployeeBody;
    const roleRow = b.role !== undefined ? [...roles.values()].find((r) => r.name === b.role) : undefined;
    next = {
      ...next,
      ...(b.name !== undefined ? { name: String(b.name).trim() } : {}),
      ...(b.role !== undefined ? { role: b.role, ...(roleRow ? { roleId: roleRow.id } : {}) } : {}),
      ...(b.branchId ? { branchId: b.branchId, branch: { ...((next.branch as Row | undefined) ?? {}), id: b.branchId, name: branchName(b.branchId) || (next.branch as Row | undefined)?.name } } : {}),
      ...(b.phone !== undefined ? { phone: String(b.phone) } : {}),
      // the server changes the username only when one is given
      ...(b.username && String(b.username).trim() ? { username: String(b.username).trim() } : {}),
      ...(typeof b.loansProcessed === "number" ? { loansProcessed: b.loansProcessed } : {}),
      ...(typeof b.collections === "number" ? { collections: b.collections } : {}),
      ...(typeof b.followups === "number" ? { followups: b.followups } : {}),
      ...(typeof b.pending === "number" ? { pending: b.pending } : {}),
    };
  }
  return next;
}

function matchesWords(row: Row, words: string[]): boolean {
  const text = `${row.name} ${row.code} ${row.phone} ${row.username ?? ""} ${row.email ?? ""} ${row.role} ${(row.branch as Row | undefined)?.name ?? ""}`.toLowerCase();
  return words.every((w) => text.includes(w));
}

async function adjustEmployees(path: string, cached: string | null, entries: OutboxEntry[], recall: Recall): Promise<string | null> {
  const m = EMP.exec(bare(path));
  if (!m) return cached;
  const creates = entries.filter(createsEmployeeEntry);
  const touched = entries.some((e) => (isWrite(e) || e.method === "DELETE") && EMP_ONE.test(bare(e.path)));
  if (!touched && !creates.length) return cached;
  const roles = await rolesById(path, recall, entries);
  const names = await branchNameOf(path, recall);
  // one employee
  if (m[1] !== undefined) {
    const id = Number(m[1]);
    if (id < 0) {
      const e = creates.find((c) => localRequestId(c.id) === id);
      if (!e) return cached;
      const row = applyEmployeeEdits(employeeFromCreate(e, names, roles), id, entries, names, roles);
      return row ? JSON.stringify({ success: true, data: row }) : cached;
    }
    const env = cached ? parse(cached) : null;
    if (!env || !env.data || typeof env.data !== "object" || Array.isArray(env.data)) return cached;
    const row = applyEmployeeEdits(env.data as Row, id, entries, names, roles);
    return row ? JSON.stringify({ ...env, data: row }) : cached;
  }
  // the list
  const q = queryOf(path);
  const env = cached ? parse(cached) : null;
  const h = env ? holderOf(env) : null;
  if (!env || !h) return cached;
  const roleWanted = (q.get("role") || "").split(",").map((s) => s.trim()).filter(Boolean);
  const branchWanted = (q.get("branchId") || q.get("branch_id") || "").split(",").map((s) => s.trim()).filter(Boolean);
  const words = (q.get("search") || q.get("q") || "").trim().toLowerCase().split(/\s+/).filter(Boolean);
  const wanted = (r: Row) => (!roleWanted.length || roleWanted.includes(String(r.role))) && (!branchWanted.length || branchWanted.includes(String(r.branchId)));
  let removed = 0;
  const rows: Row[] = [];
  for (const r of h.rows) {
    const next = applyEmployeeEdits(r, num(r.id), entries, names, roles);
    if (!next) removed += 1;
    else if (wanted(next) && matchesWords(next, words)) rows.push(next);
    else removed += 1;
  }
  const added = creates
    .map((e) => applyEmployeeEdits(employeeFromCreate(e, names, roles), localRequestId(e.id), entries, names, roles))
    .filter((r): r is Row => r !== null && wanted(r) && matchesWords(r, words));
  // an added row belongs on the first page only
  const first = !(num(q.get("offset")) > 0);
  return JSON.stringify(h.put(first ? [...rows, ...added] : rows, (first ? added.length : 0) - removed));
}

/* ---- approval chains ---- */

type ChainRole = { roleId: number; name: string; active: boolean };
type CategoryBody = { shared?: boolean; steps?: (number | string)[]; flows?: Record<string, (number | string)[]> };

function stepsOf(ids: (number | string)[] | undefined, roles: Map<number, Row>): ChainRole[] {
  const out: ChainRole[] = [];
  for (const raw of ids ?? []) {
    const id = typeof raw === "string" && raw.startsWith(ROLE_REF) ? localRequestId(raw.slice(ROLE_REF.length)) : Number(raw);
    const r = roles.get(id);
    // the server leaves out a role it no longer has
    if (r) out.push({ roleId: id, name: String(r.name ?? ""), active: r.isActive !== false });
  }
  return out;
}

type FlowRow = Row & { key?: string; steps?: ChainRole[] };
type CategoryRow = Row & { key?: string; shared?: boolean; sharedSteps?: ChainRole[]; flows?: FlowRow[] };

function applyCategoryWrites(c: CategoryRow, entries: OutboxEntry[], roles: Map<number, Row>): { row: CategoryRow; changed: boolean } {
  let row = c;
  let changed = false;
  for (const e of entries) {
    const m = CATEGORY_WRITE.exec(bare(e.path));
    if (!m || !isWrite(e) || m[1] !== c.key) continue;
    changed = true;
    const b = (e.body ?? {}) as CategoryBody;
    const flows = row.flows ?? [];
    const shared = !!b.shared && flows.length > 1;
    if (shared) row = { ...row, shared: true, sharedSteps: stepsOf(b.steps, roles) };
    else row = { ...row, shared: false, flows: flows.map((f) => (b.flows && f.key && b.flows[f.key] ? { ...f, steps: stepsOf(b.flows[f.key], roles) } : f)) };
  }
  return { row, changed };
}

function adjustCategoryList(cached: string | null, entries: OutboxEntry[], roles: Map<number, Row>): { body: string | null; changed: Set<string> } {
  const changed = new Set<string>();
  const env = cached ? parse(cached) : null;
  if (!env || !Array.isArray(env.data)) return { body: cached, changed };
  const rows = (env.data as CategoryRow[]).map((c) => {
    const r = applyCategoryWrites(c, entries, roles);
    if (r.changed && c.key) changed.add(c.key);
    return r.row;
  });
  return { body: changed.size ? JSON.stringify({ ...env, data: rows }) : cached, changed };
}

async function adjustWorkflow(path: string, cached: string | null, entries: OutboxEntry[], recall: Recall): Promise<string | null> {
  const env = cached ? parse(cached) : null;
  if (!env || !Array.isArray(env.data)) return cached;
  const roles = await rolesById(path, recall, entries);
  const cats = await recall(`${prefixOf(path)}/approval-workflow/categories`, BRANCH_FREE_VIEW).catch(() => null);
  const adjusted = adjustCategoryList(cats, entries, roles);
  const list = adjusted.body ? parse(adjusted.body) : null;
  if (!list || !Array.isArray(list.data) || !adjusted.changed.size) return cached;
  const flows = (env.data as Row[]).map((f) => {
    const cat = (list.data as CategoryRow[]).find((c) => c.key === f.category);
    if (!cat || !cat.key || !adjusted.changed.has(cat.key)) return f;
    const steps = cat.shared && (cat.flows?.length ?? 0) > 1 ? cat.sharedSteps : cat.flows?.find((x) => x.key === f.key)?.steps;
    if (!steps) return f;
    // like the server's chain, only roles that are active take a step
    const stages = steps
      .filter((s) => s.active)
      .map((s) => ({ key: `R${s.roleId}`, pending: `R${s.roleId}`, label: s.name, role: s.name, roleId: s.roleId, permission: "", module: String(f.label ?? ""), defaultEnabled: true, enabled: true }));
    return { ...f, stages };
  });
  return JSON.stringify({ ...env, data: flows });
}

/* Applies what is waiting in the outbox to a cached answer; anything that is not one of these reads comes back unchanged. */
export async function adjustAccess(path: string, cached: string | null, recall: Recall): Promise<string | null> {
  const p = bare(path);
  const kind = ROLES.test(p) ? "roles" : MATRIX.test(p) ? "matrix" : EMP.test(p) ? "employees" : CATEGORIES.test(p) ? "categories" : WORKFLOW.test(p) ? "workflow" : "";
  if (!kind) return cached;
  const entries = await waitingEntries();
  if (!entries.length) return cached;
  if (kind === "roles") return adjustRoles(cached, entries);
  if (kind === "matrix") return adjustMatrix(path, cached, entries, recall);
  if (kind === "employees") return adjustEmployees(path, cached, entries, recall);
  if (kind === "workflow") return adjustWorkflow(path, cached, entries, recall);
  return adjustCategoryList(cached, entries, await rolesById(path, recall, entries)).body;
}
