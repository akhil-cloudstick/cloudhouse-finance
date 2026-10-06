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

/* The business is no longer baked into the build. The app starts on the
 * connect screen (app/(auth)/connect.tsx), which learns it by scanning the
 * QR in the web dashboard's header (frontend ConnectMobileModal) or from a
 * typed code, and stores it here. It stays until the user picks "Exit
 * business" — a plain sign-out keeps it, so the next sign-in goes straight
 * to that business's login page. */
export async function getBusinessCode(): Promise<string> {
  const stored = await SecureStore.getItemAsync(BUSINESS_CODE_KEY);
  return stored && isValidBusinessCode(stored) ? stored : "";
}

/* The connect code: a 6-character code the web dashboard's "Connect mobile
 * app" modal issues fresh each time (WhatsApp "link a device" style — see
 * backend/internal/branding/connect.go). The phone redeems it for the
 * business code above; it expires after a few minutes. Same alphabet as the
 * server: no 0/O, 1/I/L look-alikes. Typed input may be lowercase or carry a
 * space/dash in the middle ("ABC 123"). */
const CONNECT_CODE_PATTERN = /^[ABCDEFGHJKMNPQRSTUVWXYZ2-9]{6}$/;

export function normalizeConnectCode(value: string): string {
  return value.replace(/[\s-]/g, "").toUpperCase();
}

export function isValidConnectCode(value: string): boolean {
  return CONNECT_CODE_PATTERN.test(value);
}

/* Reads the connect code out of a scanned QR. The web encodes
 * `cloudhouse://connect?c=<code>` (the app's own scheme, so the phone camera
 * can open it too); a bare code is accepted as well. Anything else — a
 * packet label, another app's QR — is null. */
export function parseConnectQr(scanned: string): string | null {
  const s = scanned.trim();
  const m = s.match(/^cloudhouse:\/\/\/?connect\?(?:.*&)?c=([^&#\s]+)/i);
  let raw = m ? m[1] : s;
  try {
    raw = decodeURIComponent(raw);
  } catch {
    return null;
  }
  const code = normalizeConnectCode(raw);
  return isValidConnectCode(code) ? code : null;
}

/* The one-time login token the connect QR may carry next to the connect code
 * (`cloudhouse://connect?c=<code>&l=<token>`), minted for the employee signed
 * in on the web. Null when absent or malformed. */
export function parseConnectLoginToken(scanned: string): string | null {
  const m = scanned.match(/^cloudhouse:\/\/\/?connect\?(?:.*&)?l=([0-9a-f]{32})(?:&|#|$)/i);
  return m ? m[1].toLowerCase() : null;
}

export async function clearBusinessCode(): Promise<void> {
  await SecureStore.deleteItemAsync(BUSINESS_CODE_KEY);
}