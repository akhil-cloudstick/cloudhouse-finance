/* Shared customer-identity checks. The backend repeats them (customerValidate). */

export const PAN_RE = /^[A-Z]{5}\d{4}[A-Z]$/;
export const AADHAAR_RE = /^\d{12}$/;

/* A name or relation never holds digits: drop them as the user types. */
export const stripDigits = (v: string): string => v.replace(/\d/g, "");

export const PAN_MESSAGE = "Please enter a valid PAN (e.g. ABCDE1234F).";
export const AADHAAR_MESSAGE = "Please enter a valid 12-digit Aadhaar number.";
