import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";

/* expo-secure-store has no web implementation (it throws "getValueWithKeyAsync is not a function").
 * On native this is a straight pass-through; on web it falls back to localStorage so the app runs in a browser. */

function webStorage(): Storage | null {
  try {
    return typeof localStorage !== "undefined" ? localStorage : null;
  } catch {
    return null;
  }
}

export async function getItemAsync(key: string): Promise<string | null> {
  if (Platform.OS !== "web") return SecureStore.getItemAsync(key);
  return webStorage()?.getItem(key) ?? null;
}

export async function setItemAsync(key: string, value: string): Promise<void> {
  if (Platform.OS !== "web") return SecureStore.setItemAsync(key, value);
  try { webStorage()?.setItem(key, value); } catch { /* storage unavailable: behave as unsaved */ }
}

export async function deleteItemAsync(key: string): Promise<void> {
  if (Platform.OS !== "web") return SecureStore.deleteItemAsync(key);
  try { webStorage()?.removeItem(key); } catch { /* nothing to remove */ }
}
