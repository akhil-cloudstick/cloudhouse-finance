/* Sign-in when the server cannot be reached. Every successful online sign-in leaves, in users.json (kept
 * protected for this Windows user by the Go side), what is needed to let the same person in again later: a salted
 * PBKDF2 hash of their password (never the password), and the sign-in response they received. A sign-in that gets
 * NO answer from the server is checked against it. A sign-in the server answers, including a refusal, is never
 * overruled by it.
 *
 * Limits worth knowing: the hash only changes at the next online sign-in, so a password changed or an employee
 * switched off on the server still opens this PC until then; and the saved token is the one issued at that
 * sign-in, so once it has expired the server asks for an online sign-in again as soon as it is reachable. */

import { offlineStore } from "@/common/services/desktopBridge";
import type { LoginResponse } from "@/common/types/auth-types";
import { offlineBusiness } from "./session";
import { offlineReady } from "./state";

const FILE = "users.json";
const ITERATIONS = 200_000;
const MAX_USERS = 25;
const MAX_TRIES = 5;
const LOCK_MS = 30_000;

type Saved = {
  business: string;
  identifier: string;
  salt: string;
  hash: string;
  iterations: number;
  response: LoginResponse;
  savedAt: number;
};

export type OfflineLoginResult =
  | { status: "ok"; response: LoginResponse }
  | { status: "wrong" }
  | { status: "unknown" }
  | { status: "locked" };

const tries = new Map<string, { count: number; lockedUntil: number }>();
let waiting: { business: string; identifier: string; password: string; response: LoginResponse } | null = null;

const norm = (s: string) => s.trim().toLowerCase();

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

async function derive(password: string, saltHex: string, iterations: number): Promise<string> {
  const salt = new Uint8Array((saltHex.match(/../g) ?? []).map((h) => parseInt(h, 16)));
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, 256);
  return toHex(new Uint8Array(bits));
}

function sameText(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/* The store is normally opened after sign-in; at the sign-in page it is opened here, but only if the user has
 * already chosen where it lives (nothing is cached before the first sign-in anyway). */
async function ensureOpen(business: string): Promise<boolean> {
  if (!offlineStore.available()) return false;
  if (offlineReady()) return true;
  try {
    if (!(await offlineStore.rootChosen())) return false;
    await offlineStore.open(business, "pc");
    return true;
  } catch {
    return false;
  }
}

async function readAll(): Promise<Saved[]> {
  try {
    const text = await offlineStore.readFile(FILE);
    const parsed = text ? (JSON.parse(text) as { users?: Saved[] }) : {};
    return Array.isArray(parsed.users) ? parsed.users : [];
  } catch {
    return [];
  }
}

async function save(business: string, identifier: string, password: string, response: LoginResponse): Promise<void> {
  const saltBytes = new Uint8Array(16);
  crypto.getRandomValues(saltBytes);
  const salt = toHex(saltBytes);
  const rec: Saved = {
    business,
    identifier: norm(identifier),
    salt,
    hash: await derive(password, salt, ITERATIONS),
    iterations: ITERATIONS,
    response,
    savedAt: Date.now(),
  };
  const others = (await readAll()).filter((u) => !(u.business === business && u.identifier === rec.identifier));
  await offlineStore.writeFile(FILE, JSON.stringify({ users: [rec, ...others].slice(0, MAX_USERS) }));
}

/* Call after every successful online sign-in. Kept in memory until the store is open when this is the PC's first
 * sign-in (the folder is chosen right after it). Never throws: failing to remember only means no offline sign-in. */
export async function rememberLogin(identifier: string, password: string, response: LoginResponse): Promise<void> {
  if (!offlineStore.available()) return;
  const business = offlineBusiness();
  try {
    if (await ensureOpen(business)) {
      await save(business, identifier, password, response);
      offlineStore.log("info", "a sign-in was saved on this PC for offline use");
    } else {
      waiting = { business, identifier, password, response };
    }
  } catch (e) {
    // the next online sign-in tries again; the log says why this one was not kept
    offlineStore.log("warn", `could not save the sign-in for offline use: ${e instanceof Error ? e.message : String(e)}`);
  }
}

/* Called once the store is open (after the first-use question), to keep the sign-in that was waiting for it. */
export async function flushRememberedLogin(): Promise<void> {
  const w = waiting;
  waiting = null;
  if (!w) return;
  try {
    await save(w.business, w.identifier, w.password, w.response);
    offlineStore.log("info", "a sign-in was saved on this PC for offline use");
  } catch (e) {
    offlineStore.log("warn", `could not save the sign-in for offline use: ${e instanceof Error ? e.message : String(e)}`);
  }
}

export async function offlineLogin(identifier: string, password: string): Promise<OfflineLoginResult> {
  const business = offlineBusiness();
  if (!(await ensureOpen(business))) return { status: "unknown" };
  const id = norm(identifier);
  const key = `${business}\n${id}`;
  const t = tries.get(key);
  if (t && t.lockedUntil > Date.now()) return { status: "locked" };
  const rec = (await readAll()).find((u) => u.business === business && u.identifier === id);
  if (!rec) {
    offlineStore.log("info", "offline sign-in refused: no sign-in was saved on this PC for that user");
    return { status: "unknown" };
  }
  const ok = sameText(await derive(password, rec.salt, rec.iterations), rec.hash);
  if (!ok) {
    const count = (t?.count ?? 0) + 1;
    tries.set(key, { count: count >= MAX_TRIES ? 0 : count, lockedUntil: count >= MAX_TRIES ? Date.now() + LOCK_MS : 0 });
    return { status: "wrong" };
  }
  tries.delete(key);
  return { status: "ok", response: rec.response };
}
