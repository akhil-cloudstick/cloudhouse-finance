import * as SecureStore from "expo-secure-store";
import { rememberToken } from "./apiContract";

// The customer session JWT — short-lived (see backend's sessionTokenTTL),
// re-obtained via OTP or device-login. Distinct storage key from the staff
// app's ("cloudhouse_jwt") since these are separate installs/devices in
// practice, but kept distinct defensively either way.
const TOKEN_KEY = "cloudhousecustomer_session_jwt";

export async function saveToken(token: string): Promise<void> {
  await SecureStore.setItemAsync(TOKEN_KEY, token);
  rememberToken(token);
}

export async function getToken(): Promise<string | null> {
  const token = await SecureStore.getItemAsync(TOKEN_KEY);
  rememberToken(token);
  return token;
}

export async function clearToken(): Promise<void> {
  await SecureStore.deleteItemAsync(TOKEN_KEY);
  rememberToken(null);
}
