import * as SecureStore from "expo-secure-store";

// The customer session JWT — short-lived (see backend's sessionTokenTTL),
// re-obtained via OTP or device-login. Distinct storage key from the staff
// app's ("ambikagold_jwt") since these are separate installs/devices in
// practice, but kept distinct defensively either way.
const TOKEN_KEY = "ambikacustomer_session_jwt";

export async function saveToken(token: string): Promise<void> {
  await SecureStore.setItemAsync(TOKEN_KEY, token);
}

export async function getToken(): Promise<string | null> {
  return SecureStore.getItemAsync(TOKEN_KEY);
}

export async function clearToken(): Promise<void> {
  await SecureStore.deleteItemAsync(TOKEN_KEY);
}
