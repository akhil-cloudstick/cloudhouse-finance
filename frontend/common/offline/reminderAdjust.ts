/* Reminders added on this PC that the server has not been sent yet. The calendar and the reminder list the screens
 * show are the server's last answer, which cannot know about them, so each waiting "add reminder" entry is added to
 * that answer, in the same shape the server will use once it is sent. When it has been sent the server's own answer
 * includes it and it is no longer in the outbox, so nothing is shown twice. */

import { offlineStore } from "@/common/services/desktopBridge";
import { listLocal } from "./localCopy";
import type { OutboxEntry } from "./types";

type ReminderBody = { customerId?: number; loanId?: number | null; type?: string; dueDate?: string; note?: string };

const EVENT_TYPE: Record<string, string> = { "Follow-Up": "FollowUp", "Promise-to-Pay": "PromiseToPay", Custom: "Custom" };

function customerName(id: number): string {
  const c = listLocal("customers").find((r) => r.id === id) as { name?: string } | undefined;
  return c?.name || "—";
}

async function waiting(): Promise<{ entry: OutboxEntry; body: ReminderBody }[]> {
  const found: { entry: OutboxEntry; body: ReminderBody }[] = [];
  for (const line of await offlineStore.readAllOutbox().catch(() => [] as string[])) {
    try {
      const entry = JSON.parse(line) as OutboxEntry;
      const body = (entry.body ?? {}) as ReminderBody;
      if (entry.method === "POST" && entry.path === "/reminders" && body.dueDate && body.customerId) found.push({ entry, body });
    } catch {
      /* a line that cannot be read adds nothing */
    }
  }
  return found;
}

type Change = { id: number; kind: "done" | "delete" | "edit"; body: ReminderBody };

/* Waiting changes to reminders the server already has (mark done, delete, edit), oldest first. */
async function changes(): Promise<Change[]> {
  const found: Change[] = [];
  for (const line of await offlineStore.readAllOutbox().catch(() => [] as string[])) {
    try {
      const entry = JSON.parse(line) as OutboxEntry;
      const m = /^\/reminders\/(\d+)(\/complete)?$/.exec(entry.path.split("?")[0]);
      if (!m) continue;
      const id = Number(m[1]);
      if (entry.method === "DELETE") found.push({ id, kind: "delete", body: {} });
      else if (entry.method === "PUT" && m[2]) found.push({ id, kind: "done", body: {} });
      else if (entry.method === "PUT") found.push({ id, kind: "edit", body: (entry.body ?? {}) as ReminderBody });
    } catch {
      /* a line that cannot be read changes nothing */
    }
  }
  return found;
}

/* Applies the waiting changes to one row of the server's answer; null means the row is gone. */
function applyChanges<T extends { status?: string; dueDate?: string; note?: string; type?: string; date?: string; detail?: string }>(row: T, id: number, list: Change[], calendar: boolean): T | null {
  let next: T | null = row;
  for (const c of list) {
    if (c.id !== id || !next) continue;
    if (c.kind === "delete") return null;
    if (c.kind === "done") next = { ...next, status: "Done" };
    else {
      next = { ...next, ...(c.body.note !== undefined ? (calendar ? { detail: c.body.note } : { note: c.body.note }) : {}), ...(c.body.dueDate ? (calendar ? { date: c.body.dueDate } : { dueDate: c.body.dueDate }) : {}) };
    }
  }
  return next;
}

/* GET /reminders/calendar?from&to: the waiting reminders that fall inside the dates asked for become events. */
export async function adjustCalendar(path: string, body: string): Promise<string> {
  const qs = new URLSearchParams(path.includes("?") ? path.slice(path.indexOf("?") + 1) : "");
  const from = qs.get("from") ?? "";
  const to = qs.get("to") ?? "";
  let env: { data?: unknown };
  try {
    env = JSON.parse(body) as { data?: unknown };
  } catch {
    return body;
  }
  // the dashboard's paged variant is an {events} envelope, which a waiting reminder is not added to
  if (!Array.isArray(env.data)) return body;
  const extra = (await waiting())
    .filter(({ body: b }) => (!from || (b.dueDate as string) >= from) && (!to || (b.dueDate as string) <= to))
    .map(({ body: b }) => {
      const name = customerName(Number(b.customerId));
      return {
        date: b.dueDate,
        type: EVENT_TYPE[b.type ?? "Custom"] ?? "Custom",
        title: `${b.type ?? "Reminder"} — ${name}`,
        detail: b.note || "",
        customerId: b.customerId,
        customerName: name,
        status: "Pending",
      };
    });
  const list = await changes();
  const base = list.length
    ? (env.data as { reminderId?: number }[]).map((e) => (e.reminderId != null ? applyChanges(e as never, e.reminderId, list, true) : e)).filter((e) => e !== null)
    : env.data;
  if (!extra.length && !list.length) return body;
  return JSON.stringify({ ...env, data: [...base, ...extra] });
}

/* GET /reminders: the waiting reminders are listed as pending ones. */
export async function adjustReminders(body: string): Promise<string> {
  let env: { data?: unknown };
  try {
    env = JSON.parse(body) as { data?: unknown };
  } catch {
    return body;
  }
  if (!Array.isArray(env.data)) return body;
  const extra = (await waiting()).map(({ entry, body: b }) => ({
    id: 0,
    customerId: b.customerId,
    customer: { id: b.customerId, name: customerName(Number(b.customerId)), code: "", phone: "" },
    loanId: b.loanId ?? null,
    type: b.type ?? "Custom",
    dueDate: b.dueDate,
    note: b.note || "",
    status: "Pending",
    createdAt: entry.occurredAt,
    updatedAt: entry.occurredAt,
  }));
  const list = await changes();
  const base = list.length
    ? (env.data as { id: number }[]).map((r) => applyChanges(r as never, r.id, list, false)).filter((r) => r !== null)
    : env.data;
  return extra.length || list.length ? JSON.stringify({ ...env, data: [...base, ...extra] }) : body;
}
