import * as SecureStore from "expo-secure-store";
import { rememberToken } from "./apiContract";

const TOKEN_KEY = "cloudhouse_jwt";

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
