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
  if (!extra.length) return body;
  return JSON.stringify({ ...env, data: [...env.data, ...extra] });
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
  return extra.length ? JSON.stringify({ ...env, data: [...env.data, ...extra] }) : body;
}
