import * as SecureStore from "expo-secure-store";

// Persists the two read-state watermarks NotificationsContext keeps
// (lastSeenAt for the bell badge, lastViewedAt for the list's "NEW" tags) so
// they survive an app restart or a fresh login on the same device — before
// this, both lived only in React state (see NotificationsContext.tsx's old
// doc comment), so every cold start/re-login reset them to null and made
// every notification the customer had already seen look unread again.
//
// Device-scoped, not per-customer, same as tokenStorage.ts's single-key
// session token — this app supports one signed-in customer per device at a
// time. clearWatermarks() is called on sign-out so a different customer
// logging in on the same device doesn't inherit the previous customer's
// read state.
const SEEN_KEY = "ambikacustomer_notif_last_seen_at";
const VIEWED_KEY = "ambikacustomer_notif_last_viewed_at";

async function load(key: string): Promise<Date | null> {
  const raw = await SecureStore.getItemAsync(key);
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

async function save(key: string, value: Date): Promise<void> {
  await SecureStore.setItemAsync(key, value.toISOString());
}

export async function loadLastSeenAt(): Promise<Date | null> {
  return load(SEEN_KEY);
}

export async function saveLastSeenAt(value: Date): Promise<void> {
  await save(SEEN_KEY, value);
}

export async function loadLastViewedAt(): Promise<Date | null> {
  return load(VIEWED_KEY);
}

export async function saveLastViewedAt(value: Date): Promise<void> {
  await save(VIEWED_KEY, value);
}

export async function clearWatermarks(): Promise<void> {
  await SecureStore.deleteItemAsync(SEEN_KEY);
  await SecureStore.deleteItemAsync(VIEWED_KEY);
}
