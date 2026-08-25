import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

// The long-lived device token issued by POST /customer/auth/register-device
// (see plan step 34/55) — stored in SecureStore, only ever read back after a
// successful local biometric check (expo-local-authentication), then
// exchanged server-side for a fresh session JWT via POST
// /customer/auth/device-login. Its presence is also what app/_layout.tsx
// uses to decide "try biometric" vs. "go straight to OTP login".
const DEVICE_TOKEN_KEY = "ambikacustomer_device_token";
const DEVICE_ID_KEY = "ambikacustomer_device_id";

export async function saveDeviceToken(token: string): Promise<void> {
  await SecureStore.setItemAsync(DEVICE_TOKEN_KEY, token);
}

export async function getDeviceToken(): Promise<string | null> {
  return SecureStore.getItemAsync(DEVICE_TOKEN_KEY);
}

export async function clearDeviceToken(): Promise<void> {
  await SecureStore.deleteItemAsync(DEVICE_TOKEN_KEY);
}

// getOrCreateDeviceId returns a stable, random identifier for this install,
// generated once and persisted — used as the deviceId sent to
// register-device/verified server-side against the stored device token's
// row. Not a hardware identifier (Android/iOS don't expose one to apps
// anymore); a per-install random id is sufficient since its only job is to
// scope a single device's token for revocation, not to fingerprint the
// device itself.
export async function getOrCreateDeviceId(): Promise<string> {
  const existing = await SecureStore.getItemAsync(DEVICE_ID_KEY);
  if (existing) return existing;
  const id = `${Platform.OS}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  await SecureStore.setItemAsync(DEVICE_ID_KEY, id);
  return id;
}
