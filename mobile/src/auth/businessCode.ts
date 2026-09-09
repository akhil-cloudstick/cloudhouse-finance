import * as SecureStore from "expo-secure-store";

/* The business this app is signed in to.
 *
 * A staff username/phone is unique only WITHIN a business, so once more than
 * one tenant runs on the backend it cannot tell which staff member is
 * signing in from the identifier alone — it answers "please use your
 * organisation's sign-in link, or enter your business code" instead
 * (auth.ErrBusinessCodeRequired), exactly as the web staff app does (see
 * frontend/common/services/tenantSession.ts).
 *
 * Remembered after the first successful sign-in so a returning staff member
 * never types it twice. Not a secret and not an authority: it selects which
 * business to authenticate against and grants nothing. Kept in SecureStore
 * only because that is what this app already uses for small values (see
 * tokenStorage.ts).
 */
const BUSINESS_CODE_KEY = "cloudhousestaff_business_code";

/* Same rule as the web app's slug (frontend/common/services/tenantSession.ts)
 * and the customer app's lender code (customer-mobile/src/auth/businessCode.ts):
 * lowercase alphanumerics and dashes. Validated so a stray value is never
 * sent as a business code. */
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
