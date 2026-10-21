import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

// Read back only after a successful local biometric check; its presence decides biometric vs. OTP login.
const DEVICE_TOKEN_KEY = "cloudhousecustomer_device_token";
const DEVICE_ID_KEY = "cloudhousecustomer_device_id";

export async function saveDeviceToken(token: string): Promise<void> {
  await SecureStore.setItemAsync(DEVICE_TOKEN_KEY, token);
}

export async function getDeviceToken(): Promise<string | null> {
  return SecureStore.getItemAsync(DEVICE_TOKEN_KEY);
}

export async function clearDeviceToken(): Promise<void> {
  await SecureStore.deleteItemAsync(DEVICE_TOKEN_KEY);
}

// Per-install random id, not a hardware identifier; only needs to scope a token for revocation, not fingerprint the device.
export async function getOrCreateDeviceId(): Promise<string> {
  const existing = await SecureStore.getItemAsync(DEVICE_ID_KEY);
  if (existing) return existing;
  const id = `${Platform.OS}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  await SecureStore.setItemAsync(DEVICE_ID_KEY, id);
  return id;
}
