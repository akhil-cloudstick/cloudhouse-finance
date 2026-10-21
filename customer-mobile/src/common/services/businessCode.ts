import * as SecureStore from "expo-secure-store";

// Disambiguates a phone number across lenders for OTP endpoints only; device-login/refresh resolve it elsewhere.
const BUSINESS_CODE_KEY = "cloudhousecustomer_business_code";

// Same rule as the staff app's slug: lowercase alphanumerics and dashes.
const CODE_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

export function isValidBusinessCode(value: string): boolean {
  return CODE_PATTERN.test(value) && value.length <= 60;
}

export function normalizeBusinessCode(value: string): string {
  return value.trim().toLowerCase();
}

export async function saveBusinessCode(code: string): Promise<void> {
  const normalized = normalizeBusinessCode(code);
  if (!isValidBusinessCode(normalized)) return;
  await SecureStore.setItemAsync(BUSINESS_CODE_KEY, normalized);
}

export async function getBusinessCode(): Promise<string> {
  const stored = await SecureStore.getItemAsync(BUSINESS_CODE_KEY);
  return stored && isValidBusinessCode(stored) ? stored : "";
}

export async function clearBusinessCode(): Promise<void> {
  await SecureStore.deleteItemAsync(BUSINESS_CODE_KEY);
}
