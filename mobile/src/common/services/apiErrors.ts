// Turns whatever went wrong into something a staff member can read.
//
// Server validation messages ("Interest amount must be less than the
// principal amount") are already written for people and pass straight
// through. What must never reach the screen is the plumbing underneath:
// "JSON Parse error: Unexpected character: <", "Network request failed",
// "record not found", Go binding errors, SQL errors, raw HTTP status codes,
// JS runtime errors. Those are swapped for a plain message that says what
// happened and what to do.

// Fragments that only ever appear in technical errors.
const TECHNICAL = [
  /json/i,
  /unexpected (character|token|end|eof)/i,
  /syntax ?error/i,
  /network request failed/i,
  /failed to fetch/i,
  /typeerror|referenceerror|rangeerror/i,
  /undefined is not|null is not|is not a function|is not an object|cannot read propert/i,
  /\bsql\b|sqlstate|pq:|gorm|duplicate key|violates|constraint|relation ".*"/i,
  /record not found|no rows/i,
  /unmarshal|invalid character|looking for beginning of value/i,
  /field validation for|failed on the '.*' tag/i,
  /econn|enotfound|etimedout|socket|connection (refused|reset)/i,
  /timed out after/i,
  /\babort(ed)?\b/i,
  /<!doctype|<html|<\/?body/i,
  /\bnil\b|panic|runtime error|stack trace|exception/i,
  /java\.|ioexception|nsurl|kcferror/i,
  /\bstatus(code)?\s*\d{3}\b|\(\d{3}\)|http\s*\d{3}/i,
  /^[A-Z][a-zA-Z]+Error:?$/,
];

export function looksTechnical(message: string): boolean {
  const m = message.trim();
  if (!m) return true;
  return TECHNICAL.some((re) => re.test(m));
}

/** Plain message for an HTTP status when the server gave none we can show. */
export function messageForStatus(status: number): string {
  if (status === 0) return "Couldn't reach the server. Check your internet connection and try again.";
  if (status === 400 || status === 422) return "Some of the details aren't valid. Please check them and try again.";
  if (status === 401) return "Your session has ended. Please sign in again.";
  if (status === 403) return "You don't have permission to do this.";
  if (status === 404) return "We couldn't find that. It may have been removed.";
  if (status === 408) return "The server took too long to respond. Please try again.";
  if (status === 409) return "This was changed by someone else. Refresh and try again.";
  if (status === 413) return "That file is too large to upload.";
  if (status === 429) return "Too many attempts. Please wait a moment and try again.";
  if (status >= 500) return "Something went wrong on the server. Please try again in a moment.";
  return "Something went wrong. Please try again.";
}

/** Server message if it's readable, otherwise a plain one for the status. */
export function friendlyServerMessage(status: number, raw: unknown): string {
  const text = typeof raw === "string" ? raw : "";
  return text && !looksTechnical(text) ? text : messageForStatus(status);
}

/** What to show for any caught error. `fallback` names the action that
 * failed ("Could not save the customer — try again."). */
export function userMessage(err: unknown, fallback = "Something went wrong. Please try again."): string {
  const msg = err instanceof Error ? err.message : typeof err === "string" ? err : "";
  return msg && !looksTechnical(msg) ? msg : fallback;
}

/** What a list/detail shows when its fetch failed. `null` means "nothing
 * there" (a 404 — show the screen's own empty message, not an error); a 403
 * shows the server's reason (no permission / module off) since retrying
 * won't help; anything else is a real failure worth retrying. */
export function loadErrorText(err: unknown): string | null {
  if (!err) return null;
  const status = (err as { status?: unknown }).status;
  if (status === 404) return null;
  if (status === 401 || status === 403) return userMessage(err, "You don't have access to view this.");
  return "Couldn't load.";
}

/** Backing out of the system print/share dialog rejects with "Printing did
 * not complete" or similar — the user's choice, not an error to show. */
export function isUserCancel(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : typeof err === "string" ? err : "";
  return /did not complete|cancel(l)?ed|user cancel/i.test(msg);
}
