/* The review list: entries the server turned down when they were sent from the queue. Each one stays on this PC
 * with the server's reason, and the record it touched stays on screen marked "needs review", until an admin
 * either sends it again (Retry) or gives it up (Discard). Entries that touch the same record wait behind it. */

import { offlineStore } from "@/common/services/desktopBridge";
import { getLocal, removeLocal, upsertLocal } from "./localCopy";
import { pull, resetCursor } from "./pull";
import type { EntityName, OutboxEntry } from "./types";

export const REVIEW_CHANGED_EVENT = "app:offline-review-changed";

const ENTITIES: EntityName[] = ["loans", "customers", "schemes", "categories", "lockers"];

export type ReviewRow = {
  id: string;
  entry: OutboxEntry;
  message: string;
  attempts: number;
  createdAt: number;
  reviewAt: number;
  /** Later entries on the same record that are waiting behind this one. */
  held: number;
  /** Those later entries themselves, so the admin can see what discarding would also lose. */
  heldEntries: OutboxEntry[];
};

function changed() {
  window.dispatchEvent(new CustomEvent(REVIEW_CHANGED_EVENT));
}

function entityOf(uuid: string): EntityName | undefined {
  return ENTITIES.find((e) => getLocal(e, uuid));
}

async function flag(entry: OutboxEntry, message: string | undefined): Promise<void> {
  for (const uuid of entry.targets ?? []) {
    const entity = entityOf(uuid);
    if (entity) await upsertLocal(entity, { uuid, syncReview: message });
  }
}

/* The server refused a queued entry: park it for an admin, keep the local copy, and mark the record. */
export async function sendToReview(entry: OutboxEntry, message: string): Promise<void> {
  await offlineStore.markReview(entry.id, message);
  await flag(entry, message);
  changed();
}

export async function listReview(): Promise<ReviewRow[]> {
  const rows: ReviewRow[] = [];
  for (const line of await offlineStore.readReview()) {
    try {
      rows.push({ ...(JSON.parse(line) as ReviewRow), heldEntries: [] });
    } catch {
      /* a row that cannot be read is not shown */
    }
  }
  // the entries waiting behind each one: not in review themselves, and touching one of the same records
  const inReview = new Set(rows.map((r) => r.id));
  const others: OutboxEntry[] = [];
  for (const line of await offlineStore.readAllOutbox()) {
    try {
      const e = JSON.parse(line) as OutboxEntry;
      if (!inReview.has(e.id)) others.push(e);
    } catch {
      /* a line that cannot be read touches nothing */
    }
  }
  for (const row of rows) {
    const targets = new Set(row.entry.targets ?? []);
    row.heldEntries = others.filter((e) => (e.targets ?? []).some((t) => targets.has(t)));
  }
  return rows;
}

export async function reviewCount(): Promise<number> {
  try {
    return (await offlineStore.counts()).review ?? 0;
  } catch {
    return 0;
  }
}

/* Puts the entry back in the send queue. Its place in the order is the one it had. */
export async function retryReview(row: ReviewRow): Promise<void> {
  await offlineStore.retryReview(row.id);
  await flag(row.entry, undefined);
  changed();
  const { drain } = await import("./sender");
  void drain("review retry");
}

/* Gives the entry up, together with the later entries on the same record: they were entered on top of it, and one
 * that points at a record the server never got would be retried for ever. A record that was only ever on this PC is
 * removed; any other record goes back to what the server holds (the next pull replaces the local version). */
export async function discardReview(row: ReviewRow): Promise<void> {
  await offlineStore.deleteOutboxEntry(row.id);
  for (const held of row.heldEntries) await offlineStore.deleteOutboxEntry(held.id);
  for (const uuid of row.entry.targets ?? []) {
    const entity = entityOf(uuid);
    if (!entity) continue;
    const rec = getLocal(entity, uuid);
    if (rec && !(Number(rec.id) > 0)) await removeLocal(entity, uuid);
    else await upsertLocal(entity, { uuid, syncReview: undefined });
  }
  await resetCursor();
  offlineStore.log("warn", `entry ${row.id} ${row.entry.method} ${row.entry.path} discarded from review: ${row.message}${row.heldEntries.length ? ` (with ${row.heldEntries.map((h) => h.id).join(", ")})` : ""}`);
  changed();
  void pull("review discard");
}

/* What an entry does, in words an admin can read, from the request it will send. */
const ACTIONS: [RegExp, string][] = [
  [/^POST \/loans$/, "New loan"],
  [/^POST \/loans\/drafts/, "Loan draft saved"],
  [/^(PUT|PATCH) \/loans\/drafts/, "Loan draft edit"],
  [/^DELETE \/loans\/drafts/, "Loan draft delete"],
  [/^POST \/loans\/[^/]+\/payments?$/, "Loan payment"],
  [/^POST \/loans\/[^/]+\/approve$/, "Loan approval / disbursal"],
  [/^POST \/loans\/[^/]+\/top-?ups?$/, "Loan top-up"],
  [/^POST \/loans\/[^/]+\/extension-request$/, "Loan extension request"],
  [/^POST \/loans\/[^/]+\/release/, "Loan release request"],
  [/^DELETE \/loans\/[^/]+\/hard-delete/, "Loan permanent delete"],
  [/^(PATCH|PUT) \/loans\/[^/]+$/, "Loan edit"],
  [/^DELETE \/loans\/[^/]+/, "Loan delete"],
  [/^POST \/loans\/[^/]+\/bank-pledge/, "Bank pledge"],
  [/\/ornaments/, "Ornament change"],
  [/^POST \/packets\/[^/]+\/movements$/, "Packet movement"],
  [/^POST \/customers$/, "New customer"],
  [/^(PUT|PATCH) \/customers\/[^/]+$/, "Customer edit"],
  [/^DELETE \/customers\/[^/]+\/hard-delete/, "Customer permanent delete"],
  [/^DELETE \/customers\//, "Customer delete"],
  [/^POST \/schemes$/, "New scheme"],
  [/^(PUT|PATCH) \/schemes\//, "Scheme edit"],
  [/^DELETE \/schemes\//, "Scheme delete"],
  [/^POST \/lockers$/, "New locker"],
  [/^(PUT|PATCH|DELETE) \/lockers\//, "Locker change"],
  [/^POST \/personal-loans$/, "New personal loan"],
  [/^POST \/personal-loans\/[^/]+\/payments?$/, "Personal loan payment"],
  [/^POST \/personal-loans\/[^/]+\/approve$/, "Personal loan approval"],
  [/^POST \/personal-loans\/[^/]+\/renew$/, "Personal loan renewal"],
  [/^(PATCH|PUT|DELETE) \/personal-loans\//, "Personal loan edit"],
  [/^POST \/investment-plans/, "New investment plan"],
  [/^(PUT|PATCH) \/investment-plans/, "Investment plan edit"],
  [/^POST \/investments$/, "New investment"],
  [/^POST \/investments\/[^/]+\/(payouts?|pay-interest)/, "Investment interest payout"],
  [/^POST \/investments\/[^/]+\/mature/, "Investment maturity"],
  [/^POST \/investments\/[^/]+\/(add-cash|deposit)/, "Investment top-up"],
  [/^POST \/investments\/[^/]+\/withdraw/, "Investment withdrawal"],
  [/^POST \/investments\/[^/]+\/close/, "Investment close"],
  [/^(PATCH|PUT|DELETE) \/investments\//, "Investment edit"],
  [/^POST \/reminders/, "New reminder"],
  [/^(PUT|PATCH) \/reminders\/[^/]+\/complete/, "Reminder completed"],
  [/^(PUT|PATCH) \/reminders/, "Reminder edit"],
  [/^DELETE \/reminders/, "Reminder delete"],
  [/gold-rates/, "Gold rate"],
  [/expenses/, "Expense"],
  [/categories|cash-sources/, "New category"],
  [/cash-movements|cash\/entries|\/cash/, "Cash entry"],
];

const RESOURCE_NAMES: Record<string, string> = {
  loans: "loan", customers: "customer", schemes: "scheme", lockers: "locker", packets: "packet", investments: "investment",
  "investment-plans": "investment plan", "personal-loans": "personal loan", reminders: "reminder", expenses: "expense",
  "cash-movements": "cash entry", "gold-rates": "gold rate", banks: "bank", branches: "branch", employees: "employee",
};

/* The title an admin sees: a known action in words, otherwise "New / Edit / Delete <thing>" from the first part of
 * the path. Never the raw request path. */
export function describeEntry(entry: OutboxEntry): string {
  const key = `${entry.method} ${entry.path}`;
  const known = ACTIONS.find(([re]) => re.test(key))?.[1];
  if (known) return known;
  const first = entry.path.split("?")[0].split("/").filter(Boolean)[0] ?? "";
  const thing = RESOURCE_NAMES[first] ?? (first.replace(/-/g, " ") || "record");
  const verb = entry.method === "POST" ? "New" : entry.method === "DELETE" ? "Delete" : "Edit";
  return `${verb} ${thing}`;
}
