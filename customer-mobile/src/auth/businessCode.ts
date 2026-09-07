import * as SecureStore from "expo-secure-store";

/* The lender this app is signed in to.
 *
 * A borrower's phone number is unique only WITHIN a lender, so once more than
 * one business runs on the backend it cannot tell which borrower is asking for
 * an OTP from the phone number alone — it answers "please open your lender's
 * app link" instead (customerauth.ErrBusinessCodeRequired). Without this the
 * borrower app is locked out the day a second lender exists, exactly as the
 * staff web app was.
 *
 * Only the OTP endpoints need it. device-login resolves the lender from the
 * stored device token, and refresh reads it from the session already on the
 * request — so this is a sign-in concern, not a session one.
 *
 * Remembered after the first successful sign-in so a returning borrower never
 * types it twice. Not a secret and not an authority: it selects which lender
 * to authenticate against and grants nothing. Kept in SecureStore only because
 * that is what this app already uses for small values.
 */
const BUSINESS_CODE_KEY = "ambikacustomer_business_code";

/* Same rule as the staff app's slug (frontend/common/services/tenantSession.ts):
 * lowercase alphanumerics and dashes. Validated so a stray value is never sent
 * as a lender code. */
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
