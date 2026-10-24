/* One entry of the outbox: the exact request the app sends today (method, path, body), plus the little
 * needed to replay it safely. */

export type Actor = { id: number; name: string; role: string };

export type OutboxEntry = {
  /** UUIDv7. Sent as X-Client-Uuid, so a resend is recognised as a duplicate. Begins with the time, so it sorts oldest first. */
  id: string;
  method: "POST" | "PATCH" | "PUT" | "DELETE";
  /** The path the app uses today, for example /loans/uuid:<uuid>/approve. */
  path: string;
  body?: unknown;
  /** When the user actually clicked, sent as X-Occurred-At. */
  occurredAt: string;
  actor: Actor;
  deviceId: string;
  /** UUIDs of the records this entry touches, so a pull never overwrites a record that still has a waiting entry. */
  targets?: string[];
  /** For a decision on a loan request: what the request looks like once this entry is applied (never sent to the server).
   *  The request lists show it while the entry waits, so a closed request does not come back as open. */
  view?: Record<string, unknown>;
};

/** "schemes" holds only schemes made on this PC that the server has not accepted yet. */
export type EntityName = "loans" | "customers" | "schemes" | "categories" | "lockers";

/** A record in the local copy. Always carries the UUID the PC knows it by. */
export type LocalRecord = { uuid: string } & Record<string, unknown>;

export type PullPayload = {
  loans: LocalRecord[];
  customers: LocalRecord[];
  deleted: { loans: string[]; customers: string[] };
  cursor: string;
};
