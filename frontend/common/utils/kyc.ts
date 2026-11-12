/* Shared customer-identity checks. The backend repeats them (customerValidate). */

export const PAN_RE = /^[A-Z]{5}\d{4}[A-Z]$/;
export const AADHAAR_RE = /^\d{12}$/;

/* A name or relation never holds digits: drop them as the user types. */
export const stripDigits = (v: string): string => v.replace(/\d/g, "");

/* Live PAN check, run on every keystroke: ABCDE1234F = 5 letters, 4 digits, 1 letter. Returns "" while what is typed so
 * far is still on track (a half-typed PAN is not an error yet), and otherwise names the first character that is out of
 * order so it can be pointed out as it is typed. */
export function panLiveError(value: string): string {
  const v = value.toUpperCase();
  for (let i = 0; i < v.length && i < 10; i++) {
    const ch = v[i];
    const wantLetter = i < 5 || i === 9;
    const ok = wantLetter ? /[A-Z]/.test(ch) : /\d/.test(ch);
    if (!ok) return "Format: ABCDE1234F";
  }
  return "";
}

export const PAN_MESSAGE ="Please enter a valid PAN (e.g. ABCDE1234F).";
export const AADHAAR_MESSAGE = "Please enter a valid 12-digit Aadhaar number.";
