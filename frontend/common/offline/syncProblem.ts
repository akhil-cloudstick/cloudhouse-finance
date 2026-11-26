/* What is wrong with sending this PC's saved changes to the server, for the banner at the top of the app (desktop only).
 *
 *  - stuck:       the server answered a send with an error (500, a timeout, too many requests) so the change is still waiting
 *                 and is tried again every minute. It is never moved to the review list for that (only a refusal is).
 *  - authExpired: the server no longer accepts this sign-in (401). The person keeps working from this PC's own copy; the
 *                 changes wait and go out after they sign in again. When the app is closed they are signed out: the marker
 *                 below makes the next launch start at the sign-in page.
 *
 * Nothing here talks to the network, so it can be imported anywhere. */

import { SYNC_STATE_EVENT } from "./progress";

const MARKER = "cloudhouse_relogin_after_close";

let stuck = false;
let authExpired = false;

function announce() {
	if (typeof window !== "undefined") window.dispatchEvent(new Event(SYNC_STATE_EVENT));
}

export function syncProblem(): { stuck: boolean; authExpired: boolean } {
	return { stuck, authExpired };
}

export function setStuck(on: boolean): void {
	if (stuck === on) return;
	stuck = on;
	announce();
}

export function markAuthExpired(): void {
	try {
		localStorage.setItem(MARKER, "1");
	} catch {
		/* the banner still shows; only the sign-out at the next launch is lost */
	}
	if (authExpired) return;
	authExpired = true;
	announce();
}

/* The server accepted a request again (or the person signed in again): nothing is wrong any more. */
export function clearAuthExpired(): void {
	try {
		localStorage.removeItem(MARKER);
	} catch {
		/* nothing to remove */
	}
	if (!authExpired) return;
	authExpired = false;
	announce();
}

/* Called once when the app starts: true when the last run ended with the server refusing the sign-in, so this run starts
 * signed out. The marker is removed either way. */
export function consumeExpiredMarker(): boolean {
	try {
		const had = localStorage.getItem(MARKER) === "1";
		localStorage.removeItem(MARKER);
		return had;
	} catch {
		return false;
	}
}
